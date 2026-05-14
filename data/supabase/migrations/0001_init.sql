-- Legatograph initial schema.
-- Multi-artist tenancy: every domain row is scoped to an artist.
-- Access is enforced by row-level security policies that check
-- artist_memberships for the current auth.uid().

create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- ============================================================================
-- Core tenancy: users, artists, memberships
-- ============================================================================

create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  name text,
  created_at timestamptz not null default now()
);

create table if not exists public.artists (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  bio text,
  contact_email text,
  brand_kit jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.artist_memberships (
  user_id uuid not null references public.users(id) on delete cascade,
  artist_id uuid not null references public.artists(id) on delete cascade,
  role text not null default 'owner' check (role in ('owner', 'collaborator')),
  created_at timestamptz not null default now(),
  primary key (user_id, artist_id)
);

-- ============================================================================
-- Content tables (artist-scoped)
-- ============================================================================

create table if not exists public.tracks (
  id uuid primary key default gen_random_uuid(),
  artist_id uuid not null references public.artists(id) on delete cascade,
  title text not null,
  audio_url text,
  artwork_url text,
  release_date date,
  spotify_id text,
  isrc text,
  smart_link_url text,
  duration_seconds numeric,
  bpm numeric,
  downbeat_offset_seconds numeric,
  analysis jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tracks_artist_id_idx on public.tracks(artist_id);

create table if not exists public.clips (
  id uuid primary key default gen_random_uuid(),
  artist_id uuid not null references public.artists(id) on delete cascade,
  source text not null check (source in ('upload', 'gdrive')),
  gdrive_file_id text,
  storage_url text,
  duration_seconds numeric,
  width int,
  height int,
  tags text[] not null default '{}',
  thumbnail_url text,
  created_at timestamptz not null default now()
);

create index if not exists clips_artist_id_idx on public.clips(artist_id);

create table if not exists public.hooks (
  id uuid primary key default gen_random_uuid(),
  track_id uuid not null references public.tracks(id) on delete cascade,
  start_seconds numeric not null,
  end_seconds numeric not null,
  score numeric,
  label text,
  created_at timestamptz not null default now(),
  check (end_seconds > start_seconds)
);

create index if not exists hooks_track_id_idx on public.hooks(track_id);

create table if not exists public.renders (
  id uuid primary key default gen_random_uuid(),
  artist_id uuid not null references public.artists(id) on delete cascade,
  track_id uuid references public.tracks(id) on delete set null,
  hook_id uuid references public.hooks(id) on delete set null,
  template_id text,
  aspect_ratio text check (aspect_ratio in ('9x16', '1x1', '16x9')),
  platform text,
  clip_ids uuid[] not null default '{}',
  output_url text,
  status text not null default 'queued' check (status in ('queued', 'rendering', 'ready', 'failed')),
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists renders_artist_id_idx on public.renders(artist_id);
create index if not exists renders_status_idx on public.renders(status);

create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  artist_id uuid not null references public.artists(id) on delete cascade,
  render_id uuid references public.renders(id) on delete set null,
  platform text not null,
  caption text,
  hashtags text[] not null default '{}',
  scheduled_for timestamptz,
  status text not null default 'draft' check (status in ('draft', 'scheduled', 'published', 'failed')),
  ayrshare_post_id text,
  permalink text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists posts_artist_id_idx on public.posts(artist_id);
create index if not exists posts_scheduled_for_idx on public.posts(scheduled_for);

-- ============================================================================
-- Row-Level Security
-- ============================================================================

alter table public.users enable row level security;
alter table public.artists enable row level security;
alter table public.artist_memberships enable row level security;
alter table public.tracks enable row level security;
alter table public.clips enable row level security;
alter table public.hooks enable row level security;
alter table public.renders enable row level security;
alter table public.posts enable row level security;

create or replace function public.is_member_of(target_artist_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.artist_memberships
    where artist_id = target_artist_id
      and user_id = auth.uid()
  );
$$;

-- Users: read/update only self
drop policy if exists "users_read_self" on public.users;
create policy "users_read_self" on public.users for select using (auth.uid() = id);
drop policy if exists "users_update_self" on public.users;
create policy "users_update_self" on public.users for update using (auth.uid() = id);
drop policy if exists "users_insert_self" on public.users;
create policy "users_insert_self" on public.users for insert with check (auth.uid() = id);

-- Artists: see if a member; any authed user can create an artist (becomes owner via trigger or app code)
drop policy if exists "artists_read_member" on public.artists;
create policy "artists_read_member" on public.artists for select using (public.is_member_of(id));
drop policy if exists "artists_insert_authed" on public.artists;
create policy "artists_insert_authed" on public.artists for insert with check (auth.uid() is not null);
drop policy if exists "artists_update_member" on public.artists;
create policy "artists_update_member" on public.artists for update using (public.is_member_of(id));

-- Memberships: see/manage own
drop policy if exists "memberships_read_self" on public.artist_memberships;
create policy "memberships_read_self" on public.artist_memberships for select using (user_id = auth.uid());
drop policy if exists "memberships_insert_self" on public.artist_memberships;
create policy "memberships_insert_self" on public.artist_memberships for insert with check (user_id = auth.uid());
drop policy if exists "memberships_delete_self" on public.artist_memberships;
create policy "memberships_delete_self" on public.artist_memberships for delete using (user_id = auth.uid());

-- Artist-scoped CRUD policies
do $$
declare
  t text;
begin
  foreach t in array array['tracks', 'clips', 'renders', 'posts']
  loop
    execute format('drop policy if exists "%s_read_member" on public.%I', t, t);
    execute format('create policy "%s_read_member" on public.%I for select using (public.is_member_of(artist_id))', t, t);
    execute format('drop policy if exists "%s_insert_member" on public.%I', t, t);
    execute format('create policy "%s_insert_member" on public.%I for insert with check (public.is_member_of(artist_id))', t, t);
    execute format('drop policy if exists "%s_update_member" on public.%I', t, t);
    execute format('create policy "%s_update_member" on public.%I for update using (public.is_member_of(artist_id))', t, t);
    execute format('drop policy if exists "%s_delete_member" on public.%I', t, t);
    execute format('create policy "%s_delete_member" on public.%I for delete using (public.is_member_of(artist_id))', t, t);
  end loop;
end;
$$;

-- Hooks scoped via parent track
drop policy if exists "hooks_read_member" on public.hooks;
create policy "hooks_read_member" on public.hooks for select using (
  exists (select 1 from public.tracks t where t.id = hooks.track_id and public.is_member_of(t.artist_id))
);
drop policy if exists "hooks_insert_member" on public.hooks;
create policy "hooks_insert_member" on public.hooks for insert with check (
  exists (select 1 from public.tracks t where t.id = hooks.track_id and public.is_member_of(t.artist_id))
);
drop policy if exists "hooks_delete_member" on public.hooks;
create policy "hooks_delete_member" on public.hooks for delete using (
  exists (select 1 from public.tracks t where t.id = hooks.track_id and public.is_member_of(t.artist_id))
);

-- ============================================================================
-- Triggers
-- ============================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, email, name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'name', split_part(coalesce(new.email, ''), '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists artists_updated_at on public.artists;
create trigger artists_updated_at before update on public.artists
  for each row execute procedure public.set_updated_at();
drop trigger if exists tracks_updated_at on public.tracks;
create trigger tracks_updated_at before update on public.tracks
  for each row execute procedure public.set_updated_at();
drop trigger if exists renders_updated_at on public.renders;
create trigger renders_updated_at before update on public.renders
  for each row execute procedure public.set_updated_at();
drop trigger if exists posts_updated_at on public.posts;
create trigger posts_updated_at before update on public.posts
  for each row execute procedure public.set_updated_at();
