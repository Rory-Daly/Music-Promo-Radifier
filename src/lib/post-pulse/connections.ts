import 'server-only'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import type { AppPlatform } from './platform-map'

export type SocialConnectionRow = {
  artist_id: string
  platform: AppPlatform
  social_media_account_id: number
  display_handle: string | null
  connected_at: string
}

export async function listSocialConnectionsForArtist(
  artistId: string,
): Promise<SocialConnectionRow[]> {
  const admin = createSupabaseAdminClient()
  const { data } = await admin
    .from('social_connections')
    .select('artist_id, platform, social_media_account_id, display_handle, connected_at')
    .eq('artist_id', artistId)
  return (data ?? []) as SocialConnectionRow[]
}

export async function getSocialConnection(
  artistId: string,
  platform: AppPlatform,
): Promise<SocialConnectionRow | null> {
  const admin = createSupabaseAdminClient()
  const { data } = await admin
    .from('social_connections')
    .select('artist_id, platform, social_media_account_id, display_handle, connected_at')
    .eq('artist_id', artistId)
    .eq('platform', platform)
    .maybeSingle<SocialConnectionRow>()
  return data ?? null
}

export async function upsertSocialConnection(input: {
  artistId: string
  platform: AppPlatform
  socialMediaAccountId: number
  displayHandle: string | null
  connectedBy: string
}): Promise<void> {
  const admin = createSupabaseAdminClient()
  const { error } = await admin.from('social_connections').upsert(
    {
      artist_id: input.artistId,
      platform: input.platform,
      social_media_account_id: input.socialMediaAccountId,
      display_handle: input.displayHandle,
      connected_by: input.connectedBy,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'artist_id,platform' },
  )
  if (error) {
    throw new Error(`Failed to upsert social_connections: ${error.message}`)
  }
}

export async function deleteSocialConnection(
  artistId: string,
  platform: AppPlatform,
): Promise<void> {
  const admin = createSupabaseAdminClient()
  await admin
    .from('social_connections')
    .delete()
    .eq('artist_id', artistId)
    .eq('platform', platform)
}
