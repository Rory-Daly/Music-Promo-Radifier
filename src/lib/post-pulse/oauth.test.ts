import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildPostPulseAuthUrl,
  exchangePostPulseCodeForTokens,
  POSTPULSE_API_AUDIENCE,
  POSTPULSE_AUTH_ENDPOINT,
  POSTPULSE_OAUTH_SCOPES,
  POSTPULSE_TOKEN_ENDPOINT,
  readPostPulseOAuthClientFromEnv,
  refreshPostPulseAccessToken,
} from './oauth'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('buildPostPulseAuthUrl', () => {
  it('returns the authorize URL with required params and offline_access scope', () => {
    const url = new URL(
      buildPostPulseAuthUrl({
        clientId: 'fAxUGg7…',
        redirectUri: 'http://localhost:3030/api/post-pulse/oauth-callback',
        state: 'random-state-abc',
      }),
    )
    expect(url.origin + url.pathname).toBe(POSTPULSE_AUTH_ENDPOINT)
    expect(url.searchParams.get('client_id')).toBe('fAxUGg7…')
    expect(url.searchParams.get('redirect_uri')).toBe(
      'http://localhost:3030/api/post-pulse/oauth-callback',
    )
    expect(url.searchParams.get('state')).toBe('random-state-abc')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('audience')).toBe(POSTPULSE_API_AUDIENCE)
    const scope = url.searchParams.get('scope')
    expect(scope).toBe(POSTPULSE_OAUTH_SCOPES)
    // Critical: without offline_access we don't get a refresh_token and
    // the integration locks out within ~24h of every connection.
    expect(scope).toContain('offline_access')
  })

  it('honours a custom scope override', () => {
    const url = new URL(
      buildPostPulseAuthUrl({
        clientId: 'c',
        redirectUri: 'http://localhost/cb',
        state: 's',
        scope: 'postpulse-api/accounts.read offline_access',
      }),
    )
    expect(url.searchParams.get('scope')).toBe('postpulse-api/accounts.read offline_access')
  })
})

describe('readPostPulseOAuthClientFromEnv', () => {
  it('returns null when either env var is missing', () => {
    vi.stubEnv('POST_PULSE_CLIENT_ID', '')
    vi.stubEnv('POST_PULSE_CLIENT_SECRET', '')
    expect(readPostPulseOAuthClientFromEnv()).toBeNull()
  })

  it('returns both when both are set', () => {
    vi.stubEnv('POST_PULSE_CLIENT_ID', 'id')
    vi.stubEnv('POST_PULSE_CLIENT_SECRET', 'secret')
    expect(readPostPulseOAuthClientFromEnv()).toEqual({ clientId: 'id', clientSecret: 'secret' })
  })
})

describe('exchangePostPulseCodeForTokens', () => {
  it('POSTs JSON to the token endpoint with grant_type=authorization_code', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          access_token: 'a',
          refresh_token: 'r',
          expires_in: 86400,
          scope: POSTPULSE_OAUTH_SCOPES,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )
    const result = await exchangePostPulseCodeForTokens({
      code: 'auth-code',
      clientId: 'cid',
      clientSecret: 'csecret',
      redirectUri: 'http://localhost/cb',
    })
    expect(result).toEqual({
      accessToken: 'a',
      refreshToken: 'r',
      expiresInSeconds: 86400,
      scope: POSTPULSE_OAUTH_SCOPES,
    })
    const [url, init] = fetchSpy.mock.calls[0]!
    expect(url).toBe(POSTPULSE_TOKEN_ENDPOINT)
    expect(init?.method).toBe('POST')
    expect((init?.headers as Record<string, string>)['Content-Type']).toBe('application/json')
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>
    expect(body.grant_type).toBe('authorization_code')
    expect(body.code).toBe('auth-code')
    expect(body.client_id).toBe('cid')
    expect(body.client_secret).toBe('csecret')
    expect(body.redirect_uri).toBe('http://localhost/cb')
  })

  it('throws on non-2xx', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response('boom', { status: 400 }),
    )
    await expect(
      exchangePostPulseCodeForTokens({
        code: 'x',
        clientId: 'c',
        clientSecret: 's',
        redirectUri: 'http://localhost/cb',
      }),
    ).rejects.toThrow(/token exchange failed/i)
  })

  it('throws when response omits access_token', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    await expect(
      exchangePostPulseCodeForTokens({
        code: 'x',
        clientId: 'c',
        clientSecret: 's',
        redirectUri: 'http://localhost/cb',
      }),
    ).rejects.toThrow(/missing access_token/i)
  })
})

describe('refreshPostPulseAccessToken', () => {
  it('uses grant_type=refresh_token and returns the new access token', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          access_token: 'new-a',
          refresh_token: 'rotated-r',
          expires_in: 7200,
          scope: POSTPULSE_OAUTH_SCOPES,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )
    const result = await refreshPostPulseAccessToken({
      refreshToken: 'r',
      clientId: 'c',
      clientSecret: 's',
    })
    expect(result.accessToken).toBe('new-a')
    expect(result.refreshToken).toBe('rotated-r')
    expect(result.expiresInSeconds).toBe(7200)
    const body = JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body)) as Record<string, unknown>
    expect(body.grant_type).toBe('refresh_token')
    expect(body.refresh_token).toBe('r')
  })

  it('preserves null refresh_token when rotation is disabled', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({ access_token: 'new-a', expires_in: 3600 }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )
    const result = await refreshPostPulseAccessToken({
      refreshToken: 'r',
      clientId: 'c',
      clientSecret: 's',
    })
    expect(result.refreshToken).toBeNull()
  })
})
