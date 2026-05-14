import 'server-only'
import { createSupabaseServerClient } from './server'

export type Artist = {
  id: string
  name: string
  slug: string
  bio: string | null
  contact_email: string | null
  brand_kit: Record<string, unknown>
}

export type Membership = {
  artist_id: string
  role: 'owner' | 'collaborator'
  artists: Artist
}

export async function getCurrentUserAndArtists() {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { user: null, memberships: [] as Membership[] }

  const { data, error } = await supabase
    .from('artist_memberships')
    .select('artist_id, role, artists(id, name, slug, bio, contact_email, brand_kit)')
    .eq('user_id', user.id)
  if (error) {
    console.error('Failed to load memberships:', error.message)
    return { user, memberships: [] as Membership[] }
  }

  const memberships = (data ?? []).map((row) => ({
    artist_id: row.artist_id,
    role: row.role as 'owner' | 'collaborator',
    artists: row.artists as unknown as Artist,
  }))
  return { user, memberships }
}

export async function ensureFirstArtist(name: string): Promise<Artist | null> {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const { data: existing } = await supabase
    .from('artist_memberships')
    .select('artist_id')
    .eq('user_id', user.id)
    .limit(1)
  if (existing && existing.length > 0) return null

  const slug = slugify(name) + '-' + user.id.slice(0, 6)
  const { data: artist, error: artistError } = await supabase
    .from('artists')
    .insert({ name, slug })
    .select('id, name, slug, bio, contact_email, brand_kit')
    .single()
  if (artistError || !artist) {
    console.error('Failed to create first artist:', artistError?.message)
    return null
  }

  const { error: membershipError } = await supabase
    .from('artist_memberships')
    .insert({ user_id: user.id, artist_id: artist.id, role: 'owner' })
  if (membershipError) {
    console.error('Failed to create membership:', membershipError.message)
    return null
  }

  return artist as Artist
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
}
