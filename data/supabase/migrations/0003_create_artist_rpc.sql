-- Atomic artist creation: inserts an artists row and the caller's owner
-- membership in a single security-definer function so the flow doesn't
-- depend on the per-table INSERT policies being correctly applied at runtime.
--
-- Authorization: the function only writes if auth.uid() is non-null, so
-- anonymous calls are rejected. EXECUTE is granted to the `authenticated`
-- role only — anon and public callers cannot invoke it.

create or replace function public.create_artist_with_owner(
  p_name text,
  p_slug text
)
returns public.artists
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_artist public.artists;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'Artist name is required' using errcode = '22023';
  end if;
  if p_slug is null or length(trim(p_slug)) = 0 then
    raise exception 'Artist slug is required' using errcode = '22023';
  end if;

  insert into public.artists (name, slug)
  values (p_name, p_slug)
  returning * into v_artist;

  insert into public.artist_memberships (user_id, artist_id, role)
  values (v_user_id, v_artist.id, 'owner');

  return v_artist;
end;
$$;

revoke all on function public.create_artist_with_owner(text, text) from public;
grant execute on function public.create_artist_with_owner(text, text) to authenticated;
