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

export type RenderRow = {
  id: string
  artist_id: string
  track_id: string | null
  status: 'queued' | 'rendering' | 'ready' | 'failed'
  output_url: string | null
  aspect_ratio: '9x16' | '1x1' | '16x9' | null
  template_id: string | null
  error: string | null
  created_at: string
}

export async function listRecentRenders(artistId: string, limit = 6): Promise<RenderRow[]> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('renders')
    .select('id, artist_id, track_id, status, output_url, aspect_ratio, template_id, error, created_at')
    .eq('artist_id', artistId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) {
    console.error('Failed to load renders:', error.message)
    return []
  }
  return (data ?? []) as RenderRow[]
}

export type TrackRow = {
  id: string
  artist_id: string
  title: string
  audio_url: string | null
  duration_seconds: number | null
  bpm: number | null
  created_at: string
}

export async function listTracks(artistId: string): Promise<TrackRow[]> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('tracks')
    .select('id, artist_id, title, audio_url, duration_seconds, bpm, created_at')
    .eq('artist_id', artistId)
    .order('created_at', { ascending: false })
  if (error) {
    console.error('Failed to load tracks:', error.message)
    return []
  }
  return (data ?? []) as TrackRow[]
}

export type HookRow = {
  id: string
  track_id: string
  start_seconds: number
  end_seconds: number
  score: number | null
  label: string | null
}

export async function listHooksForTracks(trackIds: string[]): Promise<HookRow[]> {
  if (trackIds.length === 0) return []
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('hooks')
    .select('id, track_id, start_seconds, end_seconds, score, label')
    .in('track_id', trackIds)
    .order('score', { ascending: false })
  if (error) {
    console.error('Failed to load hooks:', error.message)
    return []
  }
  return (data ?? []) as HookRow[]
}

export type ClipRow = {
  id: string
  artist_id: string
  source: 'upload' | 'gdrive'
  storage_url: string | null
  duration_seconds: number | null
  width: number | null
  height: number | null
  thumbnail_url: string | null
  created_at: string
}

export async function listClips(artistId: string): Promise<ClipRow[]> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('clips')
    .select('id, artist_id, source, storage_url, duration_seconds, width, height, thumbnail_url, created_at')
    .eq('artist_id', artistId)
    .order('created_at', { ascending: false })
  if (error) {
    console.error('Failed to load clips:', error.message)
    return []
  }
  return (data ?? []) as ClipRow[]
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
}
