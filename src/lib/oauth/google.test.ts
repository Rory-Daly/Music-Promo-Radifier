import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildAuthUrl,
  DRIVE_OAUTH_SCOPE,
  exchangeCodeForTokens,
  readOAuthClientFromEnv,
  refreshAccessToken,
} from './google'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('buildAuthUrl', () => {
  it('returns Google auth URL with required params', () => {
    const url = new URL(
      buildAuthUrl({
        clientId: 'client123.apps.googleusercontent.com',
        redirectUri: 'http://localhost:3030/api/integrations/google/callback',
        state: 'random-state-abc',
      }),
    )
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(url.searchParams.get('client_id')).toBe('client123.apps.googleusercontent.com')
    expect(url.searchParams.get('redirect_uri')).toBe(
      'http://localhost:3030/api/integrations/google/callback',
    )
    expect(url.searchParams.get('state')).toBe('random-state-abc')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('access_type')).toBe('offline')
    expect(url.searchParams.get('prompt')).toBe('consent')
    expect(url.searchParams.get('scope')).toBe(DRIVE_OAUTH_SCOPE)
  })

  it('honours a custom scope override', () => {
    const url = new URL(
      buildAuthUrl({
        clientId: 'c',
        redirectUri: 'http://localhost/cb',
        state: 's',
        scope: 'https://www.googleapis.com/auth/drive.file',
      }),
    )
    expect(url.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/drive.file')
  })
})

describe('readOAuthClientFromEnv', () => {
  it('returns null when either env var is missing', () => {
    vi.stubEnv('GOOGLE_OAUTH_CLIENT_ID', '')
    vi.stubEnv('GOOGLE_OAUTH_CLIENT_SECRET', '')
    expect(readOAuthClientFromEnv()).toBeNull()
  })

  it('returns both when both are set', () => {
    vi.stubEnv('GOOGLE_OAUTH_CLIENT_ID', 'id')
    vi.stubEnv('GOOGLE_OAUTH_CLIENT_SECRET', 'secret')
    expect(readOAuthClientFromEnv()).toEqual({ clientId: 'id', clientSecret: 'secret' })
  })
})

describe('exchangeCodeForTokens', () => {
  it('POSTs to the token endpoint with the right grant_type', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          access_token: 'a',
          refresh_token: 'r',
          expires_in: 3600,
          scope: DRIVE_OAUTH_SCOPE,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )
    const result = await exchangeCodeForTokens({
      code: 'auth-code',
      clientId: 'cid',
      clientSecret: 'csecret',
      redirectUri: 'http://localhost/cb',
    })
    expect(result).toEqual({
      accessToken: 'a',
      refreshToken: 'r',
      expiresInSeconds: 3600,
      scope: DRIVE_OAUTH_SCOPE,
    })
    const [, init] = fetchSpy.mock.calls[0]
    expect(init?.method).toBe('POST')
    const body = String(init?.body)
    expect(body).toContain('grant_type=authorization_code')
    expect(body).toContain('code=auth-code')
    expect(body).toContain('client_id=cid')
  })

  it('throws on a non-2xx response', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response('boom', { status: 400 }),
    )
    await expect(
      exchangeCodeForTokens({
        code: 'x',
        clientId: 'c',
        clientSecret: 's',
        redirectUri: 'http://localhost/cb',
      }),
    ).rejects.toThrow(/Token exchange failed/)
  })

  it('throws when the response omits access_token', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    await expect(
      exchangeCodeForTokens({
        code: 'x',
        clientId: 'c',
        clientSecret: 's',
        redirectUri: 'http://localhost/cb',
      }),
    ).rejects.toThrow(/missing access_token/)
  })
})

describe('refreshAccessToken', () => {
  it('uses grant_type=refresh_token and returns the new access token', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          access_token: 'new-a',
          expires_in: 1800,
          scope: DRIVE_OAUTH_SCOPE,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )
    const result = await refreshAccessToken({
      refreshToken: 'r',
      clientId: 'c',
      clientSecret: 's',
    })
    expect(result.accessToken).toBe('new-a')
    expect(result.expiresInSeconds).toBe(1800)
    // Google usually omits refresh_token on refresh
    expect(result.refreshToken).toBeNull()
    const body = String(fetchSpy.mock.calls[0]?.[1]?.body)
    expect(body).toContain('grant_type=refresh_token')
    expect(body).toContain('refresh_token=r')
  })
})
