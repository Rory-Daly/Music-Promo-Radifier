-- Posts table needed two small refinements before the v1 publishing UI:
--
-- 1. track_id (nullable). Spec didn't include it because the original
--    plan was to link posts through `render_id` only. In practice we want
--    a post to retain track context even when no render is attached
--    (e.g. a SoundCloud-sourced track that hasn't been rendered yet, or a
--    behind-the-scenes post drafted before the render queues). Nullable
--    because the spec semantics for "freeform" posts still hold.
--
-- 2. Platform check constraint. The column was previously plain `text`
--    with no enum guard; tightening it to the same set the captions
--    endpoint and Ayrshare integration use prevents typo'd platform
--    values from getting saved.

alter table public.posts
  add column if not exists track_id uuid references public.tracks(id) on delete set null;

create index if not exists posts_track_id_idx on public.posts(track_id);

alter table public.posts drop constraint if exists posts_platform_check;
alter table public.posts add constraint posts_platform_check check (
  platform in ('ig_reel', 'ig_story', 'ig_feed', 'tiktok', 'yt_short', 'x', 'threads', 'fb')
);
