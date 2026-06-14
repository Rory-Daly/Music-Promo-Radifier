import 'server-only'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import {
  readPostPulseOAuthClientFromEnv,
  refreshPostPulseAccessToken,
  type PostPulseTokenResponse,
} from './oauth'

const WORKSPACE_ROW_ID = 'default'
const REFRESH_BUFFER_SECONDS = 60

type WorkspaceTokenRow = {
  access_token: string
  refresh_token: string
  expires_at: string
  scope: string | null
}

/**
 * Returns a valid Post-Pulse access token for the workspace, refreshing
 * via the stored refresh_token if the current access_token is within
 * REFRESH_BUFFER_SECONDS of expiry. Returns null when:
 *
 *   - POST_PULSE_CLIENT_ID / POST_PULSE_CLIENT_SECRET aren't configured
 *   - no row exists (workspace hasn't been connected via OAuth yet)
 *   - refresh fails (refresh_token was revoked or rotated by another caller)
 *
 * Callers should treat null as "not connected" and surface a clear
 * not-connected error rather than retrying.
 */
export async function getPostPulseAccessToken(): Promise<string | null> {
  const oauth = readPostPulseOAuthClientFromEnv()
  if (!oauth) return null

  const admin = createSupabaseAdminClient()
  const { data } = await admin
    .from('post_pulse_workspace')
    .select('access_token, refresh_token, expires_at, scope')
    .eq('id', WORKSPACE_ROW_ID)
    .maybeSingle<WorkspaceTokenRow>()
  if (!data) return null

  const expiresAtMs = new Date(data.expires_at).getTime()
  const nowMs = Date.now()
  if (expiresAtMs - nowMs > REFRESH_BUFFER_SECONDS * 1000) {
    return data.access_token
  }

  let refreshed: PostPulseTokenResponse
  try {
    refreshed = await refreshPostPulseAccessToken({
      refreshToken: data.refresh_token,
      clientId: oauth.clientId,
      clientSecret: oauth.clientSecret,
    })
  } catch {
    return null
  }

  await persistRefreshedTokens(refreshed, data)
  return refreshed.accessToken
}

/**
 * Forces a refresh-and-persist regardless of expiry. Used by the client's
 * 401-retry path: if Post-Pulse rejects what we thought was a valid
 * token (rotation, revocation, clock skew), refresh once and retry.
 */
export async function forceRefreshPostPulseAccessToken(): Promise<string | null> {
  const oauth = readPostPulseOAuthClientFromEnv()
  if (!oauth) return null
  const admin = createSupabaseAdminClient()
  const { data } = await admin
    .from('post_pulse_workspace')
    .select('access_token, refresh_token, expires_at, scope')
    .eq('id', WORKSPACE_ROW_ID)
    .maybeSingle<WorkspaceTokenRow>()
  if (!data) return null

  let refreshed: PostPulseTokenResponse
  try {
    refreshed = await refreshPostPulseAccessToken({
      refreshToken: data.refresh_token,
      clientId: oauth.clientId,
      clientSecret: oauth.clientSecret,
    })
  } catch {
    return null
  }
  await persistRefreshedTokens(refreshed, data)
  return refreshed.accessToken
}

async function persistRefreshedTokens(
  refreshed: PostPulseTokenResponse,
  existing: WorkspaceTokenRow,
): Promise<void> {
  const expiresAt = new Date(Date.now() + refreshed.expiresInSeconds * 1000)
  const admin = createSupabaseAdminClient()
  await admin
    .from('post_pulse_workspace')
    .update({
      access_token: refreshed.accessToken,
      // Auth0-style tenants may or may not rotate refresh tokens. Keep
      // the old one if a new one wasn't issued.
      refresh_token: refreshed.refreshToken ?? existing.refresh_token,
      expires_at: expiresAt.toISOString(),
      scope: refreshed.scope ?? existing.scope,
    })
    .eq('id', WORKSPACE_ROW_ID)
}

export async function setPostPulseTokens(input: {
  accessToken: string
  refreshToken: string
  expiresInSeconds: number
  scope: string | null
  connectedBy: string
}): Promise<void> {
  const expiresAt = new Date(Date.now() + input.expiresInSeconds * 1000)
  const admin = createSupabaseAdminClient()
  const { error } = await admin.from('post_pulse_workspace').upsert(
    {
      id: WORKSPACE_ROW_ID,
      access_token: input.accessToken,
      refresh_token: input.refreshToken,
      expires_at: expiresAt.toISOString(),
      scope: input.scope,
      connected_by: input.connectedBy,
      connected_at: new Date().toISOString(),
    },
    { onConflict: 'id' },
  )
  if (error) {
    throw new Error(`Failed to persist Post-Pulse tokens: ${error.message}`)
  }
}

export async function deletePostPulseTokens(): Promise<void> {
  const admin = createSupabaseAdminClient()
  await admin.from('post_pulse_workspace').delete().eq('id', WORKSPACE_ROW_ID)
}

export async function isPostPulseConnected(): Promise<boolean> {
  const admin = createSupabaseAdminClient()
  const { count } = await admin
    .from('post_pulse_workspace')
    .select('id', { count: 'exact', head: true })
    .eq('id', WORKSPACE_ROW_ID)
  return (count ?? 0) > 0
}
