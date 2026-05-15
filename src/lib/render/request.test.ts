import { describe, expect, it } from 'vitest'
import { parseStoragePath, renderRequestSchema } from './request'

const UUID = '11111111-1111-1111-1111-111111111111'
const UUID2 = '22222222-2222-2222-2222-222222222222'
const CLIP_UUID = '33333333-3333-3333-3333-333333333333'

describe('parseStoragePath', () => {
  it('parses a public storage URL', () => {
    const result = parseStoragePath(
      'https://abc.supabase.co/storage/v1/object/public/tracks/artist1/song.wav',
    )
    expect(result).toEqual({ bucket: 'tracks', path: 'artist1/song.wav' })
  })

  it('parses a signed storage URL with query params', () => {
    const result = parseStoragePath(
      'https://abc.supabase.co/storage/v1/object/sign/clips/abc/clip.mp4?token=xyz',
    )
    expect(result).toEqual({ bucket: 'clips', path: 'abc/clip.mp4' })
  })

  it('parses a bucket-prefixed path', () => {
    expect(parseStoragePath('tracks/artist1/song.wav')).toEqual({
      bucket: 'tracks',
      path: 'artist1/song.wav',
    })
  })

  it('decodes URL-encoded path segments', () => {
    const result = parseStoragePath(
      'https://abc.supabase.co/storage/v1/object/public/tracks/artist/Hope%20v9.wav',
    )
    expect(result).toEqual({ bucket: 'tracks', path: 'artist/Hope v9.wav' })
  })

  it('returns null for missing or malformed values', () => {
    expect(parseStoragePath(null)).toBeNull()
    expect(parseStoragePath(undefined)).toBeNull()
    expect(parseStoragePath('')).toBeNull()
    expect(parseStoragePath('no-bucket-prefix.wav')).toBeNull()
    expect(parseStoragePath('https://example.com/some/other/path')).toBeNull()
  })
})

describe('renderRequestSchema', () => {
  it('accepts a valid request with inline hook range', () => {
    const result = renderRequestSchema.safeParse({
      artistId: UUID,
      trackId: UUID2,
      hookStartSeconds: 30,
      hookEndSeconds: 60,
      clipIds: [CLIP_UUID],
    })
    expect(result.success).toBe(true)
  })

  it('accepts a valid request with hookId', () => {
    const result = renderRequestSchema.safeParse({
      artistId: UUID,
      trackId: UUID2,
      hookId: CLIP_UUID,
      clipIds: [CLIP_UUID],
    })
    expect(result.success).toBe(true)
  })

  it('rejects requests with neither hookId nor inline range', () => {
    const result = renderRequestSchema.safeParse({
      artistId: UUID,
      trackId: UUID2,
      clipIds: [CLIP_UUID],
    })
    expect(result.success).toBe(false)
  })

  it('rejects requests where end <= start', () => {
    const result = renderRequestSchema.safeParse({
      artistId: UUID,
      trackId: UUID2,
      hookStartSeconds: 60,
      hookEndSeconds: 30,
      clipIds: [CLIP_UUID],
    })
    expect(result.success).toBe(false)
  })

  it('rejects requests with empty clipIds', () => {
    const result = renderRequestSchema.safeParse({
      artistId: UUID,
      trackId: UUID2,
      hookStartSeconds: 30,
      hookEndSeconds: 60,
      clipIds: [],
    })
    expect(result.success).toBe(false)
  })

  it('rejects non-UUID ids', () => {
    const result = renderRequestSchema.safeParse({
      artistId: 'not-a-uuid',
      trackId: UUID2,
      hookStartSeconds: 30,
      hookEndSeconds: 60,
      clipIds: [CLIP_UUID],
    })
    expect(result.success).toBe(false)
  })

  it('rejects slowmo outside the supported range', () => {
    const result = renderRequestSchema.safeParse({
      artistId: UUID,
      trackId: UUID2,
      hookStartSeconds: 30,
      hookEndSeconds: 60,
      clipIds: [CLIP_UUID],
      slowmo: 5,
    })
    expect(result.success).toBe(false)
  })
})
