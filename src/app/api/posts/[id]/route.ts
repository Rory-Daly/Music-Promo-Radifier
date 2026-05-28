import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

const patchSchema = z.object({
  caption: z.string().max(5000).nullable().optional(),
  hashtags: z.array(z.string().max(64)).max(50).optional(),
  // Use a discriminator for scheduling state changes:
  //   { scheduledFor: ISO string } → schedule (status = 'scheduled')
  //   { scheduledFor: null }       → revert to draft (status = 'draft')
  //   omit                         → leave timing alone
  scheduledFor: z.union([z.string().datetime({ offset: true }), z.null()]).optional(),
})

function err(message: string, status: number, code: string) {
  return NextResponse.json({ error: message, code }, { status })
}

type RouteContext = { params: Promise<{ id: string }> }

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { id } = await context.params
  if (!z.string().uuid().safeParse(id).success) {
    return err('Invalid post id', 400, 'invalid_id')
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
  const parsed = patchSchema.safeParse(raw)
  if (!parsed.success) {
    return err(parsed.error.issues[0]?.message ?? 'Invalid body', 400, 'invalid_body')
  }

  // RLS already restricts to artists the user is a member of, but we need
  // to confirm the post is in a mutable status (draft or scheduled) before
  // letting through caption edits — published rows are frozen.
  const { data: existing, error: fetchError } = await supabase
    .from('posts')
    .select('id, status')
    .eq('id', id)
    .maybeSingle<{ id: string; status: string }>()
  if (fetchError || !existing) {
    return err('Post not found', 404, 'not_found')
  }
  if (existing.status === 'published') {
    return err('Cannot edit a published post', 409, 'immutable')
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if ('caption' in parsed.data) patch.caption = parsed.data.caption
  if ('hashtags' in parsed.data) patch.hashtags = parsed.data.hashtags
  if ('scheduledFor' in parsed.data) {
    patch.scheduled_for = parsed.data.scheduledFor
    patch.status = parsed.data.scheduledFor === null ? 'draft' : 'scheduled'
  }

  const { error: updateError } = await supabase.from('posts').update(patch).eq('id', id)
  if (updateError) {
    return err(`Update failed: ${updateError.message}`, 500, 'update_failed')
  }

  return NextResponse.json({ ok: true }, { status: 200 })
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params
  if (!z.string().uuid().safeParse(id).success) {
    return err('Invalid post id', 400, 'invalid_id')
  }

  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return err('Not authenticated', 401, 'unauthenticated')

  // Published posts have permalinks out in the world — refuse to delete via
  // this endpoint so the published record stays auditable. (A future
  // "unpublish from platform" flow would handle that explicitly.)
  const { data: existing } = await supabase
    .from('posts')
    .select('id, status')
    .eq('id', id)
    .maybeSingle<{ id: string; status: string }>()
  if (!existing) return err('Post not found', 404, 'not_found')
  if (existing.status === 'published') {
    return err('Cannot delete a published post', 409, 'immutable')
  }

  const { error: deleteError } = await supabase.from('posts').delete().eq('id', id)
  if (deleteError) {
    return err(`Delete failed: ${deleteError.message}`, 500, 'delete_failed')
  }
  return NextResponse.json({ ok: true }, { status: 200 })
}
