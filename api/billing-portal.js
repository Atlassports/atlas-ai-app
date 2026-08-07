// api/billing-portal.js
//
// Creates a Stripe Customer Portal session so a player can manage or cancel
// their subscription. Stripe hosts the whole page — we just send them there.
//
// BEFORE THIS WORKS: you must activate the portal once in Stripe:
//   Stripe Dashboard > Settings > Billing > Customer portal > activate,
//   and make sure "Cancel subscriptions" is switched on.
//
// ENV VARS (all already set): STRIPE_SECRET_KEY, SUPABASE_URL,
//                             SUPABASE_SERVICE_ROLE_KEY

import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { accessToken } = req.body || {};
    if (!accessToken) {
      return res.status(400).json({ error: 'Missing accessToken' });
    }

    // Who is this?
    const { data: userData, error: userErr } =
      await supabaseAdmin.auth.getUser(accessToken);

    if (userErr || !userData || !userData.user) {
      return res.status(401).json({ error: 'Not logged in' });
    }

    const userId = userData.user.id;

    // Find their Stripe customer id.
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('stripe_customer_id')
      .eq('id', userId)
      .single();

    if (!profile || !profile.stripe_customer_id) {
      return res.status(404).json({
        error: "We couldn't find a billing account for you. If you think this is wrong, email us and we'll sort it out.",
      });
    }

    // Where Stripe sends them when they're done.
    const origin =
      req.headers.origin ||
      (req.headers.host ? `https://${req.headers.host}` : 'https://atlashockey.net');

    const session = await stripe.billingPortal.sessions.create({
      customer: profile.stripe_customer_id,
      return_url: `${origin}/dashboard.html`,
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Billing portal error:', err);
    return res.status(500).json({ error: 'Could not open billing settings.' });
  }
}
