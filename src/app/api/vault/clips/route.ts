import { extname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const maxDuration = 300

const ALLOWED_VIDEO_EXT = new Set(['.mp4', '.mov', '.m4v', '.webm', '.avi', '.mkv'])
const MAX_CLIP_BYTES = 512 * 1024 * 1024 // 512 MB

function err(message: string, status: number, code: string) {
  return NextResponse.json({ error: message, code }, { status })
}

export async function POST(request: NextRequest) {
  try {
    return await handle(request)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    if (/body size|413|payload/i.test(message)) {
      return err(`Upload exceeded server body limit. ${message}`, 413, 'body_too_large')
    }
    return err(`Upload failed: ${message}`, 500, 'unhandled')
  }
}

async function handle(request: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return err('Not authenticated', 401, 'unauthenticated')

  const form = await request.formData()
  const file = form.get('file')
  const artistId = String(form.get('artistId') ?? '')
  const tagsRaw = String(form.get('tags') ?? '').trim()

  if (!(file instanceof File)) return err('Missing file', 400, 'missing_file')
  if (!artistId) return err('Missing artistId', 400, 'missing_artist')
  if (file.size === 0) return err('Empty file', 400, 'empty_file')
  if (file.size > MAX_CLIP_BYTES) return err('File exceeds 512 MB', 413, 'file_too_large')
  const ext = extname(file.name).toLowerCase()
  if (!ALLOWED_VIDEO_EXT.has(ext)) {
    return err(`Unsupported video format: ${ext}`, 415, 'unsupported_format')
  }

  const { data: membership } = await supabase
    .from('artist_memberships')
    .select('artist_id')
    .eq('artist_id', artistId)
    .eq('user_id', user.id)
    .maybeSingle()
  if (!membership) return err('Not a member of this artist', 403, 'forbidden')

  const clipId = randomUUID()
  const objectKey = `${artistId}/${clipId}${ext}`

  const bytes = Buffer.from(await file.arrayBuffer())

  const { error: uploadError } = await supabase.storage
    .from('clips')
    .upload(objectKey, bytes, {
      contentType: file.type || 'application/octet-stream',
      upsert: false,
    })
  if (uploadError) return err(`Upload failed: ${uploadError.message}`, 500, 'upload_failed')

  const tags = tagsRaw
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .slice(0, 10)

  const { data: clip, error: insertError } = await supabase
    .from('clips')
    .insert({
      id: clipId,
      artist_id: artistId,
      source: 'upload',
      storage_url: `clips/${objectKey}`,
      tags,
    })
    .select('id')
    .single<{ id: string }>()
  if (insertError || !clip) {
    await supabase.storage.from('clips').remove([objectKey]).catch(() => {})
    return err(`Insert clip failed: ${insertError?.message ?? 'unknown'}`, 500, 'insert_failed')
  }

  return NextResponse.json({ clipId, fileName: file.name }, { status: 201 })
}
