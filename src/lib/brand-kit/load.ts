import 'server-only'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { defaultBrandKit } from './defaults'
import { brandKitSchema, type BrandKit } from './schema'

/**
 * Load a single artist's brand kit, falling back to {@link defaultBrandKit}
 * if the row is missing, the JSON is empty, or schema validation fails.
 * Never throws — UI surfaces should always have a usable kit to render.
 */
export async function loadBrandKit(artistId: string): Promise<BrandKit> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('artists')
    .select('brand_kit')
    .eq('id', artistId)
    .maybeSingle()

  if (error || !data?.brand_kit) {
    return defaultBrandKit
  }

  const parsed = brandKitSchema.safeParse(data.brand_kit)
  if (!parsed.success) {
    console.warn(
      `Brand kit for artist ${artistId} failed schema validation; using defaults.`,
      parsed.error.flatten(),
    )
    return defaultBrandKit
  }
  return parsed.data
}
