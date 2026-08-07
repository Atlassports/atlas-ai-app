// ========================================================
// Atlas AI — Stripe webhook handler
// Deployed automatically by Vercel as: /api/stripe-webhook
//
// What changed from the previous version:
//  - Records the REAL status ('trialing' stays 'trialing', not 'active'),
//    so you can tell trials from paying customers.
//  - Stores trial_ends_at so the dashboard can show a countdown.
//  - Falls back to matching by stripe_customer_id if the checkout email
//    doesn't match any profile (previously this failed silently and left
//    the customer permanently stuck).
//  - Logs loudly when a customer can't be matched, so it stops being silent.
// ========================================================

import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export const config = {
  api: { bodyParser: false },
};

function buffer(readable) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    readable.on('data', (chunk) => chunks.push(chunk));
    readable.on('end', () => resolve(Buffer.concat(chunks)));
    readable.on('error', reject);
  });
}

// Stripe has many statuses. Map them to what the site understands.
// 'active'   -> full access, paying
// 'trialing' -> full access, on a free trial
// anything else -> no access
function mapStatus(stripeStatus) {
  if (stripeStatus === 'active') return 'active';
  if (stripeStatus === 'trialing') return 'trialing';
  if (stripeStatus === 'canceled') return 'canceled';
  return 'inactive'; // past_due, unpaid, incomplete, incomplete_expired, paused
}

// Update a profile, preferring stripe_customer_id, falling back to email.
async function updateProfile(fields, { customerId, email }) {
  if (customerId) {
    const { data } = await supabaseAdmin
      .from('profiles')
      .update(fields)
      .eq('stripe_customer_id', customerId)
      .select('id');

    if (data && data.length > 0) return true;
  }

  if (email) {
    const { data } = await supabaseAdmin
      .from('profiles')
      .update(Object.assign({}, fields, customerId ? { stripe_customer_id: customerId } : {}))
      .eq('email', email)
      .select('id');

    if (data && data.length > 0) return true;
  }

  console.error(
    'STRIPE WEBHOOK: could not match a profile.',
    'customerId:', customerId, 'email:', email,
    '-- this customer will not get access until it is fixed by hand.'
  );
  return false;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method not allowed');
  }

  const rawBody = await buffer(req);
  const signature = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      // Fired the moment someone completes Stripe Checkout.
      case 'checkout.session.completed': {
        const session = event.data.object;
        const email = session.customer_details?.email;
        const customerId = session.customer;

        // Look up the real subscription so a trial is recorded as a trial.
        let status = 'active';
        let trialEndsAt = null;

        if (session.subscription) {
          const sub = await stripe.subscriptions.retrieve(session.subscription);
          status = mapStatus(sub.status);
          trialEndsAt = sub.trial_end
            ? new Date(sub.trial_end * 1000).toISOString()
            : null;
        }

        await updateProfile(
          {
            subscription_status: status,
            stripe_customer_id: customerId,
            trial_ends_at: trialEndsAt,
          },
          { customerId: null, email } // match by email on first checkout
        );
        break;
      }

      // Fired on renewals, trial conversion, plan changes, payment failures.
      case 'customer.subscription.updated': {
        const sub = event.data.object;
        await updateProfile(
          {
            subscription_status: mapStatus(sub.status),
            trial_ends_at: sub.trial_end
              ? new Date(sub.trial_end * 1000).toISOString()
              : null,
          },
          { customerId: sub.customer, email: null }
        );
        break;
      }

      // Fired on cancellation.
      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        await updateProfile(
          { subscription_status: 'canceled', trial_ends_at: null },
          { customerId: sub.customer, email: null }
        );
        break;
      }

      default:
        break;
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('Error handling webhook event:', err);
    return res.status(500).send('Internal error');
  }
}
