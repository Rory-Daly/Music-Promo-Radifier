-- Vendor swap: Ayrshare → Post-Pulse for social publishing.
-- The posts table carries the external publisher's post id. Renaming the
-- column to match the new vendor keeps the schema honest. Safe to rename
-- in place because the column is nullable and currently always written as
-- NULL by the only publish path (YouTube direct, see
-- src/app/api/posts/[id]/publish/route.ts) — no Post-Pulse integration has
-- shipped yet, so there is no real data to preserve.

alter table public.posts
  rename column ayrshare_post_id to post_pulse_post_id;
