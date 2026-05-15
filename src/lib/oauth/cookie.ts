export const OAUTH_COOKIE_NAME = 'legatograph_google_oauth'
export const OAUTH_COOKIE_MAX_AGE_SECONDS = 600 // 10 min

export type OAuthCookiePayload = {
  state: string
  artistId: string
  returnTo: string
}
