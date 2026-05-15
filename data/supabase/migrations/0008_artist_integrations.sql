-- Per-artist OAuth tokens for third-party providers (Google Drive first).
-- One row per (artist, provider). Tokens are written only by the server's
-- service-role admin client; no RLS read policy exists, so the anon /
-- authenticated tokens cannot pull them. The server-rendered vault page
-- queries this table via the admin client and passes a boolean
-- "connected" flag to the client component.

create table if not exists public.artist_integrations (
  artist_id uuid not null references public.artists(id) on delete cascade,
  provider text not null check (provider in ('google_drive')),
  access_token text not null,
  refresh_token text not null,
  expires_at timestamptz not null,
  scope text,
  connected_by uuid references public.users(id) on delete set null,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (artist_id, provider)
);

alter table public.artist_integrations enable row level security;

-- No SELECT/INSERT/UPDATE/DELETE policies are defined. RLS denies by
-- default, so members cannot read tokens directly — only the server's
-- service-role client can. Status checks happen server-side and only
-- the boolean is sent to the browser.

drop trigger if exists artist_integrations_updated_at on public.artist_integrations;
create trigger artist_integrations_updated_at before update on public.artist_integrations
  for each row execute procedure public.set_updated_at();
