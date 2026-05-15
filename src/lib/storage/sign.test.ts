import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { signStorageRefs } from './sign'

type SignedUrlResult = { error: { message: string } | null; data: Array<{ signedUrl: string }> | null }

function makeClient(perBucket: Record<string, SignedUrlResult>) {
  const calls: Array<{ bucket: string; paths: string[]; expiresIn: number }> = []
  const client = {
    storage: {
      from(bucket: string) {
        return {
          createSignedUrls: vi.fn(async (paths: string[], expiresIn: number) => {
            calls.push({ bucket, paths, expiresIn })
            return perBucket[bucket] ?? { data: null, error: { message: 'unknown bucket' } }
          }),
        }
      },
    },
  } as unknown as SupabaseClient
  return { client, calls }
}

describe('signStorageRefs', () => {
  it('signs refs grouped by bucket and preserves order', async () => {
    const { client, calls } = makeClient({
      tracks: {
        error: null,
        data: [{ signedUrl: 'sign-t1' }, { signedUrl: 'sign-t2' }],
      },
      clips: { error: null, data: [{ signedUrl: 'sign-c1' }] },
    })
    const result = await signStorageRefs(
      client,
      [
        'tracks/artist-1/a.wav',
        'clips/artist-1/x.mp4',
        'tracks/artist-1/b.wav',
        null,
        'invalid-no-slash',
      ],
      900,
    )
    expect(result).toEqual(['sign-t1', 'sign-c1', 'sign-t2', null, null])
    expect(calls).toHaveLength(2)
    const tracksCall = calls.find((c) => c.bucket === 'tracks')
    const clipsCall = calls.find((c) => c.bucket === 'clips')
    expect(tracksCall?.paths).toEqual(['artist-1/a.wav', 'artist-1/b.wav'])
    expect(tracksCall?.expiresIn).toBe(900)
    expect(clipsCall?.paths).toEqual(['artist-1/x.mp4'])
  })

  it('returns null entries when a bucket sign call fails', async () => {
    const { client } = makeClient({
      tracks: { error: { message: 'boom' }, data: null },
    })
    const result = await signStorageRefs(client, ['tracks/artist-1/a.wav'])
    expect(result).toEqual([null])
  })

  it('handles an all-null input without making any storage calls', async () => {
    const { client, calls } = makeClient({})
    const result = await signStorageRefs(client, [null, undefined])
    expect(result).toEqual([null, null])
    expect(calls).toHaveLength(0)
  })

  it('uses the default 1-hour expiry when none is provided', async () => {
    const { client, calls } = makeClient({
      tracks: { error: null, data: [{ signedUrl: 'sign-t1' }] },
    })
    await signStorageRefs(client, ['tracks/a/b.wav'])
    expect(calls[0]?.expiresIn).toBe(3600)
  })
})
