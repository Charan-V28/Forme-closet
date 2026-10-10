-- Forme web beta foundation for Supabase.
-- Run in a new Supabase project's SQL editor. This creates private per-user data
-- tables and buckets; it does not connect the current browser-local MVP yet.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  height text not null default '',
  weight text not null default '',
  body_shape text not null default '',
  chest text not null default '',
  waist text not null default '',
  hips text not null default '',
  inseam text not null default '',
  sizing_preference text not null default '',
  photo_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.closet_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  category text not null check (category in (
    'Tops', 'Bottoms', 'Dresses & one-pieces', 'Outerwear', 'Shoes', 'Accessories'
  )),
  color text not null default '',
  brand text not null default '',
  size text not null default '',
  season text not null default '',
  notes text not null default '',
  photo_paths text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists closet_items_owner_category_idx
  on public.closet_items (owner_id, category, created_at desc);

create table if not exists public.saved_outfits (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null default 'A look for today',
  -- Snapshot keeps an outfit usable if the closet item is later edited/deleted.
  items jsonb not null default '[]'::jsonb,
  preview_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists saved_outfits_owner_created_idx
  on public.saved_outfits (owner_id, created_at desc);

alter table public.profiles enable row level security;
alter table public.closet_items enable row level security;
alter table public.saved_outfits enable row level security;

drop policy if exists "Users manage their own profile" on public.profiles;
create policy "Users manage their own profile" on public.profiles
  for all to authenticated using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

drop policy if exists "Users manage their own closet items" on public.closet_items;
create policy "Users manage their own closet items" on public.closet_items
  for all to authenticated using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

drop policy if exists "Users manage their own saved outfits" on public.saved_outfits;
create policy "Users manage their own saved outfits" on public.saved_outfits
  for all to authenticated using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

-- Private buckets. Images use a path beginning with the authenticated user ID.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('profile-photos', 'profile-photos', false, 10485760, array['image/jpeg', 'image/png', 'image/webp']),
  ('closet-items', 'closet-items', false, 10485760, array['image/jpeg', 'image/png', 'image/webp']),
  ('outfit-previews', 'outfit-previews', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Users read their own private images" on storage.objects;
create policy "Users read their own private images" on storage.objects
  for select to authenticated
  using (
    bucket_id in ('profile-photos', 'closet-items', 'outfit-previews')
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Users upload their own private images" on storage.objects;
create policy "Users upload their own private images" on storage.objects
  for insert to authenticated
  with check (
    bucket_id in ('profile-photos', 'closet-items', 'outfit-previews')
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Users update their own private images" on storage.objects;
create policy "Users update their own private images" on storage.objects
  for update to authenticated
  using (
    bucket_id in ('profile-photos', 'closet-items', 'outfit-previews')
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id in ('profile-photos', 'closet-items', 'outfit-previews')
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Users delete their own private images" on storage.objects;
create policy "Users delete their own private images" on storage.objects
  for delete to authenticated
  using (
    bucket_id in ('profile-photos', 'closet-items', 'outfit-previews')
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
