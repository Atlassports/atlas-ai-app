// ========================================================
// Atlas AI — Redeem code endpoint
// Deployed by Vercel as: /api/redeem-code
//
// Why this has to be a server function and not done directly from
// the browser: the redeem_codes table has no public read/write access
// (on purpose) so a player can't peek at valid codes or edit their own
// subscription_status from browser dev tools. This function uses the
// service_role key (server-only) to safely check + apply a code.
// ========================================================

import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { code, access_token } = req.body || {};
  if (!code || !access_token) {
    return res.status(400).json({ error: 'Missing code or access_token' });
  }

  // Verify the caller is who they say they are (their logged-in session token)
  const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(access_token);
  if (userErr || !userData?.user) {
    return res.status(401).json({ error: 'Not logged in' });
  }
  const userId = userData.user.id;

  // Has this user already redeemed a code?
  const { data: existingUse } = await supabaseAdmin
    .from('redeem_code_uses')
    .select('id')
    .eq('user_id', userId)
    .maybeSingle();

  if (existingUse) {
    return res.status(400).json({ error: 'You\u2019ve already redeemed a code on this account.' });
  }

  // Look up the code
  const cleanCode = String(code).trim().toUpperCase();
  const { data: codeRow, error: codeErr } = await supabaseAdmin
    .from('redeem_codes')
    .select('*')
    .eq('code', cleanCode)
    .maybeSingle();

  if (codeErr || !codeRow) {
    return res.status(404).json({ error: 'That code isn\u2019t valid.' });
  }
  if (!codeRow.active) {
    return res.status(400).json({ error: 'That code is no longer active.' });
  }
  if (codeRow.expires_at && new Date(codeRow.expires_at) < new Date()) {
    return res.status(400).json({ error: 'That code has expired.' });
  }
  if (codeRow.uses_count >= codeRow.max_uses) {
    return res.status(400).json({ error: 'That code has already been fully used.' });
  }

  // All checks passed — apply it
  const { error: useErr } = await supabaseAdmin
    .from('redeem_code_uses')
    .insert({ code_id: codeRow.id, user_id: userId });
  if (useErr) {
    return res.status(500).json({ error: 'Could not record redemption.' });
  }

  await supabaseAdmin
    .from('redeem_codes')
    .update({ uses_count: codeRow.uses_count + 1 })
    .eq('id', codeRow.id);

  await supabaseAdmin
    .from('profiles')
    .update({ subscription_status: 'active' })
    .eq('id', userId);

  return res.status(200).json({ success: true });
}
