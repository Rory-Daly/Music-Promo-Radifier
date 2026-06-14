export const POST_PULSE_OAUTH_COOKIE = 'legatograph_post_pulse_oauth'
export const POST_PULSE_OAUTH_COOKIE_MAX_AGE = 600 // 10 min

export type PostPulseOAuthCookiePayload = {
  state: string
  returnTo: string
}
