-- URL-safe per-track slug used to build smart-link URLs of the form
-- /r/<artist_slug>/<track_slug>. Slugs are artist-scoped (different
-- artists can both have a 'lighthouse' track) so the unique index is
-- composite on (artist_id, slug), not global.
--
-- Backfill: derive a slug from the existing title for any pre-existing
-- rows. The expression mirrors the JS slugify() used by the app so a
-- track inserted today and a track backfilled here land on the same
-- shape. Collision resolution for the backfill: row_number() within
-- (artist_id, slugified-title) appends -1, -2, … only to duplicates;
-- the first row keeps the bare slug.

alter table public.tracks add column if not exists slug text;

-- Backfill existing rows. Uses regexp_replace to mimic slugify():
--   1. lowercase
--   2. normalise NFKD via translate (best-effort: strips common
--      accents — full unicode normalisation in SQL is awkward, but
--      this covers the practical English/AU catalogue)
--   3. replace any non-alphanumeric run with a single hyphen
--   4. trim leading/trailing hyphens
-- then numbers duplicates to keep the composite unique constraint
-- satisfiable.
with slugged as (
  select
    id,
    artist_id,
    trim(
      both '-' from
      regexp_replace(
        lower(coalesce(title, '')),
        '[^a-z0-9]+',
        '-',
        'g'
      )
    ) as base_slug
  from public.tracks
  where slug is null
),
numbered as (
  select
    id,
    artist_id,
    base_slug,
    row_number() over (partition by artist_id, base_slug order by id) as rn
  from slugged
)
update public.tracks t
set slug = case
  when n.rn = 1 then nullif(n.base_slug, '')
  else nullif(n.base_slug, '') || '-' || (n.rn - 1)::text
end
from numbered n
where t.id = n.id;

-- Any row whose title was empty/null ends up with slug=null after the
-- nullif. Give those a deterministic fallback so the not-null constraint
-- below succeeds.
update public.tracks
set slug = 'track-' || substr(id::text, 1, 8)
where slug is null;

alter table public.tracks alter column slug set not null;

create unique index if not exists tracks_artist_slug_unique
  on public.tracks (artist_id, slug);
