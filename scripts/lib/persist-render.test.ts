import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createQueuedRender, markRenderStatus } from './persist-render'

function makeClient(overrides: { insertResult?: { data: { id: string } | null; error: { message: string } | null }; updateResult?: { error: { message: string } | null } } = {}) {
  const insertSingle = vi.fn(async () =>
    overrides.insertResult ?? { data: { id: 'new-id' }, error: null },
  )
  const insertSelect = vi.fn(() => ({ single: insertSingle }))
  const insert = vi.fn(() => ({ select: insertSelect }))
  const updateEq = vi.fn(async () => overrides.updateResult ?? { error: null })
  const update = vi.fn(() => ({ eq: updateEq }))
  const from = vi.fn(() => ({ insert, update }))
  return {
    client: { from } as unknown as SupabaseClient,
    insert,
    insertSelect,
    insertSingle,
    update,
    updateEq,
    from,
  }
}

describe('createQueuedRender', () => {
  it('inserts a row with defaults and returns the id', async () => {
    const m = makeClient()
    const result = await createQueuedRender(m.client, {
      artistId: 'artist-1',
    })
    expect(result).toEqual({ id: 'new-id' })
    expect(m.from).toHaveBeenCalledWith('renders')
    const firstCall = m.insert.mock.calls[0] as unknown[] | undefined
    const insertedArg = firstCall?.[0]
    expect(insertedArg).toMatchObject({
      artist_id: 'artist-1',
      template_id: 'basic-reel',
      aspect_ratio: '9x16',
      clip_ids: [],
      status: 'queued',
    })
  })

  it('persists optional links and overrides', async () => {
    const m = makeClient()
    await createQueuedRender(m.client, {
      artistId: 'artist-1',
      trackId: 'track-1',
      hookId: 'hook-1',
      templateId: 'custom',
      aspectRatio: '1x1',
      platform: 'instagram',
      clipIds: ['c1', 'c2'],
    })
    const firstCall = m.insert.mock.calls[0] as unknown[] | undefined
    const insertedArg = firstCall?.[0]
    expect(insertedArg).toMatchObject({
      track_id: 'track-1',
      hook_id: 'hook-1',
      template_id: 'custom',
      aspect_ratio: '1x1',
      platform: 'instagram',
      clip_ids: ['c1', 'c2'],
    })
  })

  it('throws when the insert fails', async () => {
    const m = makeClient({
      insertResult: { data: null, error: { message: 'permission denied' } },
    })
    await expect(createQueuedRender(m.client, { artistId: 'artist-1' })).rejects.toThrow(
      /permission denied/,
    )
  })
})

describe('markRenderStatus', () => {
  it('updates the render row', async () => {
    const m = makeClient()
    await markRenderStatus(m.client, 'render-1', {
      status: 'ready',
      output_url: 'https://example/v.mp4',
    })
    expect(m.update).toHaveBeenCalledWith({
      status: 'ready',
      output_url: 'https://example/v.mp4',
    })
    expect(m.updateEq).toHaveBeenCalledWith('id', 'render-1')
  })

  it('throws when the update fails', async () => {
    const m = makeClient({ updateResult: { error: { message: 'row missing' } } })
    await expect(
      markRenderStatus(m.client, 'render-1', { status: 'failed', error: 'boom' }),
    ).rejects.toThrow(/row missing/)
  })
})
