-- Per-(artist, platform) link to a Post-Pulse social account.
--
-- Post-Pulse uses one workspace-level API key (POST_PULSE_API_KEY) for all
-- publishing — there is no per-account OAuth token to store on our side.
-- What changes per (artist, platform) is the numeric `socialMediaAccountId`
-- that Post-Pulse assigns to each connected account in their dashboard.
-- That ID, plus a display handle for the UI, is everything we need.
--
-- We deliberately do NOT extend `artist_integrations` because that table
-- assumes OAuth tokens with refresh — none of which applies here. Keeping
-- the two separate also keeps RLS reasoning simpler.
--
-- Platform check mirrors `posts.platform` (migration 0015). The platform
-- enum string is the Legatograph-internal one, not the Post-Pulse
-- `platformSettings.type` string — the mapping lives in
-- src/lib/post-pulse/platform-map.ts.

create table if not exists public.social_connections (
  artist_id uuid not null references public.artists(id) on delete cascade,
  platform text not null check (platform in ('ig_reel', 'ig_story', 'ig_feed', 'tiktok', 'yt_short', 'x', 'threads', 'fb')),
  social_media_account_id bigint not null,
  display_handle text,
  connected_by uuid references public.users(id) on delete set null,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (artist_id, platform)
);

create index if not exists social_connections_artist_id_idx on public.social_connections(artist_id);

alter table public.social_connections enable row level security;

-- Members of an artist can read connection metadata (display_handle,
-- which platforms are wired) to render the Settings page; the
-- socialMediaAccountId isn't a secret in itself (it identifies an
-- account inside the Post-Pulse workspace), but we keep the table
-- service-role-write to funnel changes through the API.
drop policy if exists "social_connections_read_member" on public.social_connections;
create policy "social_connections_read_member" on public.social_connections
  for select using (public.is_member_of(artist_id));

drop trigger if exists social_connections_updated_at on public.social_connections;
create trigger social_connections_updated_at before update on public.social_connections
  for each row execute procedure public.set_updated_at();
