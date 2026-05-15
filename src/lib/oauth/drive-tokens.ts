import 'server-only'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { readOAuthClientFromEnv, refreshAccessToken } from './google'

const REFRESH_BUFFER_SECONDS = 60 // refresh if token expires within this window

type IntegrationRow = {
  artist_id: string
  provider: 'google_drive'
  access_token: string
  refresh_token: string
  expires_at: string
  scope: string | null
}

/**
 * Returns a valid Drive access token for the artist, refreshing if the
 * stored one is about to expire. Returns null if no integration exists.
 *
 * Use the admin client so RLS doesn't block reads of the (sensitive)
 * tokens — the caller is server-side and has already authorised the
 * user via createSupabaseServerClient() in the parent route.
 */
export async function getDriveAccessToken(artistId: string): Promise<string | null> {
  const oauth = readOAuthClientFromEnv()
  if (!oauth) return null

  const admin = createSupabaseAdminClient()
  const { data } = await admin
    .from('artist_integrations')
    .select('artist_id, provider, access_token, refresh_token, expires_at, scope')
    .eq('artist_id', artistId)
    .eq('provider', 'google_drive')
    .maybeSingle<IntegrationRow>()
  if (!data) return null

  const expiresAtMs = new Date(data.expires_at).getTime()
  const nowMs = Date.now()
  if (expiresAtMs - nowMs > REFRESH_BUFFER_SECONDS * 1000) {
    return data.access_token
  }

  // Refresh
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
      // Google often omits refresh_token on refresh; keep the old one.
      refresh_token: refreshed.refreshToken ?? data.refresh_token,
      expires_at: newExpiresAt.toISOString(),
      scope: refreshed.scope ?? data.scope,
    })
    .eq('artist_id', artistId)
    .eq('provider', 'google_drive')
  return refreshed.accessToken
}

export async function isDriveConnected(artistId: string): Promise<boolean> {
  const admin = createSupabaseAdminClient()
  const { count } = await admin
    .from('artist_integrations')
    .select('artist_id', { count: 'exact', head: true })
    .eq('artist_id', artistId)
    .eq('provider', 'google_drive')
  return (count ?? 0) > 0
}

export async function deleteDriveIntegration(artistId: string): Promise<string | null> {
  const admin = createSupabaseAdminClient()
  const { data } = await admin
    .from('artist_integrations')
    .select('access_token')
    .eq('artist_id', artistId)
    .eq('provider', 'google_drive')
    .maybeSingle<{ access_token: string }>()
  await admin
    .from('artist_integrations')
    .delete()
    .eq('artist_id', artistId)
    .eq('provider', 'google_drive')
  return data?.access_token ?? null
}
