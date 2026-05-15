/**
 * Google OAuth 2.0 helpers — server-only. No third-party SDK; we hit the
 * documented endpoints directly with fetch so we don't pull a heavyweight
 * Google Auth library for what's a few HTTP calls.
 *
 * Docs:
 *   https://developers.google.com/identity/protocols/oauth2/web-server
 */

export const DRIVE_OAUTH_SCOPE = 'https://www.googleapis.com/auth/drive.readonly'

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke'

export type TokenResponse = {
  accessToken: string
  refreshToken: string | null
  expiresInSeconds: number
  scope: string | null
}

export function readOAuthClientFromEnv(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET
  if (!clientId || !clientSecret) return null
  return { clientId, clientSecret }
}

export function buildAuthUrl(args: {
  clientId: string
  redirectUri: string
  state: string
  scope?: string
}): string {
  const params = new URLSearchParams({
    client_id: args.clientId,
    redirect_uri: args.redirectUri,
    response_type: 'code',
    scope: args.scope ?? DRIVE_OAUTH_SCOPE,
    access_type: 'offline', // we need a refresh_token
    prompt: 'consent', // force refresh_token on re-consent
    include_granted_scopes: 'true',
    state: args.state,
  })
  return `${AUTH_ENDPOINT}?${params}`
}

export async function exchangeCodeForTokens(args: {
  code: string
  clientId: string
  clientSecret: string
  redirectUri: string
}): Promise<TokenResponse> {
  const params = new URLSearchParams({
    code: args.code,
    client_id: args.clientId,
    client_secret: args.clientSecret,
    redirect_uri: args.redirectUri,
    grant_type: 'authorization_code',
  })
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Token exchange failed: HTTP ${res.status} ${body.slice(0, 200)}`)
  }
  return normaliseTokenJson(await res.json())
}

export async function refreshAccessToken(args: {
  refreshToken: string
  clientId: string
  clientSecret: string
}): Promise<TokenResponse> {
  const params = new URLSearchParams({
    refresh_token: args.refreshToken,
    client_id: args.clientId,
    client_secret: args.clientSecret,
    grant_type: 'refresh_token',
  })
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Token refresh failed: HTTP ${res.status} ${body.slice(0, 200)}`)
  }
  return normaliseTokenJson(await res.json())
}

export async function revokeToken(token: string): Promise<void> {
  // Best-effort. Don't throw if the revoke fails — we still want to drop
  // the local row.
  await fetch(`${REVOKE_ENDPOINT}?token=${encodeURIComponent(token)}`, {
    method: 'POST',
  }).catch(() => {})
}

function normaliseTokenJson(raw: unknown): TokenResponse {
  const o = raw as {
    access_token?: string
    refresh_token?: string
    expires_in?: number
    scope?: string
  }
  if (!o.access_token) {
    throw new Error('Token response missing access_token')
  }
  return {
    accessToken: o.access_token,
    refreshToken: o.refresh_token ?? null,
    expiresInSeconds: o.expires_in ?? 3600,
    scope: o.scope ?? null,
  }
}
