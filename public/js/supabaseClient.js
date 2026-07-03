// ========================================================
// Atlas AI — Supabase client
// Fill in ATLAS_CONFIG below with your own project's values.
// Both of these are PUBLIC/safe to expose in browser code —
// they are not secret keys. Never put your service_role key
// here or in any file inside /public.
// ========================================================

const ATLAS_CONFIG = {
  SUPABASE_URL: "https://YOUR-PROJECT-REF.supabase.co",
  SUPABASE_ANON_KEY: "YOUR-ANON-PUBLIC-KEY",
  STRIPE_PAYMENT_LINK: "https://buy.stripe.com/4gM7sNfr5gisemh83Eawo00"
};

// supabase-js is loaded via CDN script tag before this file, exposing `window.supabase`
const supabaseClient = window.supabase.createClient(
  ATLAS_CONFIG.SUPABASE_URL,
  ATLAS_CONFIG.SUPABASE_ANON_KEY
);
