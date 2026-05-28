import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { getYouTubeAccessToken } from '@/lib/oauth/youtube-tokens'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { composeShortsMetadata, uploadVideo, YouTubeUploadError } from '@/lib/youtube/upload'

export const runtime = 'nodejs'
export const maxDuration = 300

const bodySchema = z.object({
  privacyStatus: z.enum(['public', 'unlisted', 'private']).optional(),
})

function err(message: string, status: number, code: string) {
  return NextResponse.json({ error: message, code }, { status })
}

type RouteContext = { params: Promise<{ id: string }> }

type PostJoinRow = {
  id: string
  artist_id: string
  status: string
  platform: string
  caption: string | null
  hashtags: string[] | null
  render_id: string | null
  renders: { output_url: string | null; aspect_ratio: string | null } | null
  tracks: { title: string } | null
  artists: { name: string } | null
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await context.params
  if (!z.string().uuid().safeParse(id).success) {
    return err('Invalid post id', 400, 'invalid_id')
  }

  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return err('Not authenticated', 401, 'unauthenticated')

  // Body is optional (privacy can be left to default 'public')
  let raw: unknown = null
  try {
    raw = await request.json()
  } catch {
    raw = {}
  }
  const parsed = bodySchema.safeParse(raw ?? {})
  if (!parsed.success) {
    return err(parsed.error.issues[0]?.message ?? 'Invalid body', 400, 'invalid_body')
  }
  const privacyStatus = parsed.data.privacyStatus ?? 'public'

  const { data: post } = await supabase
    .from('posts')
    .select(
      `id, artist_id, status, platform, caption, hashtags, render_id,
       renders(output_url, aspect_ratio),
       tracks(title),
       artists(name)`,
    )
    .eq('id', id)
    .maybeSingle<PostJoinRow>()
  if (!post) return err('Post not found', 404, 'not_found')
  if (post.status === 'published') {
    return err('Post is already published', 409, 'already_published')
  }
  if (post.platform !== 'yt_short') {
    return err(
      `Direct publishing not yet implemented for ${post.platform}. Copy the caption and post manually for now.`,
      501,
      'platform_not_supported',
    )
  }
  if (!post.render_id || !post.renders?.output_url) {
    return err('Post has no rendered video attached', 422, 'no_render')
  }

  const accessToken = await getYouTubeAccessToken(post.artist_id)
  if (!accessToken) {
    return err(
      'YouTube is not connected for this artist. Connect on the Posts page first.',
      412,
      'not_connected',
    )
  }

  // Fetch the rendered video from Supabase Storage. Renders bucket is
  // public so output_url is a direct GET — no signing needed.
  const videoRes = await fetch(post.renders.output_url)
  if (!videoRes.ok) {
    return err(
      `Could not download render: HTTP ${videoRes.status}`,
      502,
      'render_fetch_failed',
    )
  }
  const videoBytes = Buffer.from(await videoRes.arrayBuffer())
  const contentType = videoRes.headers.get('content-type') ?? 'video/mp4'

  const { title, description, tags } = composeShortsMetadata({
    caption: post.caption ?? '',
    hashtags: post.hashtags ?? [],
    trackTitle: post.tracks?.title ?? null,
    artistName: post.artists?.name ?? 'unknown',
  })

  let result
  try {
    result = await uploadVideo({
      accessToken,
      videoBytes,
      contentType,
      title,
      description,
      tags,
      privacyStatus,
      notifySubscribers: true,
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    const code = e instanceof YouTubeUploadError ? 'youtube_upload_failed' : 'unknown'

    // Mark the post as failed so the UI surfaces the error inline rather
    // than leaving it in a misleading 'draft' state.
    const admin = createSupabaseAdminClient()
    await admin
      .from('posts')
      .update({
        status: 'failed',
        error: message.slice(0, 500),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)

    return err(message, 502, code)
  }

  const admin = createSupabaseAdminClient()
  const { error: updateError } = await admin
    .from('posts')
    .update({
      status: 'published',
      permalink: result.watchUrl,
      ayrshare_post_id: null,
      error: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
  if (updateError) {
    // Video is on YouTube — surface the discrepancy rather than silently
    // failing. The user can manually fix the row, or we can build a
    // reconciliation flow later.
    return err(
      `Uploaded to YouTube (${result.videoId}) but updating the post failed: ${updateError.message}`,
      500,
      'partial_failure',
    )
  }

  return NextResponse.json(
    {
      ok: true,
      videoId: result.videoId,
      permalink: result.watchUrl,
    },
    { status: 200 },
  )
}
