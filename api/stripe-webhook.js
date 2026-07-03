// ========================================================
// Atlas AI — Stripe webhook handler
// Deployed automatically by Vercel as: /api/stripe-webhook
//
// This is the ONE place your Stripe secret key and Supabase
// service_role key are used. They live in Vercel's environment
// variables (server-side only) — never in the /public folder.
//
// What it does:
//  - Verifies the request really came from Stripe
//  - On successful checkout / renewal -> sets subscription_status = 'active'
//  - On cancellation / failed payment -> sets subscription_status = 'inactive'
// ========================================================

import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY  // service_role = full access, server-only
);

// Vercel needs the raw request body to verify the Stripe signature,
// so we turn off the default body parser for this route.
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
      // Fired the moment someone completes Stripe Checkout
      case 'checkout.session.completed': {
        const session = event.data.object;
        const customerEmail = session.customer_details?.email;
        const customerId = session.customer;

        if (customerEmail) {
          await supabaseAdmin
            .from('profiles')
            .update({
              subscription_status: 'active',
              stripe_customer_id: customerId,
            })
            .eq('email', customerEmail);
        }
        break;
      }

      // Fired on renewals and plan changes
      case 'customer.subscription.updated': {
        const sub = event.data.object;
        const status = sub.status === 'active' || sub.status === 'trialing'
          ? 'active'
          : 'inactive';

        await supabaseAdmin
          .from('profiles')
          .update({ subscription_status: status })
          .eq('stripe_customer_id', sub.customer);
        break;
      }

      // Fired on cancellation
      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        await supabaseAdmin
          .from('profiles')
          .update({ subscription_status: 'canceled' })
          .eq('stripe_customer_id', sub.customer);
        break;
      }

      default:
        // Ignore other event types
        break;
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('Error handling webhook event:', err);
    return res.status(500).send('Internal error');
  }
}
