-- Raise the renders bucket cap to 2 GB. Even with CRF 23 (set in
-- scripts/lib/compose.ts), a long 16:9 hook + multi-clip composition can
-- exceed the previous 1 GB ceiling on first render. 2 GB matches the
-- clips bucket and is well within Supabase Storage's defaults.
--
-- This is a relaxation of an existing limit, not a new column or table —
-- safe to apply at any time, no downtime, no data migration.

update storage.buckets set file_size_limit = 2147483648 where id = 'renders';   -- 2 GB
