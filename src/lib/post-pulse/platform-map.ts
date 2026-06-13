/**
 * Maps Legatograph's internal platform enum (`posts.platform`) onto the
 * shape Post-Pulse's `/v1/posts` endpoint expects for `platformSettings`.
 *
 * Single source of truth — the publish endpoint, tests, and any future
 * caption-length pre-flight all read from here.
 *
 * Bundle mining (June 2026) confirmed these `type` strings:
 *   INSTAGRAM, TIK_TOK, YOUTUBE, FACEBOOK, TWITTER, LINKEDIN
 * Note `TIK_TOK` has an underscore, and X is `TWITTER` in the API.
 *
 * `threads` is in our enum but Post-Pulse's exact string isn't in the
 * public bundle — marked `assumed`. Verify the first time we wire it.
 * `yt_short` never goes through Post-Pulse (native YouTube path), so it
 * intentionally has no mapping.
 */

export type AppPlatform =
  | 'ig_reel'
  | 'ig_story'
  | 'ig_feed'
  | 'tiktok'
  | 'yt_short'
  | 'x'
  | 'threads'
  | 'fb'

export type PostPulsePlatformSettings = { type: string } & Record<string, unknown>

type Entry = {
  /** Used by callers to decide whether to send via Post-Pulse at all. */
  postPulseSupported: boolean
  /** Caption length cap from Post-Pulse's per-platform mediaRules. */
  captionMaxChars: number
  /** Builder so callers can override platform-specific knobs later. */
  buildPlatformSettings: () => PostPulsePlatformSettings
  /** True when the `type` string isn't verified against live API yet. */
  assumed?: boolean
}

const map: Record<AppPlatform, Entry> = {
  ig_reel: {
    postPulseSupported: true,
    captionMaxChars: 2200,
    buildPlatformSettings: () => ({ type: 'INSTAGRAM', publicationType: 'REELS' }),
  },
  ig_story: {
    postPulseSupported: true,
    captionMaxChars: 2200,
    buildPlatformSettings: () => ({ type: 'INSTAGRAM', publicationType: 'STORY' }),
  },
  ig_feed: {
    postPulseSupported: true,
    captionMaxChars: 2200,
    buildPlatformSettings: () => ({ type: 'INSTAGRAM', publicationType: 'FEED' }),
  },
  tiktok: {
    postPulseSupported: true,
    captionMaxChars: 2200,
    buildPlatformSettings: () => ({
      type: 'TIK_TOK',
      privacyLevel: 'PUBLIC_TO_EVERYONE',
    }),
  },
  yt_short: {
    postPulseSupported: false,
    captionMaxChars: 5000,
    buildPlatformSettings: () => {
      throw new Error('yt_short publishes via the native YouTube API, not Post-Pulse')
    },
  },
  x: {
    postPulseSupported: true,
    captionMaxChars: 280,
    buildPlatformSettings: () => ({ type: 'TWITTER' }),
  },
  threads: {
    postPulseSupported: true,
    captionMaxChars: 500,
    buildPlatformSettings: () => ({ type: 'THREADS' }),
    assumed: true,
  },
  fb: {
    postPulseSupported: true,
    captionMaxChars: 63206,
    buildPlatformSettings: () => ({ type: 'FACEBOOK', publicationType: 'FEED' }),
  },
}

export function getPostPulseMapping(platform: AppPlatform): Entry {
  return map[platform]
}

export function isPostPulseSupported(platform: AppPlatform): boolean {
  return map[platform].postPulseSupported
}
