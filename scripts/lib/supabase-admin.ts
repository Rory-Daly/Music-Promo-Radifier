import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export type AdminConfig = {
  url: string
  serviceKey: string
}

export function readAdminConfigFromEnv(): AdminConfig | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) return null
  return { url, serviceKey }
}

export function createAdminClient(config: AdminConfig): SupabaseClient {
  return createClient(config.url, config.serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
