-- Migration audit — paste this whole file into the Supabase SQL editor and
-- run it. Each section emits a single result set so you can scan for ✓ / ✗
-- rows. Compare the output against the "expected" comments to spot drift.
--
-- Safe to run repeatedly; this script is read-only.

-- ============================================================================
-- 1. Public tables that should exist
-- Expected: 8 rows — users, artists, artist_memberships, tracks, clips,
--           hooks, renders, posts. All with rls_enabled = true.
-- ============================================================================
select
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  case
    when c.relname in (
      'users', 'artists', 'artist_memberships', 'tracks',
      'clips', 'hooks', 'renders', 'posts'
    ) then '✓ expected'
    else '? unexpected'
  end as status
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
order by c.relname;

-- ============================================================================
-- 2. RLS policies on public tables
-- Expected (24 rows total):
--   users (3): users_read_self, users_update_self, users_insert_self
--   artists (3): artists_read_member, artists_insert_authed, artists_update_member
--   artist_memberships (3): memberships_read_self, memberships_insert_self,
--                           memberships_delete_self
--   tracks (4): tracks_read_member, tracks_insert_member,
--               tracks_update_member, tracks_delete_member
--   clips (4): clips_*_member (same as tracks)
--   renders (4): renders_*_member
--   posts (4): posts_*_member
--   hooks (3): hooks_read_member, hooks_insert_member, hooks_delete_member
-- ============================================================================
select
  schemaname,
  tablename,
  policyname,
  cmd as for_operation,
  qual as using_clause,
  with_check
from pg_policies
where schemaname = 'public'
order by tablename, policyname;

-- ============================================================================
-- 3. SECURITY DEFINER helper functions
-- Expected: is_member_of, handle_new_user, set_updated_at,
--           storage_artist_id, create_artist_with_owner
-- ============================================================================
select
  n.nspname as schema_name,
  p.proname as function_name,
  pg_get_function_arguments(p.oid) as arguments,
  case p.prosecdef when true then 'definer' else 'invoker' end as security
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'is_member_of', 'handle_new_user', 'set_updated_at',
    'storage_artist_id', 'create_artist_with_owner'
  )
order by p.proname;

-- ============================================================================
-- 4. Triggers that should be wired
-- Expected: on_auth_user_created (on auth.users), plus four
--           *_updated_at triggers on artists / tracks / renders / posts.
-- ============================================================================
select
  event_object_schema as schema_name,
  event_object_table as table_name,
  trigger_name,
  event_manipulation as event,
  action_timing as timing
from information_schema.triggers
where (event_object_schema = 'public' or
       (event_object_schema = 'auth' and event_object_table = 'users'))
order by event_object_schema, event_object_table, trigger_name;

-- ============================================================================
-- 5. Storage buckets
-- Expected: tracks (public=false), clips (public=false), renders (public=true)
-- ============================================================================
select id, name, public
from storage.buckets
where id in ('tracks', 'clips', 'renders')
order by id;

-- ============================================================================
-- 6. Storage RLS policies (on storage.objects)
-- Expected: 12 rows — for each of tracks/clips/renders, the four operations
--           (_read_member, _insert_member, _update_member, _delete_member).
-- ============================================================================
select policyname, cmd as for_operation
from pg_policies
where schemaname = 'storage'
  and tablename = 'objects'
  and policyname like any (array['tracks_%', 'clips_%', 'renders_%'])
order by policyname;

-- ============================================================================
-- 7. EXECUTE grant on create_artist_with_owner
-- Expected: one row with grantee = 'authenticated'.
-- ============================================================================
select grantee, privilege_type
from information_schema.routine_privileges
where routine_schema = 'public'
  and routine_name = 'create_artist_with_owner'
order by grantee;
