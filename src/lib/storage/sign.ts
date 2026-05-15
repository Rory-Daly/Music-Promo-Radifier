import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { parseStoragePath } from '@/lib/render/request'

/**
 * Sign a batch of storage object refs (`<bucket>/<path>` or full Supabase
 * URL). Order is preserved; entries that can't be parsed or signed come
 * back as `null`. Issues one storage call per distinct bucket.
 */
export async function signStorageRefs(
  client: SupabaseClient,
  refs: Array<string | null | undefined>,
  expiresIn = 3600,
): Promise<Array<string | null>> {
  const out: Array<string | null> = new Array(refs.length).fill(null)
  const byBucket = new Map<string, Array<{ idx: number; path: string }>>()
  refs.forEach((value, idx) => {
    const parsed = parseStoragePath(value)
    if (!parsed) return
    if (!byBucket.has(parsed.bucket)) byBucket.set(parsed.bucket, [])
    byBucket.get(parsed.bucket)!.push({ idx, path: parsed.path })
  })

  for (const [bucket, items] of byBucket) {
    const { data, error } = await client.storage
      .from(bucket)
      .createSignedUrls(
        items.map((i) => i.path),
        expiresIn,
      )
    if (error || !data) continue
    data.forEach((entry, i) => {
      if (entry?.signedUrl) out[items[i].idx] = entry.signedUrl
    })
  }
  return out
}
