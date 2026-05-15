import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { extractFolderId, listFolderVideos } from '@/lib/gdrive'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const maxDuration = 60

const bodySchema = z.object({
  artistId: z.string().uuid(),
  folder: z.string().min(1).max(512),
})

function err(message: string, status: number, code: string) {
  return NextResponse.json({ error: message, code }, { status })
}

export async function POST(request: NextRequest) {
  try {
    return await handle(request)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return err(`Unhandled: ${message}`, 500, 'unhandled')
  }
}

async function handle(request: NextRequest) {
  const apiKey = process.env.GOOGLE_API_KEY
  if (!apiKey) {
    return err(
      'GOOGLE_API_KEY is not set on the server. See docs/gdrive.md for setup.',
      500,
      'missing_env',
    )
  }

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
  const { artistId, folder } = parsed.data

  const folderId = extractFolderId(folder)
  if (!folderId) {
    return err(
      "Couldn't parse a folder ID from that input. Use the Drive folder URL or the bare ID.",
      400,
      'bad_folder',
    )
  }

  const { data: membership } = await supabase
    .from('artist_memberships')
    .select('artist_id')
    .eq('artist_id', artistId)
    .eq('user_id', user.id)
    .maybeSingle()
  if (!membership) return err('Not a member of this artist', 403, 'forbidden')

  let files
  try {
    files = await listFolderVideos(folderId, apiKey)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return err(`Drive folder lookup failed: ${message}`, 502, 'drive_failed')
  }
  if (files.length === 0) {
    return NextResponse.json(
      {
        imported: 0,
        total: 0,
        skipped: 0,
        message:
          'No video files found in that folder. Check the folder is shared "Anyone with the link" and contains videos.',
      },
      { status: 200 },
    )
  }

  // Skip files already imported for this artist.
  const { data: existing } = await supabase
    .from('clips')
    .select('gdrive_file_id')
    .eq('artist_id', artistId)
    .in(
      'gdrive_file_id',
      files.map((f) => f.id),
    )
  const existingSet = new Set((existing ?? []).map((r) => r.gdrive_file_id))
  const newFiles = files.filter((f) => !existingSet.has(f.id))

  if (newFiles.length === 0) {
    return NextResponse.json(
      {
        imported: 0,
        total: files.length,
        skipped: files.length,
        message: 'All files in that folder are already imported.',
      },
      { status: 200 },
    )
  }

  const rows = newFiles.map((f) => ({
    artist_id: artistId,
    source: 'gdrive' as const,
    gdrive_file_id: f.id,
    duration_seconds: f.durationSeconds,
    width: f.width,
    height: f.height,
    thumbnail_url: f.thumbnailLink,
  }))

  const { data: inserted, error: insertError } = await supabase
    .from('clips')
    .insert(rows)
    .select('id')
  if (insertError) {
    return err(`Insert failed: ${insertError.message}`, 500, 'insert_failed')
  }

  return NextResponse.json(
    {
      imported: inserted?.length ?? 0,
      total: files.length,
      skipped: files.length - newFiles.length,
    },
    { status: 201 },
  )
}
