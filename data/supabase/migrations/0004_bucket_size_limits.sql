-- Cap the per-file size on each storage bucket so oversize uploads get
-- a clean HTTP 413 from Supabase Storage rather than stalling for minutes
-- on a doomed transfer. The same numbers are enforced client-side in
-- src/app/vault/VaultClient.tsx; keep them in sync if you change one.
--
-- 512 MB for audio masters (WAV from a DAW bounces at ~10-20 MB/min,
-- so this fits a 25+ minute master).
-- 2 GB for video clips (a transcoded 4K H.264 reel-source clip should
-- land at 200-500 MB; 2 GB is a generous safety margin).
-- 1 GB for rendered reels (9:16 H.264 outputs at our settings come in
-- under 200 MB even for the longest reels).

update storage.buckets set file_size_limit = 536870912 where id = 'tracks';     -- 512 MB
update storage.buckets set file_size_limit = 2147483648 where id = 'clips';     -- 2 GB
update storage.buckets set file_size_limit = 1073741824 where id = 'renders';   -- 1 GB
