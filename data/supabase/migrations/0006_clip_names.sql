-- Add a display name to clips so the vault grid and compose picker can
-- identify them, then switch the gdrive dedup index from partial-unique
-- to plain-unique so we can use ON CONFLICT to upsert names onto rows
-- imported before this column existed.

alter table public.clips add column if not exists name text;

-- Postgres treats NULL as distinct in plain unique indexes (the default),
-- so multiple uploaded clips with null gdrive_file_id are still fine.
-- ON CONFLICT against a partial index requires repeating the index
-- predicate at the call site, which PostgREST doesn't expose — using a
-- plain unique index avoids that.

drop index if exists clips_artist_gdrive_unique;
create unique index if not exists clips_artist_gdrive_unique
  on public.clips (artist_id, gdrive_file_id);
