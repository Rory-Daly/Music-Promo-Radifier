-- Tracks can now be created from an external source (SoundCloud) without
-- uploading audio. This unblocks the smart-link page for catalogue tracks
-- that already live on SoundCloud — no need to bounce a master and re-host
-- just to claim the /r/<artist>/<track> URL.
--
-- `source = 'upload'` keeps the existing flow (Supabase Storage path in
-- `audio_url`, hooks auto-detected from local FFmpeg analysis).
-- `source = 'soundcloud'` stores the SoundCloud track URL in `external_url`,
-- leaves `audio_url` null, and skips hook detection (no audio file).
--
-- Future external sources (Bandcamp embeds, YouTube, etc.) can extend the
-- check constraint additively.

alter table public.tracks
  add column if not exists source text not null default 'upload'
    check (source in ('upload', 'soundcloud'));

alter table public.tracks
  add column if not exists external_url text;

-- Either an audio file (upload) or an external URL (soundcloud) must be
-- present. Enforced via a check constraint so future code can rely on it.
alter table public.tracks drop constraint if exists tracks_source_target_check;
alter table public.tracks add constraint tracks_source_target_check check (
  (source = 'upload'     and audio_url is not null)
  or
  (source = 'soundcloud' and external_url is not null)
);
