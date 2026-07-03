// ========================================================
// Atlas AI — Supabase client
// Fill in ATLAS_CONFIG below with your own project's values.
// Both of these are PUBLIC/safe to expose in browser code —
// they are not secret keys. Never put your service_role key
// here or in any file inside /public.
// ========================================================

const ATLAS_CONFIG = {
  SUPABASE_URL: "https://gkkkcyeoffcedxhrncwr.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdra2tjeWVvZmZjZWR4aHJuY3dyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMwNjk3MDIsImV4cCI6MjA5ODY0NTcwMn0.Cw6qhvs6W6iA4UrBfHQnbl-avWsxGJXLS_7pAGe4nKg",
  STRIPE_PAYMENT_LINK: "https://buy.stripe.com/4gM7sNfr5gisemh83Eawo00"
};

// supabase-js is loaded via CDN script tag before this file, exposing `window.supabase`
const supabaseClient = window.supabase.createClient(
  ATLAS_CONFIG.SUPABASE_URL,
  ATLAS_CONFIG.SUPABASE_ANON_KEY
);
