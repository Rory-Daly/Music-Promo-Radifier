-- Workspace-level OAuth tokens for Post-Pulse.
--
-- Post-Pulse no longer issues static workspace API keys; the only path
-- for "Direct API integration" is the authorization-code OAuth flow.
-- One token set publishes on behalf of every social account connected
-- in the Post-Pulse workspace, so this is a single-row table — not
-- per-artist like `artist_integrations`.
--
-- Tokens are written and read only via the service-role admin client.
-- No RLS read/write policies — RLS denies by default, so the anon and
-- authenticated keys can't pull the row. The Settings page reads a
-- boolean "connected" flag server-side and ships only that to the
-- browser.

create table if not exists public.post_pulse_workspace (
  id text primary key default 'default' check (id = 'default'),
  access_token text not null,
  refresh_token text not null,
  expires_at timestamptz not null,
  scope text,
  connected_by uuid references public.users(id) on delete set null,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.post_pulse_workspace enable row level security;

-- No SELECT / INSERT / UPDATE / DELETE policies. RLS-deny-by-default is
-- the security boundary; only the server's service-role client touches
-- this table.

drop trigger if exists post_pulse_workspace_updated_at on public.post_pulse_workspace;
create trigger post_pulse_workspace_updated_at before update on public.post_pulse_workspace
  for each row execute procedure public.set_updated_at();
