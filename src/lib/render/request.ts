import { z } from 'zod'

export const renderRequestSchema = z
  .object({
    artistId: z.string().uuid(),
    trackId: z.string().uuid(),
    hookId: z.string().uuid().optional(),
    hookStartSeconds: z.number().nonnegative().optional(),
    hookEndSeconds: z.number().nonnegative().optional(),
    clipIds: z.array(z.string().uuid()).min(1).max(20),
    title: z.string().trim().max(120).optional(),
    cta: z.string().trim().max(80).optional(),
    artistName: z.string().trim().max(80).optional(),
    slowmo: z.number().positive().max(2).optional(),
    noOverlays: z.boolean().optional(),
  })
  .refine(
    (v) =>
      v.hookId !== undefined ||
      (v.hookStartSeconds !== undefined && v.hookEndSeconds !== undefined),
    {
      message: 'Provide either hookId or both hookStartSeconds and hookEndSeconds.',
    },
  )
  .refine(
    (v) =>
      v.hookStartSeconds === undefined ||
      v.hookEndSeconds === undefined ||
      v.hookEndSeconds > v.hookStartSeconds,
    {
      message: 'hookEndSeconds must be greater than hookStartSeconds.',
    },
  )

export type RenderRequest = z.infer<typeof renderRequestSchema>

export function parseStoragePath(value: string | null | undefined): {
  bucket: string
  path: string
} | null {
  if (!value) return null
  const trimmed = value.trim()
  if (trimmed.length === 0) return null
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    const match = trimmed.match(/\/storage\/v1\/object\/(?:public|sign)\/([^/]+)\/(.+?)(?:\?|$)/)
    if (!match) return null
    return { bucket: match[1], path: decodeURIComponent(match[2]) }
  }
  const slash = trimmed.indexOf('/')
  if (slash <= 0) return null
  return { bucket: trimmed.slice(0, slash), path: trimmed.slice(slash + 1) }
}
