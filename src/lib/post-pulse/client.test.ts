import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./tokens', () => ({
  getPostPulseAccessToken: vi.fn(),
  forceRefreshPostPulseAccessToken: vi.fn(),
}))

import {
  createPost,
  importMediaByUrl,
  PostPulseError,
  PostPulseNotConnectedError,
} from './client'
import { forceRefreshPostPulseAccessToken, getPostPulseAccessToken } from './tokens'

const mockedGetToken = vi.mocked(getPostPulseAccessToken)
const mockedForceRefresh = vi.mocked(forceRefreshPostPulseAccessToken)

beforeEach(() => {
  mockedGetToken.mockReset()
  mockedForceRefresh.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

function okResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

describe('importMediaByUrl', () => {
  it('throws PostPulseNotConnectedError when no access token is available', async () => {
    mockedGetToken.mockResolvedValueOnce(null)
    await expect(importMediaByUrl('https://example.com/v.mp4')).rejects.toBeInstanceOf(
      PostPulseNotConnectedError,
    )
  })

  it('sends the access token as a Bearer header and returns the media path', async () => {
    mockedGetToken.mockResolvedValueOnce('initial-token')
    const fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(okResponse({ path: '/m/abc' }))

    const result = await importMediaByUrl('https://example.com/v.mp4')
    expect(result).toEqual({ path: '/m/abc' })
    const [, init] = fetchSpy.mock.calls[0]!
    const headers = init?.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer initial-token')
  })

  it('refreshes and retries once on 401, then succeeds', async () => {
    mockedGetToken.mockResolvedValueOnce('stale-token')
    mockedForceRefresh.mockResolvedValueOnce('fresh-token')

    const fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response('unauthorized', { status: 401 }))
      .mockResolvedValueOnce(okResponse({ path: '/m/xyz' }))

    const result = await importMediaByUrl('https://example.com/v.mp4')
    expect(result).toEqual({ path: '/m/xyz' })
    expect(mockedForceRefresh).toHaveBeenCalledTimes(1)
    expect(fetchSpy).toHaveBeenCalledTimes(2)

    const firstAuth = (fetchSpy.mock.calls[0]?.[1]?.headers as Record<string, string>).Authorization
    const secondAuth = (fetchSpy.mock.calls[1]?.[1]?.headers as Record<string, string>)
      .Authorization
    expect(firstAuth).toBe('Bearer stale-token')
    expect(secondAuth).toBe('Bearer fresh-token')
  })

  it('throws PostPulseNotConnectedError when the refresh also fails', async () => {
    mockedGetToken.mockResolvedValueOnce('stale-token')
    mockedForceRefresh.mockResolvedValueOnce(null)
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response('unauthorized', { status: 401 }),
    )
    await expect(importMediaByUrl('https://example.com/v.mp4')).rejects.toBeInstanceOf(
      PostPulseNotConnectedError,
    )
  })

  it('surfaces non-401 errors as PostPulseError with the server message', async () => {
    mockedGetToken.mockResolvedValueOnce('t')
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ message: 'invalid url' }), {
        status: 422,
        headers: { 'content-type': 'application/json' },
      }),
    )
    await expect(importMediaByUrl('https://example.com/v.mp4')).rejects.toMatchObject({
      name: 'PostPulseError',
      status: 422,
      message: 'invalid url',
    })
  })
})

describe('createPost', () => {
  it('builds the publications payload and returns the post id', async () => {
    mockedGetToken.mockResolvedValueOnce('t')
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      okResponse({
        id: 9821,
        overallStatus: 'SCHEDULED',
        scheduledTime: '2026-06-20T10:00:00Z',
      }),
    )
    const result = await createPost({
      socialMediaAccountId: 123,
      platformSettings: { type: 'INSTAGRAM', publicationType: 'REELS' },
      content: 'hi',
      attachmentPath: '/m/abc',
      scheduledTime: '2026-06-20T10:00:00Z',
    })
    expect(result).toEqual({
      id: 9821,
      overallStatus: 'SCHEDULED',
      scheduledTime: '2026-06-20T10:00:00Z',
    })
    const body = JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body)) as Record<string, unknown>
    expect(body.scheduledTime).toBe('2026-06-20T10:00:00Z')
    const publications = body.publications as Array<Record<string, unknown>>
    expect(publications[0].socialMediaAccountId).toBe(123)
  })

  it('throws PostPulseError when the response is missing a numeric id', async () => {
    mockedGetToken.mockResolvedValueOnce('t')
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(okResponse({ overallStatus: 'SCHEDULED' }))
    await expect(
      createPost({
        socialMediaAccountId: 1,
        platformSettings: { type: 'INSTAGRAM', publicationType: 'REELS' },
        content: '',
        attachmentPath: '/m/x',
      }),
    ).rejects.toBeInstanceOf(PostPulseError)
  })
})
