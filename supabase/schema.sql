-- ========================================================
-- Atlas AI — Supabase schema
-- Run this once in Supabase: Project → SQL Editor → New query
-- Paste this whole file → Run.
-- ========================================================

-- 1. Profiles table
-- One row per user. Created automatically when someone signs up
-- (see trigger below). Holds subscription status synced from Stripe.
create table if not exists public.profiles (
  id uuid references auth.users(id) on delete cascade primary key,
  email text,
  stripe_customer_id text,
  subscription_status text default 'inactive',  -- 'active' | 'inactive' | 'canceled'
  price_locked_cents integer default 1500,       -- $15.00 founding-member price, locked
  created_at timestamptz default now()
);

alter table public.profiles enable row level security;

-- Users can see and update only their own profile.
-- (Subscription status is updated by the Stripe webhook using the
-- service_role key, which bypasses RLS entirely — so users can't
-- fake their own "active" status by editing this from the browser.)
create policy "Users can view own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id);


-- 2. Videos table
-- One row per uploaded video.
create table if not exists public.videos (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  file_path text not null,
  status text default 'pending',   -- 'pending' | 'processing' | 'processed'
  report_url text,
  created_at timestamptz default now()
);

alter table public.videos enable row level security;

create policy "Users can view own videos"
  on public.videos for select
  using (auth.uid() = user_id);

create policy "Users can insert own videos"
  on public.videos for insert
  with check (auth.uid() = user_id);


-- 3. Auto-create a profile row whenever someone signs up
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email);
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();


-- 4. Storage bucket for video uploads
-- (Run this section, or create the "videos" bucket manually in
-- Storage → New bucket → name it exactly "videos", keep it Private.)
insert into storage.buckets (id, name, public)
values ('videos', 'videos', false)
on conflict (id) do nothing;

-- Users can only upload/read files inside a folder named after their own user id
create policy "Users can upload own videos"
  on storage.objects for insert
  with check (bucket_id = 'videos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Users can view own videos"
  on storage.objects for select
  using (bucket_id = 'videos' and (storage.foldername(name))[1] = auth.uid()::text);
