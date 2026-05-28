-- YouTube uses the same OAuth client and `artist_integrations` table as
-- the existing Drive integration, just with a different scope set
-- (youtube.upload + youtube.readonly) and a distinct provider value so
-- the two grants are stored as separate rows. Reuses the entire
-- start/callback/refresh machinery already in src/lib/oauth/.
--
-- We add 'youtube' to the provider check and rely on the existing
-- composite primary key (artist_id, provider) for upsert semantics.

alter table public.artist_integrations drop constraint if exists artist_integrations_provider_check;
alter table public.artist_integrations add constraint artist_integrations_provider_check check (
  provider in ('google_drive', 'youtube')
);
