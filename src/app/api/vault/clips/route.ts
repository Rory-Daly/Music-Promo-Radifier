import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

const bodySchema = z.object({
  artistId: z.string().uuid(),
  clipId: z.string().uuid(),
  path: z.string().min(1).max(512),
  name: z.string().trim().min(1).max(200),
  tags: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
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
  const { artistId, clipId, path, name, tags } = parsed.data

  const { data: membership } = await supabase
    .from('artist_memberships')
    .select('artist_id')
    .eq('artist_id', artistId)
    .eq('user_id', user.id)
    .maybeSingle()
  if (!membership) return err('Not a member of this artist', 403, 'forbidden')

  // Sanity-check: the path must live under this artist's prefix. The actual
  // object existence isn't re-verified — RLS on the storage bucket only let
  // a member of the artist write here in the first place.
  const expectedPrefix = `${artistId}/`
  if (!path.startsWith(expectedPrefix)) {
    return err('Storage path must start with the artist id', 400, 'bad_path')
  }

  const { data: clip, error: insertError } = await supabase
    .from('clips')
    .insert({
      id: clipId,
      artist_id: artistId,
      source: 'upload',
      storage_url: `clips/${path}`,
      name,
      tags: tags ?? [],
    })
    .select('id')
    .single<{ id: string }>()
  if (insertError || !clip) {
    await supabase.storage.from('clips').remove([path]).catch(() => {})
    return err(`Insert clip failed: ${insertError?.message ?? 'unknown'}`, 500, 'insert_failed')
  }

  return NextResponse.json({ clipId }, { status: 201 })
}
