import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const mockGetUser = vi.fn()
const mockSelectMaybeSingle = vi.fn()
const mockStorageRemove = vi.fn()
const mockDeleteEq = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(async () => ({
    auth: { getUser: mockGetUser },
    from: (table: string) => {
      if (table !== 'renders') throw new Error(`unexpected table: ${table}`)
      return {
        select: () => ({
          eq: () => ({ maybeSingle: mockSelectMaybeSingle }),
        }),
        delete: () => ({ eq: mockDeleteEq }),
      }
    },
    storage: {
      from: (bucket: string) => {
        if (bucket !== 'renders') throw new Error(`unexpected bucket: ${bucket}`)
        return { remove: mockStorageRemove }
      },
    },
  })),
}))

// Import after the mock is registered so the route picks up the mocked client.
const { DELETE } = await import('./route')

const RENDER_ID = '11111111-1111-1111-1111-111111111111'
const ARTIST_ID = '22222222-2222-2222-2222-222222222222'

function ctx(id: string) {
  return { params: Promise.resolve({ id }) }
}
function req() {
  // The handler ignores the request, so any NextRequest-shaped value works.
  return {} as unknown as NextRequest
}

describe('DELETE /api/renders/[id]', () => {
  beforeEach(() => {
    mockGetUser.mockReset()
    mockSelectMaybeSingle.mockReset()
    mockStorageRemove.mockReset()
    mockDeleteEq.mockReset()
  })

  it('returns 401 when the user is not authenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })

    const res = await DELETE(req(), ctx(RENDER_ID))

    expect(res.status).toBe(401)
    expect(mockSelectMaybeSingle).not.toHaveBeenCalled()
  })

  it('returns 400 when the id is not a UUID', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u' } } })

    const res = await DELETE(req(), ctx('not-a-uuid'))

    expect(res.status).toBe(400)
    expect(mockSelectMaybeSingle).not.toHaveBeenCalled()
  })

  it('returns 404 when no render row matches', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u' } } })
    mockSelectMaybeSingle.mockResolvedValue({ data: null, error: null })

    const res = await DELETE(req(), ctx(RENDER_ID))

    expect(res.status).toBe(404)
    expect(mockStorageRemove).not.toHaveBeenCalled()
    expect(mockDeleteEq).not.toHaveBeenCalled()
  })

  it('removes the storage object then the DB row on the happy path', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u' } } })
    mockSelectMaybeSingle.mockResolvedValue({
      data: { id: RENDER_ID, artist_id: ARTIST_ID },
      error: null,
    })
    mockStorageRemove.mockResolvedValue({ data: [], error: null })
    mockDeleteEq.mockResolvedValue({ error: null })

    const res = await DELETE(req(), ctx(RENDER_ID))

    expect(res.status).toBe(200)
    expect(mockStorageRemove).toHaveBeenCalledWith([`${ARTIST_ID}/${RENDER_ID}.mp4`])
    expect(mockDeleteEq).toHaveBeenCalledWith('id', RENDER_ID)
  })

  it('still deletes the DB row when the storage remove throws (best-effort)', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u' } } })
    mockSelectMaybeSingle.mockResolvedValue({
      data: { id: RENDER_ID, artist_id: ARTIST_ID },
      error: null,
    })
    mockStorageRemove.mockRejectedValue(new Error('transient storage error'))
    mockDeleteEq.mockResolvedValue({ error: null })

    const res = await DELETE(req(), ctx(RENDER_ID))

    expect(res.status).toBe(200)
    expect(mockDeleteEq).toHaveBeenCalledWith('id', RENDER_ID)
  })

  it('returns 500 with the underlying error message when the DB delete fails', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u' } } })
    mockSelectMaybeSingle.mockResolvedValue({
      data: { id: RENDER_ID, artist_id: ARTIST_ID },
      error: null,
    })
    mockStorageRemove.mockResolvedValue({ data: [], error: null })
    mockDeleteEq.mockResolvedValue({ error: { message: 'permission denied for table renders' } })

    const res = await DELETE(req(), ctx(RENDER_ID))

    expect(res.status).toBe(500)
    const body = (await res.json()) as { error: string; code: string }
    expect(body.code).toBe('delete_failed')
    expect(body.error).toContain('permission denied')
  })
})
