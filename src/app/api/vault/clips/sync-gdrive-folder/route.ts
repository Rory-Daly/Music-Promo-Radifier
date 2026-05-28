import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { findOrphans, type FolderClipRow } from '@/lib/clips/folder-diff'
import { extractFolderId, listFolderVideos, type DriveAuth } from '@/lib/gdrive'
import { getDriveAccessToken } from '@/lib/oauth/drive-tokens'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const maxDuration = 60

const bodySchema = z.object({
  artistId: z.string().uuid(),
  folder: z.string().min(1).max(512),
  confirm: z.boolean().optional(),
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
  const { artistId, folder, confirm } = parsed.data

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

  // List what's currently in the folder. If Drive auth has lapsed or the
  // share was revoked this can return [] — which would look like every
  // clip is orphaned. The preview-then-confirm flow gives the user a
  // chance to back out, but we also flag empty-folder results explicitly.
  let driveFileIds: string[]
  try {
    const files = await listFolderVideos(folderId, auth)
    driveFileIds = files.map((f) => f.id)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return err(`Drive folder lookup failed: ${message}`, 502, 'drive_failed')
  }

  const { data: clipsForFolder, error: selectError } = await supabase
    .from('clips')
    .select('id, name, gdrive_file_id, thumbnail_url')
    .eq('artist_id', artistId)
    .eq('gdrive_folder_id', folderId)
  if (selectError) {
    return err(`Clip lookup failed: ${selectError.message}`, 500, 'select_failed')
  }

  const orphans = findOrphans((clipsForFolder ?? []) as FolderClipRow[], driveFileIds)

  if (!confirm) {
    return NextResponse.json(
      {
        folderId,
        driveFileCount: driveFileIds.length,
        clipsTrackedForFolder: clipsForFolder?.length ?? 0,
        orphans: orphans.map((o) => ({ id: o.id, name: o.name })),
      },
      { status: 200 },
    )
  }

  if (orphans.length === 0) {
    return NextResponse.json(
      { folderId, deleted: 0, thumbnailsRemoved: 0 },
      { status: 200 },
    )
  }

  // Delete clip rows under the user's session so RLS enforces ownership.
  const orphanIds = orphans.map((o) => o.id)
  const { error: deleteError } = await supabase
    .from('clips')
    .delete()
    .eq('artist_id', artistId)
    .in('id', orphanIds)
  if (deleteError) {
    return err(`Delete failed: ${deleteError.message}`, 500, 'delete_failed')
  }

  // Best-effort thumbnail cleanup. Failures don't fail the request — the
  // DB row is already gone, and the orphaned blob is harmless.
  const admin = createSupabaseAdminClient()
  const thumbnailPaths = orphans.map((o) => `${artistId}/${o.id}.jpg`)
  let thumbnailsRemoved = 0
  if (thumbnailPaths.length > 0) {
    const { data: removed } = await admin.storage.from('thumbnails').remove(thumbnailPaths)
    thumbnailsRemoved = removed?.length ?? 0
  }

  return NextResponse.json(
    {
      folderId,
      deleted: orphans.length,
      thumbnailsRemoved,
      names: orphans.map((o) => o.name),
    },
    { status: 200 },
  )
}

async function resolveDriveAuth(artistId: string): Promise<DriveAuth | null> {
  const accessToken = await getDriveAccessToken(artistId)
  if (accessToken) return { kind: 'oauth', accessToken }
  const apiKey = process.env.GOOGLE_API_KEY
  if (apiKey) return { kind: 'apiKey', apiKey }
  return null
}
