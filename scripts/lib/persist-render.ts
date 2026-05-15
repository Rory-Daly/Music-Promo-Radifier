import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import type { SupabaseClient } from '@supabase/supabase-js'

export type PersistRenderInput = {
  artistId: string
  trackId?: string
  hookId?: string
  templateId?: string
  aspectRatio?: '9x16' | '1x1' | '16x9'
  platform?: string
  clipIds?: string[]
}

export type CreatedRender = {
  id: string
}

/**
 * Insert a 'queued' renders row. Returns the new render id so callers can
 * update status later.
 */
export async function createQueuedRender(
  client: SupabaseClient,
  input: PersistRenderInput,
): Promise<CreatedRender> {
  const { data, error } = await client
    .from('renders')
    .insert({
      artist_id: input.artistId,
      track_id: input.trackId ?? null,
      hook_id: input.hookId ?? null,
      template_id: input.templateId ?? 'basic-reel',
      aspect_ratio: input.aspectRatio ?? '9x16',
      platform: input.platform ?? null,
      clip_ids: input.clipIds ?? [],
      status: 'queued',
    })
    .select('id')
    .single<{ id: string }>()
  if (error || !data) throw new Error(`Insert renders row failed: ${error?.message ?? 'unknown'}`)
  return { id: data.id }
}

export async function markRenderStatus(
  client: SupabaseClient,
  id: string,
  patch: { status: 'rendering' | 'ready' | 'failed'; output_url?: string; error?: string },
): Promise<void> {
  const { error } = await client.from('renders').update(patch).eq('id', id)
  if (error) throw new Error(`Update render ${id} failed: ${error.message}`)
}

/**
 * Upload a local MP4 to the `renders` bucket and return its public URL.
 * Path convention: `<artistId>/<renderId>.mp4`.
 */
export async function uploadRenderOutput(
  client: SupabaseClient,
  args: { artistId: string; renderId: string; outputPath: string },
): Promise<{ path: string; publicUrl: string }> {
  const bytes = await readFile(args.outputPath)
  const ext = basename(args.outputPath).match(/\.[^.]+$/)?.[0] ?? '.mp4'
  const path = `${args.artistId}/${args.renderId}${ext}`
  const { error: uploadError } = await client.storage
    .from('renders')
    .upload(path, bytes, { contentType: 'video/mp4', upsert: true })
  if (uploadError) throw new Error(`Upload render failed: ${uploadError.message}`)
  const { data } = client.storage.from('renders').getPublicUrl(path)
  return { path, publicUrl: data.publicUrl }
}
