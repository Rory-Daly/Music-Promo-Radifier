-- Track which Drive folder a gdrive-sourced clip was imported from, so the
-- vault can offer a folder-scoped sync that removes clips whose Drive file
-- has been deleted/moved out of the folder.
--
-- Existing rows stay null until they're re-imported (the import upsert will
-- stamp the folder_id then). Cleanup is therefore opt-in per folder.

alter table public.clips
  add column if not exists gdrive_folder_id text;

create index if not exists clips_gdrive_folder_id_idx
  on public.clips (artist_id, gdrive_folder_id)
  where gdrive_folder_id is not null;
