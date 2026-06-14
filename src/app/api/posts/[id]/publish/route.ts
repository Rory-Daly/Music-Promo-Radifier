import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { getYouTubeAccessToken } from '@/lib/oauth/youtube-tokens'
import {
  createPost,
  importMediaByUrl,
  PostPulseError,
  PostPulseNotConnectedError,
} from '@/lib/post-pulse/client'
import { getSocialConnection } from '@/lib/post-pulse/connections'
import {
  type AppPlatform,
  getPostPulseMapping,
  isPostPulseSupported,
} from '@/lib/post-pulse/platform-map'
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

type PostJoinRow = {
  id: string
  artist_id: string
  status: string
  platform: AppPlatform
  caption: string | null
  hashtags: string[] | null
  scheduled_for: string | null
  render_id: string | null
  renders: { output_url: string | null; aspect_ratio: string | null } | null
  tracks: { title: string } | null
  artists: { name: string } | null
}

type RouteContext = { params: Promise<{ id: string }> }

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

  // Body is optional for non-YouTube platforms; YouTube uses privacyStatus.
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

  const { data: post } = await supabase
    .from('posts')
    .select(
      `id, artist_id, status, platform, caption, hashtags, scheduled_for, render_id,
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
  if (!post.render_id || !post.renders?.output_url) {
    return err('Post has no rendered video attached', 422, 'no_render')
  }

  if (post.platform === 'yt_short') {
    return publishYouTube({
      post,
      privacyStatus: parsed.data.privacyStatus ?? 'public',
    })
  }

  if (!isPostPulseSupported(post.platform)) {
    return err(
      `Direct publishing not yet implemented for ${post.platform}.`,
      501,
      'platform_not_supported',
    )
  }

  return publishViaPostPulse({ post })
}

async function publishYouTube({
  post,
  privacyStatus,
}: {
  post: PostJoinRow
  privacyStatus: 'public' | 'unlisted' | 'private'
}) {
  if (!post.renders?.output_url) return err('Missing render', 422, 'no_render')

  const accessToken = await getYouTubeAccessToken(post.artist_id)
  if (!accessToken) {
    return err(
      'YouTube is not connected for this artist. Connect on the Posts page first.',
      412,
      'not_connected',
    )
  }

  const videoRes = await fetch(post.renders.output_url)
  if (!videoRes.ok) {
    return err(`Could not download render: HTTP ${videoRes.status}`, 502, 'render_fetch_failed')
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
    await markPostFailed(post.id, message)
    return err(message, 502, code)
  }

  const admin = createSupabaseAdminClient()
  const { error: updateError } = await admin
    .from('posts')
    .update({
      status: 'published',
      permalink: result.watchUrl,
      post_pulse_post_id: null,
      error: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', post.id)
  if (updateError) {
    return err(
      `Uploaded to YouTube (${result.videoId}) but updating the post failed: ${updateError.message}`,
      500,
      'partial_failure',
    )
  }

  return NextResponse.json({ ok: true, videoId: result.videoId, permalink: result.watchUrl })
}

async function publishViaPostPulse({ post }: { post: PostJoinRow }) {
  if (!post.renders?.output_url) return err('Missing render', 422, 'no_render')

  const connection = await getSocialConnection(post.artist_id, post.platform)
  if (!connection) {
    return err(
      `No Post-Pulse connection for ${post.platform}. Link an account on /settings first.`,
      412,
      'not_connected',
    )
  }

  const mapping = getPostPulseMapping(post.platform)
  const content = composePostPulseContent({
    caption: post.caption ?? '',
    hashtags: post.hashtags ?? [],
    captionMaxChars: mapping.captionMaxChars,
  })

  let mediaPath: string
  try {
    const imported = await importMediaByUrl(post.renders.output_url)
    mediaPath = imported.path
  } catch (e) {
    if (e instanceof PostPulseNotConnectedError) {
      return err(e.message, 412, 'post_pulse_not_connected')
    }
    const message = e instanceof Error ? e.message : 'Unknown media import error'
    await markPostFailed(post.id, message)
    return err(message, 502, 'media_import_failed')
  }

  // If scheduled in the past (or null), publish immediately. Otherwise let
  // Post-Pulse hold it until scheduled_for — they fire the actual publish.
  let scheduledTime: string | null = null
  if (post.scheduled_for) {
    const scheduledMs = new Date(post.scheduled_for).getTime()
    if (scheduledMs > Date.now()) scheduledTime = new Date(scheduledMs).toISOString()
  }

  let result
  try {
    result = await createPost({
      socialMediaAccountId: connection.social_media_account_id,
      platformSettings: mapping.buildPlatformSettings(),
      content,
      attachmentPath: mediaPath,
      scheduledTime,
    })
  } catch (e) {
    if (e instanceof PostPulseNotConnectedError) {
      return err(e.message, 412, 'post_pulse_not_connected')
    }
    const message =
      e instanceof PostPulseError
        ? e.message
        : e instanceof Error
          ? e.message
          : 'Unknown Post-Pulse error'
    await markPostFailed(post.id, message)
    return err(message, 502, 'post_pulse_failed')
  }

  // Webhook is the source of truth either way: immediate or scheduled,
  // 'published' only flips on Post-Pulse's success callback. Local status
  // stays 'scheduled' until then so the UI shows in-flight, not done.
  const admin = createSupabaseAdminClient()
  const { error: updateError } = await admin
    .from('posts')
    .update({
      status: 'scheduled',
      post_pulse_post_id: String(result.id),
      error: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', post.id)
  if (updateError) {
    return err(
      `Sent to Post-Pulse (id ${result.id}) but updating the post failed: ${updateError.message}`,
      500,
      'partial_failure',
    )
  }

  return NextResponse.json({
    ok: true,
    postPulsePostId: String(result.id),
    overallStatus: result.overallStatus,
    scheduledTime: result.scheduledTime,
  })
}

function composePostPulseContent(input: {
  caption: string
  hashtags: string[]
  captionMaxChars: number
}): string {
  const captionTrimmed = input.caption.trim()
  const tags = input.hashtags
    .map((t) => (t.startsWith('#') ? t : `#${t}`))
    .filter((t) => !new RegExp(`(^|\\s)${escapeRegex(t)}(\\s|$)`, 'i').test(captionTrimmed))
  const composed = [captionTrimmed, tags.join(' ')].filter(Boolean).join('\n\n')
  if (composed.length <= input.captionMaxChars) return composed
  return composed.slice(0, input.captionMaxChars - 1) + '…'
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function markPostFailed(postId: string, message: string) {
  const admin = createSupabaseAdminClient()
  await admin
    .from('posts')
    .update({
      status: 'failed',
      error: message.slice(0, 500),
      updated_at: new Date().toISOString(),
    })
    .eq('id', postId)
}
