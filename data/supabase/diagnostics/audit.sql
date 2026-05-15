-- Migration audit — paste this whole file into the Supabase SQL editor and
-- click Run. Output is ONE result set so the editor's last-statement-only
-- behaviour doesn't hide rows. Each row has: section, check, actual,
-- expected, status. Scan the status column for ✗.
--
-- Safe to run repeatedly; this script is read-only.
--
-- For deeper detail on a failing row, run the matching follow-up query
-- in the comments under each section.

with
public_tables as (
  select c.relname
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
    and c.relname in (
      'users', 'artists', 'artist_memberships', 'tracks',
      'clips', 'hooks', 'renders', 'posts'
    )
),
rls_enabled as (
  select c.relname
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
    and c.relrowsecurity = true
),
public_policies as (
  select tablename, policyname
  from pg_policies
  where schemaname = 'public'
),
helper_functions as (
  select p.proname
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in (
      'is_member_of', 'handle_new_user', 'set_updated_at',
      'storage_artist_id', 'create_artist_with_owner'
    )
),
auth_triggers as (
  select trigger_name
  from information_schema.triggers
  where event_object_schema = 'auth'
    and event_object_table = 'users'
    and trigger_name = 'on_auth_user_created'
),
updated_at_triggers as (
  select event_object_table, trigger_name
  from information_schema.triggers
  where event_object_schema = 'public'
    and trigger_name like '%_updated_at'
),
buckets as (
  select id, public
  from storage.buckets
  where id in ('tracks', 'clips', 'renders')
),
storage_policies as (
  select policyname
  from pg_policies
  where schemaname = 'storage'
    and tablename = 'objects'
    and policyname ~ '^(tracks|clips|renders)_(read|insert|update|delete)_member$'
),
rpc_grants as (
  select grantee
  from information_schema.routine_privileges
  where routine_schema = 'public'
    and routine_name = 'create_artist_with_owner'
    and privilege_type = 'EXECUTE'
)

select * from (
  -- ==========================================================================
  -- Section 1: Public tables exist
  -- ==========================================================================
  select
    1 as section,
    'Public tables present' as check_name,
    (select count(*)::text from public_tables) as actual,
    '8' as expected,
    case when (select count(*) from public_tables) = 8 then '✓' else '✗' end as status
  union all
  select
    1, 'RLS enabled on all 8 tables',
    (select count(*)::text from public_tables p join rls_enabled r on r.relname = p.relname),
    '8',
    case when (select count(*) from public_tables p join rls_enabled r on r.relname = p.relname) = 8 then '✓' else '✗' end

  union all
  -- ==========================================================================
  -- Section 2: RLS policies per table
  -- ==========================================================================
  select 2, 'policies on artists', (select count(*)::text from public_policies where tablename = 'artists'), '3',
    case when (select count(*) from public_policies where tablename = 'artists') = 3 then '✓' else '✗' end
  union all
  select 2, 'policies on artist_memberships', (select count(*)::text from public_policies where tablename = 'artist_memberships'), '3',
    case when (select count(*) from public_policies where tablename = 'artist_memberships') = 3 then '✓' else '✗' end
  union all
  select 2, 'policies on users', (select count(*)::text from public_policies where tablename = 'users'), '3',
    case when (select count(*) from public_policies where tablename = 'users') = 3 then '✓' else '✗' end
  union all
  select 2, 'policies on tracks', (select count(*)::text from public_policies where tablename = 'tracks'), '4',
    case when (select count(*) from public_policies where tablename = 'tracks') = 4 then '✓' else '✗' end
  union all
  select 2, 'policies on clips', (select count(*)::text from public_policies where tablename = 'clips'), '4',
    case when (select count(*) from public_policies where tablename = 'clips') = 4 then '✓' else '✗' end
  union all
  select 2, 'policies on renders', (select count(*)::text from public_policies where tablename = 'renders'), '4',
    case when (select count(*) from public_policies where tablename = 'renders') = 4 then '✓' else '✗' end
  union all
  select 2, 'policies on posts', (select count(*)::text from public_policies where tablename = 'posts'), '4',
    case when (select count(*) from public_policies where tablename = 'posts') = 4 then '✓' else '✗' end
  union all
  select 2, 'policies on hooks', (select count(*)::text from public_policies where tablename = 'hooks'), '3',
    case when (select count(*) from public_policies where tablename = 'hooks') = 3 then '✓' else '✗' end
  union all
  select 2, 'artists_insert_authed exists',
    case when exists (select 1 from public_policies where tablename = 'artists' and policyname = 'artists_insert_authed') then 'yes' else 'no' end,
    'yes',
    case when exists (select 1 from public_policies where tablename = 'artists' and policyname = 'artists_insert_authed') then '✓' else '✗' end

  union all
  -- ==========================================================================
  -- Section 3: helper functions
  -- ==========================================================================
  select 3, 'is_member_of() exists',
    case when exists (select 1 from helper_functions where proname = 'is_member_of') then 'yes' else 'no' end,
    'yes',
    case when exists (select 1 from helper_functions where proname = 'is_member_of') then '✓' else '✗' end
  union all
  select 3, 'handle_new_user() exists',
    case when exists (select 1 from helper_functions where proname = 'handle_new_user') then 'yes' else 'no' end,
    'yes',
    case when exists (select 1 from helper_functions where proname = 'handle_new_user') then '✓' else '✗' end
  union all
  select 3, 'set_updated_at() exists',
    case when exists (select 1 from helper_functions where proname = 'set_updated_at') then 'yes' else 'no' end,
    'yes',
    case when exists (select 1 from helper_functions where proname = 'set_updated_at') then '✓' else '✗' end
  union all
  select 3, 'storage_artist_id() exists',
    case when exists (select 1 from helper_functions where proname = 'storage_artist_id') then 'yes' else 'no' end,
    'yes',
    case when exists (select 1 from helper_functions where proname = 'storage_artist_id') then '✓' else '✗' end
  union all
  select 3, 'create_artist_with_owner() exists',
    case when exists (select 1 from helper_functions where proname = 'create_artist_with_owner') then 'yes' else 'no' end,
    'yes',
    case when exists (select 1 from helper_functions where proname = 'create_artist_with_owner') then '✓' else '✗' end

  union all
  -- ==========================================================================
  -- Section 4: triggers
  -- ==========================================================================
  select 4, 'on_auth_user_created trigger',
    case when exists (select 1 from auth_triggers) then 'yes' else 'no' end,
    'yes',
    case when exists (select 1 from auth_triggers) then '✓' else '✗' end
  union all
  select 4, 'updated_at triggers',
    (select count(*)::text from updated_at_triggers),
    '4',
    case when (select count(*) from updated_at_triggers) = 4 then '✓' else '✗' end

  union all
  -- ==========================================================================
  -- Section 5: storage buckets
  -- ==========================================================================
  select 5, 'tracks bucket',
    coalesce((select case when public then 'public' else 'private' end from buckets where id = 'tracks'), 'missing'),
    'private',
    case when (select public from buckets where id = 'tracks') = false then '✓' else '✗' end
  union all
  select 5, 'clips bucket',
    coalesce((select case when public then 'public' else 'private' end from buckets where id = 'clips'), 'missing'),
    'private',
    case when (select public from buckets where id = 'clips') = false then '✓' else '✗' end
  union all
  select 5, 'renders bucket',
    coalesce((select case when public then 'public' else 'private' end from buckets where id = 'renders'), 'missing'),
    'public',
    case when (select public from buckets where id = 'renders') = true then '✓' else '✗' end

  union all
  -- ==========================================================================
  -- Section 6: storage RLS policies (storage.objects)
  -- ==========================================================================
  select 6, 'storage.objects bucket policies',
    (select count(*)::text from storage_policies),
    '12',
    case when (select count(*) from storage_policies) = 12 then '✓' else '✗' end

  union all
  -- ==========================================================================
  -- Section 7: RPC grant
  -- ==========================================================================
  select 7, 'create_artist_with_owner grants',
    coalesce((select string_agg(grantee, ', ' order by grantee) from rpc_grants), '(none)'),
    'authenticated',
    case
      when (select array_agg(grantee order by grantee) from rpc_grants) = array['authenticated']::text[] then '✓'
      else '✗'
    end
) as audit
order by section, check_name;

-- ============================================================================
-- Follow-up queries (run individually if a row above shows ✗)
-- ============================================================================
--
-- List ALL policies on a specific table to see what's actually there:
--   select policyname, cmd, qual, with_check
--   from pg_policies where schemaname = 'public' and tablename = 'artists';
--
-- List ALL storage bucket policies:
--   select policyname, cmd from pg_policies
--   where schemaname = 'storage' and tablename = 'objects'
--   order by policyname;
--
-- List all functions in the public schema:
--   select proname, prosecdef from pg_proc p
--   join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' order by proname;
--
-- Drop & re-grant the RPC if section 7 shows ✗:
--   revoke execute on function public.create_artist_with_owner(text, text)
--     from public, anon, service_role;
--   grant execute on function public.create_artist_with_owner(text, text)
--     to authenticated;
