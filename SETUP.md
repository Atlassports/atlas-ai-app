# Atlas AI — Setup Guide (Real Logins + Payments)

This turns your landing page into a real app with accounts, logins, and
a dashboard that unlocks when someone pays. Everything is free to start.

You'll create two free accounts (Supabase, and you already have Stripe),
copy a few keys into two files, then deploy. About 30–40 minutes total.

---

## What you're setting up

- **Supabase** — your database + login system + video storage
- **Stripe** — you already have this; we're just connecting it
- **Vercel** — hosting, same as before

---

## Step 1 — Create your Supabase project (10 min)

1. Go to **supabase.com** → sign up (free) → **New project**
2. Name it `atlas-ai`, set a database password (save it somewhere), pick the
   region closest to you → **Create new project** (takes ~2 min to spin up)
3. Once it's ready, go to **SQL Editor** (left sidebar) → **New query**
4. Open `supabase/schema.sql` from this project, copy the whole thing,
   paste it into the editor → click **Run**
   - This creates your `profiles` and `videos` tables, sets up security
     rules so users can only see their own data, and creates a private
     `videos` storage bucket.
5. Go to **Project Settings → API** (left sidebar, gear icon)
   - Copy the **Project URL** — you'll need this
   - Copy the **anon / public** key — you'll need this
   - Copy the **service_role** key — you'll need this too, but treat it
     like a password. It goes in Vercel only, never in your website files.

---

## Step 2 — Plug your Supabase keys into the site (2 min)

1. Open `public/js/supabaseClient.js`
2. Replace:
   ```js
   SUPABASE_URL: "https://YOUR-PROJECT-REF.supabase.co",
   SUPABASE_ANON_KEY: "YOUR-ANON-PUBLIC-KEY",
   ```
   with your real **Project URL** and **anon/public key** from Step 1.
3. Save. (This file is safe to be public — the anon key is designed to be
   used in browser code. Your database rules are what actually protect data.)

---

## Step 3 — Turn on the Stripe webhook (10 min)

This is what tells your database "this person just paid" the instant
someone completes checkout.

1. Go to **dashboard.stripe.com → Developers → Webhooks**
2. Click **+ Add endpoint**
3. For the endpoint URL, use (you'll get the real domain after deploying
   in Step 5 — come back and finish this step once you have it):
   ```
   https://YOUR-DOMAIN.vercel.app/api/stripe-webhook
   ```
4. Under **Select events to listen to**, add:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
5. Click **Add endpoint**. On the endpoint's page, click **Reveal** next to
   **Signing secret** — copy it (starts with `whsec_...`). You'll need this
   in Step 5.
6. Also grab your **Stripe secret key**: Developers → API keys → reveal
   the **Secret key** (starts with `sk_live_...` or `sk_test_...`).

---

## Step 4 — Push this project to GitHub

Vercel deploys from a GitHub repo (needed for the serverless function to
work — drag-and-drop only works for pure static sites).

1. Create a free GitHub account if you don't have one
2. Create a new repository, e.g. `atlas-ai-app`
3. Upload everything in this project folder to that repo
   (easiest: GitHub's web UI → **Add file → Upload files** → drag the
   whole folder in)

---

## Step 5 — Deploy to Vercel with your keys (5 min)

1. Go to **vercel.com** → sign in with GitHub
2. **Add New → Project** → select your `atlas-ai-app` repo → **Import**
3. Before clicking Deploy, open **Environment Variables** and add these
   four (paste the real values you collected above):

   | Name | Value |
   |---|---|
   | `SUPABASE_URL` | your Supabase Project URL |
   | `SUPABASE_SERVICE_ROLE_KEY` | your Supabase service_role key |
   | `STRIPE_SECRET_KEY` | your Stripe secret key |
   | `STRIPE_WEBHOOK_SECRET` | the `whsec_...` value from Step 3 |

4. Click **Deploy**. You'll get a live URL like `atlas-ai-app.vercel.app`.
5. Go back to Stripe's webhook page (Step 3) and update the endpoint URL
   to your real Vercel domain, if you hadn't already.

---

## Step 6 — Test it

1. Visit your live site → **Get started** → create an account with a
   test email
2. Log in → you should land on the dashboard, showing **"Not subscribed"**
3. Click **Upgrade — $15/mo** → complete a real Stripe checkout
4. Within a few seconds, refresh the dashboard — status should flip to
   **"Active — $15/mo"** and the upload zone should unlock

If status doesn't flip: check **Stripe → Webhooks → your endpoint → 
recent deliveries** for errors, and **Vercel → your project → Logs** for
what the function saw.

---

## What's already wired in

- Your real Stripe Payment Link is in `public/js/supabaseClient.js`
- Signup/login/logout, fully working against Supabase Auth
- A dashboard that gates the upload zone based on real subscription status
- Video uploads go into private, per-user storage (each player can only
  see their own files)
- A `videos` table tracking status (`pending` → `processed`) — this is the
  hook point for your Colab pipeline later (see below)

## What's NOT automated yet (by design — same manual step you have now)

Uploaded videos land in Supabase Storage with a `status: 'pending'` row,
but nothing processes them automatically yet. For now, you'd still pull
new uploads and run them through your existing Colab pipeline by hand,
then update that video's row to `status: 'processed'` and attach a
`report_url`. Automating that pickup-and-process step is a good next
phase once you've validated the accounts/payment flow works.

## Design credit

This is meant as a **starting scaffold**, not your final visual design —
your `index.html` here is just a placeholder. Drop your real landing page
HTML in and repoint its "Get started"/"Log in" buttons to `/signup.html`
and `/login.html`.
