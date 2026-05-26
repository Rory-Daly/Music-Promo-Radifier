import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { findAvailableTrackSlug } from '@/lib/tracks/slug'
import { parseSoundCloudUrl } from '@/lib/tracks/soundcloud'

export const runtime = 'nodejs'

const bodySchema = z.object({
  artistId: z.string().uuid(),
  trackId: z.string().uuid(),
  url: z.string().min(1).max(2048),
  title: z.string().trim().min(1).max(200),
})

function err(message: string, status: number, code: string) {
  return NextResponse.json({ error: message, code }, { status })
}

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return err('Not authenticated', 401, 'unauthenticated')

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return err('Invalid JSON body', 400, 'invalid_json')
  }
  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) {
    return err(parsed.error.issues[0]?.message ?? 'Invalid body', 400, 'invalid_body')
  }
  const { artistId, trackId, url, title } = parsed.data

  const urlResult = parseSoundCloudUrl(url)
  if (!urlResult.ok) {
    return err(urlResult.reason, 400, 'invalid_url')
  }

  const { data: membership } = await supabase
    .from('artist_memberships')
    .select('artist_id')
    .eq('artist_id', artistId)
    .eq('user_id', user.id)
    .maybeSingle()
  if (!membership) return err('Not a member of this artist', 403, 'forbidden')

  const slug = await findAvailableTrackSlug(supabase, artistId, title)

  const { error: insertError } = await supabase.from('tracks').insert({
    id: trackId,
    artist_id: artistId,
    title,
    slug,
    source: 'soundcloud',
    external_url: urlResult.canonicalUrl,
  })
  if (insertError) {
    return err(`Insert track failed: ${insertError.message}`, 500, 'insert_failed')
  }

  return NextResponse.json({ trackId, title, slug }, { status: 201 })
}
