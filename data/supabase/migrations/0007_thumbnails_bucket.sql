-- Public bucket for clip thumbnails generated server-side via ffmpeg.
-- Reads are unrestricted (so <img> tags load without signing); writes are
-- gated on artist membership via the same storage_artist_id() helper that
-- secures the tracks/clips/renders buckets.

insert into storage.buckets (id, name, public, file_size_limit)
values ('thumbnails', 'thumbnails', true, 10485760)
on conflict (id) do nothing;

drop policy if exists "thumbnails_insert_member" on storage.objects;
create policy "thumbnails_insert_member" on storage.objects for insert
  with check (bucket_id = 'thumbnails' and public.is_member_of(public.storage_artist_id(name)));

drop policy if exists "thumbnails_update_member" on storage.objects;
create policy "thumbnails_update_member" on storage.objects for update
  using (bucket_id = 'thumbnails' and public.is_member_of(public.storage_artist_id(name)));

drop policy if exists "thumbnails_delete_member" on storage.objects;
create policy "thumbnails_delete_member" on storage.objects for delete
  using (bucket_id = 'thumbnails' and public.is_member_of(public.storage_artist_id(name)));
