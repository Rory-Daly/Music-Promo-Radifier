import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'

const MAX_SLUG_LENGTH = 60

/**
 * Convert a track title into a URL-safe slug. Mirrors the SQL backfill in
 * migration 0012 so a slug computed here matches one computed at the DB
 * for the same input.
 */
export function slugifyTitle(title: string): string {
  const base = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritics
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
  return base.length > 0 ? base : 'track'
}

/**
 * Find a slug that doesn't collide with any existing track for this artist.
 * Tries the bare slug, then -1, -2, … up to a sensible cap. Returns the
 * first available value.
 */
export async function findAvailableTrackSlug(
  client: SupabaseClient,
  artistId: string,
  desired: string,
): Promise<string> {
  const base = slugifyTitle(desired)
  const { data, error } = await client
    .from('tracks')
    .select('slug')
    .eq('artist_id', artistId)
    .or(`slug.eq.${base},slug.like.${base}-%`)
  if (error) throw new Error(`Slug lookup failed: ${error.message}`)

  const taken = new Set((data ?? []).map((row) => row.slug as string))
  if (!taken.has(base)) return base
  for (let i = 1; i < 1000; i++) {
    const candidate = `${base}-${i}`
    if (!taken.has(candidate)) return candidate
  }
  // Pathological collision case — extremely unlikely. Fall back to a
  // UUID-suffixed slug rather than throwing, since the caller has already
  // committed to inserting.
  return `${base}-${crypto.randomUUID().slice(0, 8)}`
}
