import { randomUUID } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { extractDriveThumbnail } from '@/lib/clips/extract-thumbnail'
import { extractFolderId, listFolderVideos, type DriveAuth, type DriveFile } from '@/lib/gdrive'
import { getDriveAccessToken } from '@/lib/oauth/drive-tokens'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const maxDuration = 300

const THUMBNAIL_CONCURRENCY = 3

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

type ExistingRow = { id: string; gdrive_file_id: string | null; thumbnail_url: string | null }

async function handle(request: NextRequest) {
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
    return err("Couldn't parse a folder ID from that input.", 400, 'bad_folder')
  }

  const { data: membership } = await supabase
    .from('artist_memberships')
    .select('artist_id')
    .eq('artist_id', artistId)
    .eq('user_id', user.id)
    .maybeSingle()
  if (!membership) return err('Not a member of this artist', 403, 'forbidden')

  const auth = await resolveDriveAuth(artistId)
  if (!auth) {
    return err(
      'No Drive auth configured. Connect Google Drive from the vault, or set GOOGLE_API_KEY on the server. See docs/gdrive.md.',
      500,
      'no_auth',
    )
  }

  let files: DriveFile[]
  try {
    files = await listFolderVideos(folderId, auth)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return err(`Drive folder lookup failed: ${message}`, 502, 'drive_failed')
  }
  if (files.length === 0) {
    return NextResponse.json(
      {
        imported: 0,
        updated: 0,
        thumbnails: 0,
        message: 'No video files found. Confirm the folder is shared "Anyone with the link".',
      },
      { status: 200 },
    )
  }

  // Look up any clips this artist already has for these Drive file IDs so
  // we can reuse their UUIDs (and skip thumbnail generation for ones that
  // already have a thumbnail).
  const { data: existing } = await supabase
    .from('clips')
    .select('id, gdrive_file_id, thumbnail_url')
    .eq('artist_id', artistId)
    .in(
      'gdrive_file_id',
      files.map((f) => f.id),
    )
  const existingByFileId = new Map<string, ExistingRow>(
    ((existing ?? []) as ExistingRow[])
      .filter((r): r is ExistingRow & { gdrive_file_id: string } => r.gdrive_file_id !== null)
      .map((r) => [r.gdrive_file_id, r]),
  )

  // A thumbnail_url is "ours" if it lives under our Supabase project's
  // thumbnails bucket. Anything else (null, a stale Drive auth-gated URL
  // from older imports, etc.) we treat as missing and try to regenerate.
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const ourThumbnailPrefix = `${supabaseUrl}/storage/v1/object/public/thumbnails/`
  const isOurThumbnail = (url: string | null | undefined) =>
    !!supabaseUrl && !!url && url.startsWith(ourThumbnailPrefix)

  // Decide work per file: clip UUID, whether we need a fresh thumbnail.
  type WorkItem = {
    file: DriveFile
    clipId: string
    needsThumbnail: boolean
    isNew: boolean
  }
  const work: WorkItem[] = files.map((file) => {
    const ex = existingByFileId.get(file.id)
    return {
      file,
      clipId: ex?.id ?? randomUUID(),
      needsThumbnail: !isOurThumbnail(ex?.thumbnail_url),
      isNew: !ex,
    }
  })

  // Generate thumbnails in parallel (capped) and upload to the thumbnails
  // bucket via the admin client so we don't depend on the user's session
  // for a server-side concurrent operation.
  const admin = createSupabaseAdminClient()
  const thumbnailUrls = new Map<string, string>()
  const failures: Array<{ name: string; reason: string }> = []
  let thumbnailsMade = 0
  await withConcurrency(work, THUMBNAIL_CONCURRENCY, async (w) => {
    if (!w.needsThumbnail) return
    const result = await extractDriveThumbnail(w.file.id, auth, w.file.size)
    if (!result.ok) {
      failures.push({ name: w.file.name, reason: result.error })
      return
    }
    const path = `${artistId}/${w.clipId}.jpg`
    const { error: uploadError } = await admin.storage
      .from('thumbnails')
      .upload(path, result.buffer, { contentType: 'image/jpeg', upsert: true })
    if (uploadError) {
      failures.push({ name: w.file.name, reason: `Upload to thumbnails bucket failed: ${uploadError.message}` })
      return
    }
    const { data } = admin.storage.from('thumbnails').getPublicUrl(path)
    thumbnailUrls.set(w.file.id, data.publicUrl)
    thumbnailsMade++
  })

  // Build upsert payload. `tags` is omitted on purpose — Postgres
  // preserves the existing column on update, and uses its default `{}`
  // on insert.
  //
  // thumbnail_url resolution order:
  //   1. URL just generated this run.
  //   2. Existing URL if it lives in our bucket (already valid).
  //   3. null — clears stale legacy Drive URLs from older imports so the
  //      UI can fall back to the lh3 placeholder or "thumbnail unavailable"
  //      without showing a broken auth-gated image.
  const rows = work.map((w) => {
    const existingRow = existingByFileId.get(w.file.id)
    const generated = thumbnailUrls.get(w.file.id) ?? null
    const keepExisting = isOurThumbnail(existingRow?.thumbnail_url)
      ? existingRow!.thumbnail_url
      : null
    return {
      id: w.clipId,
      artist_id: artistId,
      source: 'gdrive' as const,
      gdrive_file_id: w.file.id,
      gdrive_folder_id: folderId,
      name: w.file.name,
      duration_seconds: w.file.durationSeconds,
      width: w.file.width,
      height: w.file.height,
      thumbnail_url: generated ?? keepExisting,
    }
  })

  const { error: upsertError } = await supabase
    .from('clips')
    .upsert(rows, { onConflict: 'artist_id,gdrive_file_id' })
  if (upsertError) {
    return err(`Upsert failed: ${upsertError.message}`, 500, 'upsert_failed')
  }

  const inserted = work.filter((w) => w.isNew).length
  const updated = work.length - inserted
  return NextResponse.json(
    {
      imported: inserted,
      updated,
      thumbnails: thumbnailsMade,
      total: files.length,
      thumbnailFailures: failures,
    },
    { status: 201 },
  )
}

async function resolveDriveAuth(artistId: string): Promise<DriveAuth | null> {
  const accessToken = await getDriveAccessToken(artistId)
  if (accessToken) return { kind: 'oauth', accessToken }
  const apiKey = process.env.GOOGLE_API_KEY
  if (apiKey) return { kind: 'apiKey', apiKey }
  return null
}

async function withConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let index = 0
  async function worker() {
    while (index < items.length) {
      const i = index++
      await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
}
