/**
 * SoundCloud track URL helpers.
 *
 * No SoundCloud API access is needed — their public oEmbed endpoint and
 * widget player both work with the canonical URL alone, and we don't try
 * to fetch the audio file (SoundCloud's API is closed to new app
 * registrations as of 2026).
 */

const SOUNDCLOUD_HOSTS = new Set([
  'soundcloud.com',
  'www.soundcloud.com',
  'm.soundcloud.com',
  'on.soundcloud.com',
])

export type SoundCloudParseResult =
  | { ok: true; canonicalUrl: string }
  | { ok: false; reason: string }

/**
 * Validate a string is a plausible SoundCloud track URL and return a
 * canonical form. Accepts the common variants (www, m, on) and strips
 * tracking query params.
 */
export function parseSoundCloudUrl(input: string): SoundCloudParseResult {
  const trimmed = input.trim()
  if (trimmed.length === 0) return { ok: false, reason: 'URL is empty' }

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return { ok: false, reason: 'Not a valid URL' }
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { ok: false, reason: 'URL must use http or https' }
  }
  if (!SOUNDCLOUD_HOSTS.has(url.hostname.toLowerCase())) {
    return { ok: false, reason: 'URL must point to soundcloud.com' }
  }

  // SoundCloud track paths look like /<user>/<track-slug>. Reject artist
  // pages (/<user>) and other resource types (/sets/, /tags/, etc.).
  const segments = url.pathname.split('/').filter((s) => s.length > 0)
  if (segments.length < 2) {
    return { ok: false, reason: 'URL must include both an artist and a track segment' }
  }
  if (segments[0] === 'sets' || segments[0] === 'tags' || segments[0] === 'discover') {
    return { ok: false, reason: 'URL must be a single track, not a set or tag' }
  }

  // Canonical form: https://soundcloud.com/<user>/<track>. Drop query/hash.
  const canonical = `https://soundcloud.com/${segments[0]}/${segments[1]}`
  return { ok: true, canonicalUrl: canonical }
}

/**
 * Build the SoundCloud widget-player iframe URL for a canonical track URL.
 * Uses the brand-friendly default colour and the visual=false flag for the
 * compact horizontal player (Special Elite + minimal chrome fits the
 * illutible aesthetic better than the large artwork player).
 */
export function soundCloudPlayerUrl(trackUrl: string): string {
  const params = new URLSearchParams({
    url: trackUrl,
    color: '#c9a06b',
    auto_play: 'false',
    hide_related: 'true',
    show_comments: 'false',
    show_user: 'true',
    show_reposts: 'false',
    show_teaser: 'false',
    visual: 'false',
  })
  return `https://w.soundcloud.com/player/?${params.toString()}`
}
