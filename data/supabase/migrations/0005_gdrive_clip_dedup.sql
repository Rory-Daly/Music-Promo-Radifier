-- Prevent duplicate Drive imports: each (artist_id, gdrive_file_id) pair
-- can only appear once in clips. Partial index because not every clip row
-- has a gdrive_file_id (uploaded clips have null here).

create unique index if not exists clips_artist_gdrive_unique
  on public.clips (artist_id, gdrive_file_id)
  where gdrive_file_id is not null;
