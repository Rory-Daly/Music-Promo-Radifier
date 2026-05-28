import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * Weekly housekeeping: delete `failed` renders older than 30 days and the
 * storage objects they wrote (if any). Keeps the renders bucket from growing
 * unbounded with the by-product of doomed render attempts.
 *
 * Auth: Vercel cron jobs send `Authorization: Bearer <CRON_SECRET>` when the
 * env var is set. We reject anything else so the endpoint can't be hit
 * manually by an attacker who finds it.
 *
 * Scope: only `status = 'failed'`. Successful renders are retained
 * indefinitely — they're part of the artist's published / shared output and
 * have permalink URLs out in the world. A separate, much more cautious job
 * would be needed to prune those.
 */

const STATUS_TO_DELETE = 'failed'
const AGE_DAYS = 30

export async function GET(request: NextRequest) {
  return handle(request)
}

export async function POST(request: NextRequest) {
  return handle(request)
}

async function handle(request: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return NextResponse.json(
      { error: 'CRON_SECRET not configured on the server', code: 'no_cron_secret' },
      { status: 500 },
    )
  }
  const header = request.headers.get('authorization') ?? ''
  if (header !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized', code: 'unauthorized' }, { status: 401 })
  }

  const admin = createSupabaseAdminClient()
  const cutoff = new Date(Date.now() - AGE_DAYS * 86_400_000).toISOString()

  const { data: rows, error: selectError } = await admin
    .from('renders')
    .select('id, artist_id, output_url')
    .eq('status', STATUS_TO_DELETE)
    .lt('created_at', cutoff)
  if (selectError) {
    return NextResponse.json(
      { error: `Select failed: ${selectError.message}`, code: 'select_failed' },
      { status: 500 },
    )
  }

  const renderIds = (rows ?? []).map((r) => r.id)
  // output_url for a successful render is a public URL like
  // `https://<project>.supabase.co/storage/v1/object/public/renders/<artist>/<render>.mp4`
  // but failed renders typically don't have one set. The well-known storage
  // path convention is `<artistId>/<renderId>.mp4` (see uploadRenderOutput),
  // so we attempt to remove that path defensively even when output_url is
  // null — covers the case where the upload succeeded but the row was later
  // marked failed for a downstream reason.
  const storagePaths = (rows ?? []).map((r) => `${r.artist_id}/${r.id}.mp4`)

  if (storagePaths.length > 0) {
    await admin.storage
      .from('renders')
      .remove(storagePaths)
      .catch(() => {
        // Best-effort: missing objects on the storage side don't block the
        // DB row delete. Supabase Storage's remove() doesn't 404 on a
        // missing object, but a transient connection error could throw.
      })
  }

  let deletedRows = 0
  if (renderIds.length > 0) {
    const { error: deleteError, count } = await admin
      .from('renders')
      .delete({ count: 'exact' })
      .in('id', renderIds)
    if (deleteError) {
      return NextResponse.json(
        { error: `Delete failed: ${deleteError.message}`, code: 'delete_failed' },
        { status: 500 },
      )
    }
    deletedRows = count ?? renderIds.length
  }

  return NextResponse.json(
    {
      ok: true,
      deletedRows,
      storageObjectsRequested: storagePaths.length,
      cutoff,
    },
    { status: 200 },
  )
}
