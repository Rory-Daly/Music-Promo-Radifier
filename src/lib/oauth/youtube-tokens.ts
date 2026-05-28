import 'server-only'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { readOAuthClientFromEnv, refreshAccessToken } from './google'

const REFRESH_BUFFER_SECONDS = 60

type IntegrationRow = {
  artist_id: string
  provider: 'youtube'
  access_token: string
  refresh_token: string
  expires_at: string
  scope: string | null
}

/**
 * Returns a valid YouTube access token for the artist, refreshing if the
 * stored one is about to expire. Returns null if no integration exists.
 *
 * Parallel to getDriveAccessToken — kept as a separate function rather
 * than parameterized so each provider's storage and refresh path stays
 * easy to reason about (and to grep for).
 */
export async function getYouTubeAccessToken(artistId: string): Promise<string | null> {
  const oauth = readOAuthClientFromEnv()
  if (!oauth) return null

  const admin = createSupabaseAdminClient()
  const { data } = await admin
    .from('artist_integrations')
    .select('artist_id, provider, access_token, refresh_token, expires_at, scope')
    .eq('artist_id', artistId)
    .eq('provider', 'youtube')
    .maybeSingle<IntegrationRow>()
  if (!data) return null

  const expiresAtMs = new Date(data.expires_at).getTime()
  const nowMs = Date.now()
  if (expiresAtMs - nowMs > REFRESH_BUFFER_SECONDS * 1000) {
    return data.access_token
  }

  let refreshed
  try {
    refreshed = await refreshAccessToken({
      refreshToken: data.refresh_token,
      clientId: oauth.clientId,
      clientSecret: oauth.clientSecret,
    })
  } catch {
    return null
  }

  const newExpiresAt = new Date(Date.now() + refreshed.expiresInSeconds * 1000)
  await admin
    .from('artist_integrations')
    .update({
      access_token: refreshed.accessToken,
      refresh_token: refreshed.refreshToken ?? data.refresh_token,
      expires_at: newExpiresAt.toISOString(),
      scope: refreshed.scope ?? data.scope,
    })
    .eq('artist_id', artistId)
    .eq('provider', 'youtube')
  return refreshed.accessToken
}

export async function isYouTubeConnected(artistId: string): Promise<boolean> {
  const admin = createSupabaseAdminClient()
  const { count } = await admin
    .from('artist_integrations')
    .select('artist_id', { count: 'exact', head: true })
    .eq('artist_id', artistId)
    .eq('provider', 'youtube')
  return (count ?? 0) > 0
}

export async function deleteYouTubeIntegration(artistId: string): Promise<string | null> {
  const admin = createSupabaseAdminClient()
  const { data } = await admin
    .from('artist_integrations')
    .select('access_token')
    .eq('artist_id', artistId)
    .eq('provider', 'youtube')
    .maybeSingle<{ access_token: string }>()
  await admin
    .from('artist_integrations')
    .delete()
    .eq('artist_id', artistId)
    .eq('provider', 'youtube')
  return data?.access_token ?? null
}
