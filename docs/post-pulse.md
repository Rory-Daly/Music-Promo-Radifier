# Post-Pulse integration

[Post-Pulse](https://post-pulse.com/) is Legatograph's one-API publishing vendor for IG / TikTok / X / Threads / Facebook / Bluesky / Telegram / LinkedIn. (YouTube Shorts publish via the **native** YouTube Data API — see [docs/youtube.md] or [src/lib/youtube/upload.ts](../src/lib/youtube/upload.ts) — because it's free and avoids per-publication metering.)

> **What's confirmed vs. assumed.** This doc records what's been verified against [post-pulse.com](https://post-pulse.com/) and the developer SPA bundle. Some details (webhook signature scheme, account-list endpoint shape) aren't in their public docs and are marked **ASSUMED — verify**. Update this file the first time real traffic disproves an assumption.

## How the publishing path works

1. **Render** lands in Supabase Storage at a public URL (`renders.output_url`).
2. **Send to Post-Pulse:** the publish endpoint POSTs `{url: <render_url>}` to `/v1/media/upload/import` → gets back a media `path`.
3. **Create the post:** POSTs `/v1/posts` with one `publications` entry (`socialMediaAccountId`, `platformSettings.type`, plus the platform's extra keys), `scheduledTime` (if scheduling), and `posts: [{ content, attachmentPaths: [path] }]`.
4. **Post-Pulse holds it** until `scheduledTime`, then publishes natively. It calls our webhook (`/api/post-pulse/webhook`) when the post lands or fails.
5. **Webhook updates** the `posts` row → `status='published' | 'failed'`, `permalink`, `error`.

YouTube stays on its native path in [src/app/api/posts/[id]/publish/route.ts](../src/app/api/posts/[id]/publish/route.ts) — different code path entirely, free, no Post-Pulse involvement.

## One-time setup

### 1. Sign up + workspace API key

1. Open [post-pulse.com](https://post-pulse.com/) and create an account. Sign-up gives you 10 free publications, no card.
2. Dashboard → generate an API key. This is one workspace-level key; it publishes on behalf of every connected social account in your workspace.
3. Add to [.env.local](../.env.local):
   ```bash
   POST_PULSE_API_KEY=pp_live_...
   POST_PULSE_WEBHOOK_SECRET=<any strong random string>
   ```
   For prod: same vars in the Vercel project. The webhook secret is one value you choose and paste into Post-Pulse's dashboard webhook config (see step 3).

### 2. Connect your socials inside Post-Pulse

Done in the **Post-Pulse dashboard**, not in Legatograph. For each platform (IG, TikTok, X, Threads, FB, …):

1. Post-Pulse dashboard → **Accounts** → **Connect [platform]** → complete that platform's OAuth.
2. Once connected each account gets a numeric `socialMediaAccountId`. You'll need it in step 4.

### 3. Configure the webhook in Post-Pulse

Post-Pulse dashboard → **Webhooks** → add an endpoint:

- **URL:** `https://<your-domain>/api/post-pulse/webhook` (use ngrok or similar for local dev)
- **Secret:** paste the same value you put in `POST_PULSE_WEBHOOK_SECRET`
- **Events:** post status updates (success + failure)

### 4. Link Post-Pulse accounts to Legatograph artists

In Legatograph: [http://localhost:3030/settings](http://localhost:3030/settings).

1. Pick the artist.
2. For each platform you'll publish to, paste the `socialMediaAccountId` from step 2 + the display handle (e.g. `@illutible`).
3. Save. The `social_connections` row binds (artist, platform) → Post-Pulse account.

This is per-artist so each artist's posts go to their own social accounts.

## Platform mapping

Our internal platform enum vs. the Post-Pulse `platformSettings.type` string and required extras:

| Our `posts.platform` | Post-Pulse `type` | Required `platformSettings` | Notes |
|---|---|---|---|
| `ig_reel` | `INSTAGRAM` | `publicationType: 'REELS'` | 9:16 |
| `ig_story` | `INSTAGRAM` | `publicationType: 'STORY'` | 9:16 |
| `ig_feed` | `INSTAGRAM` | `publicationType: 'FEED'` | 1:1 or 4:5 |
| `tiktok` | `TIK_TOK` | `privacyLevel: 'PUBLIC_TO_EVERYONE'` (configurable) | Note the underscore — `TIK_TOK`, not `TIKTOK` |
| `yt_short` | — | — | **Native YouTube path**, never goes through Post-Pulse |
| `x` | `TWITTER` | `type: 'POST'` (the inner enum) | API uses `TWITTER`, not `X` |
| `threads` | `THREADS` | — | **ASSUMED** — not in the bundle we mined |
| `fb` | `FACEBOOK` | `publicationType: 'FEED'` | |

The full mapping with caption-length limits per platform lives in [src/lib/post-pulse/platform-map.ts](../src/lib/post-pulse/platform-map.ts) (single source of truth).

## API reference (what we use)

Base URL: `https://api.post-pulse.com`. Auth: `Authorization: Bearer ${POST_PULSE_API_KEY}` on every request.

### `POST /v1/media/upload/import`

Imports a publicly-reachable URL into Post-Pulse's media library so it can be attached to posts.

```json
{ "url": "https://....supabase.co/storage/v1/object/public/renders/.../out.mp4" }
```

Returns `{ "path": "<opaque media path>" }`. Use that `path` in `attachmentPaths`.

### `POST /v1/posts`

```json
{
  "scheduledTime": "2026-06-20T10:00:00Z",   // omit for immediate
  "isDraft": false,
  "publications": [
    {
      "socialMediaAccountId": 123,
      "platformSettings": { "type": "INSTAGRAM", "publicationType": "REELS" },
      "posts": [
        { "content": "caption + hashtags", "attachmentPaths": ["<path from /media/upload/import>"] }
      ]
    }
  ]
}
```

Returns `{ "id": 9821, "overallStatus": "SCHEDULED" | "IN_PROGRESS" | "COMPLETED" | "PARTIALLY_COMPLETED" | "FAILED", "scheduledTime": "..." }`. Persist `id` as `posts.post_pulse_post_id`.

### `GET /v1/accounts` — **ASSUMED**

Used by the Settings page to surface "here are the accounts you've connected in Post-Pulse". The endpoint returns 401 to unauthed (so it exists), but the response shape isn't documented publicly. The client treats a failure here as a soft error: the page degrades to manual `socialMediaAccountId` entry. Verify shape on first real call and tighten the parser.

### Webhook — **signature scheme ASSUMED**

Post-Pulse's docs confirm "we call your webhook on success or failure" but the signature header name and HMAC scheme are not public. Implementation in [src/lib/post-pulse/webhook.ts](../src/lib/post-pulse/webhook.ts) verifies HMAC-SHA256(raw body, `POST_PULSE_WEBHOOK_SECRET`) against the `X-PostPulse-Signature` header — the standard scheme. If real deliveries fail signature verification, inspect the headers Post-Pulse actually sends and adjust the verifier in one place.

For local development: set `POST_PULSE_WEBHOOK_DEV_BYPASS=1` to skip verification. Never set this in any deployed environment.

### Errors and rate limits

Not publicly documented. The client maps any non-2xx into `PostPulseError` with the response body; the publish endpoint surfaces the message back to the UI so the user can act. Plan-limit and per-platform rejection codes will be discovered in production — extend the mapping in [src/lib/post-pulse/client.ts](../src/lib/post-pulse/client.ts) as we see them.

## Cost notes (current as of June 2026)

- $0.20 USD per publication, pay-as-you-go (no subscription, unlimited accounts) **or**
- $5 USD/connected account/month, unlimited posts.

Subscription tier wins above ~25 posts/account/month. At illutible's volume (≈10 releases/year × ~8 posts × ~5 platforms = ~400 posts/year), pay-as-you-go is the right default — roughly $80/year vs. ~$300/year on subscription.

## What's NOT supported (yet)

- **Account auto-discovery.** Settings page requires manually pasting the `socialMediaAccountId`. Auto-listing via `GET /v1/accounts` is partially wired and falls back to manual entry. Tighten once the response shape is confirmed.
- **Webhook event types beyond status updates.** No support for engagement/analytics callbacks — out of v1 scope per [PROJECT_SPEC.md](../PROJECT_SPEC.md).
- **Threads / Bluesky / Telegram** are valid Post-Pulse platforms but only `ig_*`, `tiktok`, `x`, `fb` are wired to publish. Threads is in our enum but the `type` string is marked ASSUMED — verify before relying on it.
- **Plan-limit pre-flight.** We don't currently warn the user before scheduling if they're near their Post-Pulse limit — we surface the error after the fact.

## Troubleshooting

**"POST_PULSE_API_KEY is not set"** — add it to [.env.local](../.env.local) and restart `npm run dev`.

**"No social connection for `<artist>` on `<platform>`"** — visit [/settings](http://localhost:3030/settings), pick the artist, paste the `socialMediaAccountId` from the Post-Pulse dashboard.

**`401 Unauthorized` from Post-Pulse** — API key is wrong, expired, or for a different workspace. Regenerate in the Post-Pulse dashboard.

**Webhook fires but `posts` row doesn't update** — signature verification is failing. Check the request log: the `X-PostPulse-Signature` header should match `HMAC-SHA256(raw_body, POST_PULSE_WEBHOOK_SECRET)`. If Post-Pulse uses a different header name or algorithm, fix [src/lib/post-pulse/webhook.ts](../src/lib/post-pulse/webhook.ts) and update this doc.

**Post stuck in `scheduled` past its time** — Post-Pulse holds the schedule, so the cron job at [src/app/api/cron/publish-scheduled/route.ts](../src/app/api/cron/publish-scheduled/route.ts) is a safety net only (it re-sends posts that didn't reach Post-Pulse the first time). If Post-Pulse has the post but didn't fire it, inspect the Post-Pulse dashboard for status.
