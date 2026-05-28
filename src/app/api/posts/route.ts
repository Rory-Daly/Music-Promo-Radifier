import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { POST_PLATFORMS, type PostPlatform } from '@/lib/supabase/queries'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

const bodySchema = z.object({
  artistId: z.string().uuid(),
  platform: z.enum([...POST_PLATFORMS] as [PostPlatform, ...PostPlatform[]]),
  caption: z.string().max(5000).optional(),
  hashtags: z.array(z.string().max(64)).max(50).optional(),
  trackId: z.string().uuid().optional(),
  renderId: z.string().uuid().optional(),
  scheduledFor: z.string().datetime({ offset: true }).optional(),
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
  const { artistId, platform, caption, hashtags, trackId, renderId, scheduledFor } = parsed.data

  const { data: membership } = await supabase
    .from('artist_memberships')
    .select('artist_id')
    .eq('artist_id', artistId)
    .eq('user_id', user.id)
    .maybeSingle()
  if (!membership) return err('Not a member of this artist', 403, 'forbidden')

  const status = scheduledFor ? 'scheduled' : 'draft'

  const { data: post, error: insertError } = await supabase
    .from('posts')
    .insert({
      artist_id: artistId,
      platform,
      caption: caption ?? null,
      hashtags: hashtags ?? [],
      track_id: trackId ?? null,
      render_id: renderId ?? null,
      scheduled_for: scheduledFor ?? null,
      status,
    })
    .select('id')
    .single<{ id: string }>()
  if (insertError || !post) {
    return err(`Insert post failed: ${insertError?.message ?? 'unknown'}`, 500, 'insert_failed')
  }

  return NextResponse.json({ id: post.id, status }, { status: 201 })
}
