'use client'

import { createSupabaseBrowserClient } from '@/lib/supabase/client'

export type UploadArgs = {
  bucket: 'tracks' | 'clips' | 'renders'
  path: string
  file: File
  onProgress?: (pct: number) => void
}

/**
 * Uploads a file directly to Supabase Storage via XHR so we get progress
 * events. Uses the current user's JWT (read from the browser supabase
 * session) so RLS on storage.objects still gates the write.
 *
 * Why not supabase.storage.from(...).upload()? The supabase-js storage
 * client uses fetch() with no progress, and any internal failure before
 * the fetch is dispatched resolves without surfacing a useful error.
 * XHR lets us show progress AND attribute failures to a status code.
 */
export async function uploadFileToStorage(args: UploadArgs): Promise<void> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !anonKey) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL or _ANON_KEY is missing from the browser env')
  }
  const supabase = createSupabaseBrowserClient()
  const {
    data: { session },
  } = await supabase.auth.getSession()
  const jwt = session?.access_token
  if (!jwt) throw new Error('No active session — please sign in again')

  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${supabaseUrl}/storage/v1/object/${args.bucket}/${args.path}`, true)
    xhr.setRequestHeader('Authorization', `Bearer ${jwt}`)
    xhr.setRequestHeader('apikey', anonKey)
    xhr.setRequestHeader('x-upsert', 'false')
    if (args.file.type) {
      xhr.setRequestHeader('Content-Type', args.file.type)
    }
    if (args.onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) args.onProgress!((e.loaded / e.total) * 100)
      }
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve()
      } else {
        const body = xhr.responseText.slice(0, 300)
        reject(new Error(`Upload failed: HTTP ${xhr.status} ${xhr.statusText} — ${body}`))
      }
    }
    xhr.onerror = () => reject(new Error('Network error during upload'))
    xhr.onabort = () => reject(new Error('Upload aborted'))
    xhr.send(args.file)
  })
}
