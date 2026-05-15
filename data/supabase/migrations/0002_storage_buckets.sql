-- Storage buckets for the vault and render outputs.
-- Convention: every object key is prefixed with the artist_id followed by '/'.
-- Example: '11111111-1111-1111-1111-111111111111/abc.mp4'.
-- RLS policies below check that prefix against artist_memberships.

insert into storage.buckets (id, name, public)
values
  ('tracks', 'tracks', false),
  ('clips', 'clips', false),
  ('renders', 'renders', true)
on conflict (id) do nothing;

-- Helper: extract artist_id from a storage object name (first path segment).
create or replace function public.storage_artist_id(name text)
returns uuid
language sql
immutable
as $$
  select case
    when name is null or position('/' in name) = 0 then null
    else nullif(split_part(name, '/', 1), '')::uuid
  end;
$$;

-- Read/write policies for each artist-scoped bucket.
do $$
declare
  b text;
begin
  foreach b in array array['tracks', 'clips', 'renders']
  loop
    execute format($p$drop policy if exists "%s_read_member" on storage.objects$p$, b);
    execute format($p$create policy "%s_read_member" on storage.objects for select
      using (bucket_id = %L and public.is_member_of(public.storage_artist_id(name)))$p$, b, b);

    execute format($p$drop policy if exists "%s_insert_member" on storage.objects$p$, b);
    execute format($p$create policy "%s_insert_member" on storage.objects for insert
      with check (bucket_id = %L and public.is_member_of(public.storage_artist_id(name)))$p$, b, b);

    execute format($p$drop policy if exists "%s_update_member" on storage.objects$p$, b);
    execute format($p$create policy "%s_update_member" on storage.objects for update
      using (bucket_id = %L and public.is_member_of(public.storage_artist_id(name)))$p$, b, b);

    execute format($p$drop policy if exists "%s_delete_member" on storage.objects$p$, b);
    execute format($p$create policy "%s_delete_member" on storage.objects for delete
      using (bucket_id = %L and public.is_member_of(public.storage_artist_id(name)))$p$, b, b);
  end loop;
end;
$$;
