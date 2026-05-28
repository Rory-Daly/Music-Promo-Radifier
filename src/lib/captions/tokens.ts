/**
 * Token substitution for caption templates from brand_kit.caption_presets.
 *
 * Tokens used across the seeded presets:
 *   {track_title}       — track title
 *   {smart_link}        — full smart-link URL
 *   {release_date}      — formatted release date (or "soon")
 *   {hashtags}          — joined hashtags (space-separated)
 *   {location_or_mood}  — optional caller-supplied context phrase
 *
 * The substitution is intentionally dumb string replace, not a templating
 * engine — caption templates are short and trusted (live in our own DB), and
 * the values are sanitised at the caller. If a token isn't supplied we leave
 * the placeholder in place so the caller can spot it during review.
 */

export type CaptionTokens = {
  track_title?: string
  smart_link?: string
  release_date?: string
  hashtags?: string
  location_or_mood?: string
}

export function substituteCaptionTokens(template: string, tokens: CaptionTokens): string {
  return template
    .replace(/\{track_title\}/g, tokens.track_title ?? '{track_title}')
    .replace(/\{smart_link\}/g, tokens.smart_link ?? '{smart_link}')
    .replace(/\{release_date\}/g, tokens.release_date ?? 'soon')
    .replace(/\{hashtags\}/g, tokens.hashtags ?? '')
    .replace(/\{location_or_mood\}/g, tokens.location_or_mood ?? '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Format a release date for caption use. Falls back to "soon" if the date
 * isn't set yet, and prefers the long form (eg "May 28") since captions are
 * read by humans, not parsed.
 */
export function formatReleaseDate(isoDate: string | null | undefined): string {
  if (!isoDate) return 'soon'
  const date = new Date(isoDate)
  if (Number.isNaN(date.getTime())) return 'soon'
  const today = new Date()
  const sameYear = date.getUTCFullYear() === today.getUTCFullYear()
  return date.toLocaleDateString('en-AU', {
    month: 'long',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
    timeZone: 'UTC',
  })
}
