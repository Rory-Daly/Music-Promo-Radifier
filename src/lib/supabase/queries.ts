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
  const { data, error } = await supabase
    .rpc('create_artist_with_owner', { p_name: name, p_slug: slug })
    .single<Artist>()
  if (error || !data) {
    console.error('Failed to create first artist:', error?.message)
    return null
  }
  return data
}

export type RenderRow = {
  id: string
  artist_id: string
  track_id: string | null
  status: 'queued' | 'rendering' | 'ready' | 'failed'
  output_url: string | null
  aspect_ratio: '9x16' | '1x1' | '16x9' | '4x5' | null
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
  slug: string
  source: 'upload' | 'soundcloud'
  external_url: string | null
  audio_url: string | null
  duration_seconds: number | null
  bpm: number | null
  created_at: string
}

export async function listTracks(artistId: string): Promise<TrackRow[]> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('tracks')
    .select(
      'id, artist_id, title, slug, source, external_url, audio_url, duration_seconds, bpm, created_at',
    )
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
  name: string | null
  storage_url: string | null
  gdrive_file_id: string | null
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
    .select(
      'id, artist_id, source, name, storage_url, gdrive_file_id, duration_seconds, width, height, thumbnail_url, created_at',
    )
    .eq('artist_id', artistId)
    .order('created_at', { ascending: false })
  if (error) {
    console.error('Failed to load clips:', error.message)
    return []
  }
  return (data ?? []) as ClipRow[]
}

export const POST_PLATFORMS = [
  'ig_reel',
  'ig_story',
  'ig_feed',
  'tiktok',
  'yt_short',
  'x',
  'threads',
  'fb',
] as const
export type PostPlatform = (typeof POST_PLATFORMS)[number]

export type PostStatus = 'draft' | 'scheduled' | 'published' | 'failed'

export type PostRow = {
  id: string
  artist_id: string
  track_id: string | null
  render_id: string | null
  platform: PostPlatform
  caption: string | null
  hashtags: string[]
  scheduled_for: string | null
  status: PostStatus
  permalink: string | null
  error: string | null
  created_at: string
  updated_at: string
  // Joined fields (nullable because the parent row may be missing)
  track_title: string | null
  render_output_url: string | null
  render_aspect_ratio: string | null
}

type PostJoinRow = {
  id: string
  artist_id: string
  track_id: string | null
  render_id: string | null
  platform: PostPlatform
  caption: string | null
  hashtags: string[] | null
  scheduled_for: string | null
  status: PostStatus
  permalink: string | null
  error: string | null
  created_at: string
  updated_at: string
  tracks: { title: string } | null
  renders: { output_url: string | null; aspect_ratio: string | null } | null
}

export async function listPosts(artistId: string): Promise<PostRow[]> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('posts')
    .select(
      `id, artist_id, track_id, render_id, platform, caption, hashtags,
       scheduled_for, status, permalink, error, created_at, updated_at,
       tracks(title),
       renders(output_url, aspect_ratio)`,
    )
    .eq('artist_id', artistId)
    .order('created_at', { ascending: false })
  if (error) {
    console.error('Failed to load posts:', error.message)
    return []
  }
  return (data ?? []).map((row) => {
    const r = row as unknown as PostJoinRow
    return {
      id: r.id,
      artist_id: r.artist_id,
      track_id: r.track_id,
      render_id: r.render_id,
      platform: r.platform,
      caption: r.caption,
      hashtags: r.hashtags ?? [],
      scheduled_for: r.scheduled_for,
      status: r.status,
      permalink: r.permalink,
      error: r.error,
      created_at: r.created_at,
      updated_at: r.updated_at,
      track_title: r.tracks?.title ?? null,
      render_output_url: r.renders?.output_url ?? null,
      render_aspect_ratio: r.renders?.aspect_ratio ?? null,
    }
  })
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
}
