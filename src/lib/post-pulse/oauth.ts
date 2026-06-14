import 'server-only'

/**
 * Post-Pulse OAuth 2.0 helpers — authorization-code flow.
 *
 * Post-Pulse retired the static workspace API key during their developer
 * onboarding overhaul (mid-2026). The only path for "Direct API
 * integration" is now the authorization-code flow against
 * `auth.post-pulse.com`. We run the dance once during setup, persist the
 * refresh token, and exchange it for short-lived access tokens on every
 * publish.
 *
 * No third-party SDK — these are a handful of HTTP calls and matching the
 * style of src/lib/oauth/google.ts.
 */

export const POSTPULSE_AUTH_ENDPOINT = 'https://auth.post-pulse.com/authorize'
export const POSTPULSE_TOKEN_ENDPOINT = 'https://auth.post-pulse.com/oauth/token'
export const POSTPULSE_API_AUDIENCE = 'https://api.post-pulse.com'

/**
 * API scopes plus `offline_access` so the token endpoint returns a
 * refresh_token. Without offline_access the access_token expires (24h
 * default for Auth0-style tenants) and we'd be locked out silently.
 */
export const POSTPULSE_OAUTH_SCOPES = [
  'postpulse-api/accounts.read',
  'postpulse-api/posts.write',
  'postpulse-api/media.write',
  'offline_access',
].join(' ')

export type PostPulseTokenResponse = {
  accessToken: string
  refreshToken: string | null
  expiresInSeconds: number
  scope: string | null
}

export function readPostPulseOAuthClientFromEnv(): {
  clientId: string
  clientSecret: string
} | null {
  const clientId = process.env.POST_PULSE_CLIENT_ID
  const clientSecret = process.env.POST_PULSE_CLIENT_SECRET
  if (!clientId || !clientSecret) return null
  return { clientId, clientSecret }
}

export function buildPostPulseAuthUrl(args: {
  clientId: string
  redirectUri: string
  state: string
  scope?: string
}): string {
  const params = new URLSearchParams({
    client_id: args.clientId,
    redirect_uri: args.redirectUri,
    response_type: 'code',
    scope: args.scope ?? POSTPULSE_OAUTH_SCOPES,
    audience: POSTPULSE_API_AUDIENCE,
    state: args.state,
  })
  return `${POSTPULSE_AUTH_ENDPOINT}?${params}`
}

export async function exchangePostPulseCodeForTokens(args: {
  code: string
  clientId: string
  clientSecret: string
  redirectUri: string
}): Promise<PostPulseTokenResponse> {
  const res = await fetch(POSTPULSE_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      client_id: args.clientId,
      client_secret: args.clientSecret,
      code: args.code,
      redirect_uri: args.redirectUri,
    }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Post-Pulse token exchange failed: HTTP ${res.status} ${body.slice(0, 200)}`)
  }
  return normalisePostPulseTokenJson(await res.json())
}

export async function refreshPostPulseAccessToken(args: {
  refreshToken: string
  clientId: string
  clientSecret: string
}): Promise<PostPulseTokenResponse> {
  const res = await fetch(POSTPULSE_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      client_id: args.clientId,
      client_secret: args.clientSecret,
      refresh_token: args.refreshToken,
    }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Post-Pulse token refresh failed: HTTP ${res.status} ${body.slice(0, 200)}`)
  }
  return normalisePostPulseTokenJson(await res.json())
}

function normalisePostPulseTokenJson(raw: unknown): PostPulseTokenResponse {
  const o = raw as {
    access_token?: string
    refresh_token?: string
    expires_in?: number
    scope?: string
  }
  if (!o.access_token) {
    throw new Error('Post-Pulse token response missing access_token')
  }
  return {
    accessToken: o.access_token,
    refreshToken: o.refresh_token ?? null,
    expiresInSeconds: o.expires_in ?? 3600,
    scope: o.scope ?? null,
  }
}
