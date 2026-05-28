export const OAUTH_COOKIE_NAME = 'legatograph_google_oauth'
export const OAUTH_COOKIE_MAX_AGE_SECONDS = 600 // 10 min

export type OAuthProvider = 'google_drive' | 'youtube'

export type OAuthCookiePayload = {
  state: string
  artistId: string
  returnTo: string
  // Optional for backwards-compat with cookies written before the
  // YouTube integration landed — callbacks should default to
  // 'google_drive' when this field is missing.
  provider?: OAuthProvider
}
