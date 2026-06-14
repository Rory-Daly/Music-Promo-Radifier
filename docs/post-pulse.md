# Post-Pulse integration

[Post-Pulse](https://post-pulse.com/) is Legatograph's one-API publishing vendor for IG / TikTok / X / Threads / Facebook / Bluesky / Telegram / LinkedIn. (YouTube Shorts publish via the **native** YouTube Data API — see [docs/youtube.md](youtube.md) or [src/lib/youtube/upload.ts](../src/lib/youtube/upload.ts) — because it's free and avoids per-publication metering.)

> **OAuth-only, no static API keys.** Post-Pulse retired the static workspace API key during their developer onboarding overhaul (mid-2026). The only path for "Direct API integration" is the OAuth 2.0 authorization-code flow against `auth.post-pulse.com`. Legatograph runs the dance once during setup, persists the refresh token in Supabase, and exchanges it for short-lived access tokens on every publish.

> **What's confirmed vs. assumed.** This doc records what's been verified against [post-pulse.com](https://post-pulse.com/) and the developer SPA bundle. Some details (webhook signature scheme, account-list endpoint shape, refresh-token rotation behaviour) aren't in their public docs and are marked **ASSUMED — verify**. Update this file the first time real traffic disproves an assumption.

## How the publishing path works

1. **Render** lands in Supabase Storage at a public URL (`renders.output_url`).
2. **Send to Post-Pulse:** the publish endpoint POSTs `{url: <render_url>}` to `/v1/media/upload/import` → gets back a media `path`.
3. **Create the post:** POSTs `/v1/posts` with one `publications` entry (`socialMediaAccountId`, `platformSettings.type`, plus the platform's extra keys), `scheduledTime` (if scheduling), and `posts: [{ content, attachmentPaths: [path] }]`.
4. **Post-Pulse holds it** until `scheduledTime`, then publishes natively. It calls our webhook (`/api/post-pulse/webhook`) when the post lands or fails.
5. **Webhook updates** the `posts` row → `status='published' | 'failed'`, `permalink`, `error`.

Every API call to `api.post-pulse.com` carries a workspace access token. The token store at [src/lib/post-pulse/tokens.ts](../src/lib/post-pulse/tokens.ts) auto-refreshes via the stored refresh_token whenever the access_token is within 60s of expiry, and the client retries once on 401 in case of rotation.

YouTube stays on its native path in [src/app/api/posts/[id]/publish/route.ts](../src/app/api/posts/%5Bid%5D/publish/route.ts) — different code path entirely, free, no Post-Pulse involvement.

## One-time setup

### 1. Create the OAuth app in Post-Pulse

1. Open [post-pulse.com](https://post-pulse.com/) and create an account. Sign-up gives you 10 free publications, no card.
2. The login wizard asks **"How do you want to publish?"** Pick **"Direct API integration → my own app"**.
3. On the **"Create your API credentials"** screen:
   - Note the **Client ID**.
   - Click **REVEAL** on the secret; copy it.
   - Click **EDIT** on REDIRECT URLS and replace any defaults with:
     - `http://localhost:3030/api/post-pulse/oauth-callback` (for local dev)
     - `https://<your-prod-domain>/api/post-pulse/oauth-callback` (for prod, if deployed)
4. **Verify `offline_access` is in your app's allowed scopes.** Without it the token endpoint won't return a refresh token, and Legatograph will be locked out within 24h of every connection. If the wizard doesn't expose scope configuration directly, email Post-Pulse support and ask them to enable `offline_access` on your app.

### 2. Wire the credentials into Legatograph

Add to [.env.local](../.env.local):

```bash
POST_PULSE_CLIENT_ID=fAxUGg7…
POST_PULSE_CLIENT_SECRET=<the revealed secret>
POST_PULSE_WEBHOOK_SECRET=<any strong random string>
```

For prod: same vars in the Vercel project. The webhook secret is one value you choose and paste into Post-Pulse's dashboard webhook config (see step 4).

### 3. Run the OAuth dance

1. Restart `npm run dev` so the new env vars are loaded.
2. Visit [http://localhost:3030/settings](http://localhost:3030/settings).
3. Click **Connect Post-Pulse**. You'll be redirected to `auth.post-pulse.com/authorize`, sign in / consent, and bounce back to `/api/post-pulse/oauth-callback`. On success the page shows "Post-Pulse connected." and a green banner.
4. Tokens (access + refresh + expiry) are now persisted in the `post_pulse_workspace` table (single row, service-role-only — see migration `0021_post_pulse_workspace_tokens.sql`).

If you ever need to rotate credentials (e.g. the secret was leaked), click **Disconnect Post-Pulse** on the same page, regenerate the secret in Post-Pulse, update `.env.local`, and run **Connect Post-Pulse** again.

### 4. Connect your socials inside Post-Pulse

Done in the **Post-Pulse dashboard**, not in Legatograph. For each platform (IG, TikTok, X, Threads, FB, …):

1. Post-Pulse dashboard → **Accounts** → **Connect [platform]** → complete that platform's OAuth.
2. Once connected each account gets a numeric `socialMediaAccountId`. You'll need it in step 6.

### 5. Configure the webhook in Post-Pulse

Post-Pulse dashboard → **Webhooks** → add an endpoint:

- **URL:** `https://<your-domain>/api/post-pulse/webhook` (use ngrok or similar for local dev)
- **Secret:** paste the same value you put in `POST_PULSE_WEBHOOK_SECRET`
- **Events:** post status updates (success + failure)

### 6. Link Post-Pulse accounts to Legatograph artists

In Legatograph: [http://localhost:3030/settings](http://localhost:3030/settings).

1. Pick the artist.
2. For each platform you'll publish to, paste the `socialMediaAccountId` from step 4 + the display handle (e.g. `@illutible`).
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

## OAuth reference

### Endpoints

| | URL |
|---|---|
| Authorize | `https://auth.post-pulse.com/authorize` |
| Token | `https://auth.post-pulse.com/oauth/token` |
| API base | `https://api.post-pulse.com` |
| API audience | `https://api.post-pulse.com` (sent as `audience=` param on authorize) |

### Scopes

Legatograph requests:

- `postpulse-api/accounts.read` — list connected social accounts
- `postpulse-api/posts.write` — create scheduled posts
- `postpulse-api/media.write` — import render URLs to Post-Pulse media library
- `offline_access` — issue a refresh token (required; without it the access token expires silently)

### Token lifetime — **ASSUMED, verify**

Auth0-style tenants typically issue ~24h access tokens and long-lived refresh tokens. Refresh-token rotation may or may not be enabled — if it is, every refresh issues a new refresh_token and the previous one becomes invalid. The token store at [src/lib/post-pulse/tokens.ts](../src/lib/post-pulse/tokens.ts) handles both modes: it persists the new refresh_token when one is returned, and keeps the old one when it isn't.

### Refresh-on-401

The client at [src/lib/post-pulse/client.ts](../src/lib/post-pulse/client.ts) catches 401 responses, calls `forceRefreshPostPulseAccessToken()`, and retries the original request once. This handles two cases:

1. **Clock skew** — our `expires_at` says the token is valid but Post-Pulse rejects it.
2. **Out-of-band rotation** — a parallel request rotated the refresh token, so our cached access token has been superseded.

If the refresh itself fails (refresh_token revoked or expired), the client throws `PostPulseNotConnectedError` and the caller surfaces "visit /settings to reconnect" to the user.

## API reference (what we use)

Base URL: `https://api.post-pulse.com`. Auth: `Authorization: Bearer ${accessToken}` on every request — the token comes from the workspace token store, not an env var.

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

**"POST_PULSE_CLIENT_ID and POST_PULSE_CLIENT_SECRET are not set on the server"** — add them to [.env.local](../.env.local) and restart `npm run dev`. The Settings page shows an amber banner when only one of the two is set.

**"Post-Pulse is not connected"** — visit [/settings](http://localhost:3030/settings) and click **Connect Post-Pulse** to run the OAuth dance. Publishing will fail with HTTP 412 until tokens are stored.

**Connect Post-Pulse → "Post-Pulse did not return a refresh token"** — the `offline_access` scope isn't enabled on your Post-Pulse app, so the token endpoint only issued a 24h access token. Without a refresh token the workspace will be locked out as soon as the access token expires. Open the Post-Pulse dashboard → your app's scope settings (or email support) and ensure `offline_access` is in the allowed scopes list. Disconnect and reconnect.

**"No social connection for `<artist>` on `<platform>`"** — visit [/settings](http://localhost:3030/settings), pick the artist, paste the `socialMediaAccountId` from the Post-Pulse dashboard.

**`401 Unauthorized` from Post-Pulse after a long idle period** — the client auto-refreshes on 401 once. If both attempts fail, the refresh_token has been revoked or expired. Disconnect and reconnect in /settings.

**Landed on `auth.post-pulse.com/authorize?…&redirect_uri=<YOUR_REDIRECT_URI>&…` and saw "Oops!, something went wrong"** — this is Post-Pulse's onboarding wizard's literal placeholder. The real flow runs from [/settings](http://localhost:3030/settings) → **Connect Post-Pulse**, which constructs the authorize URL with the actual `redirect_uri` set. Don't follow the wizard's "open in browser" link verbatim.

**Webhook fires but `posts` row doesn't update** — signature verification is failing. Check the request log: the `X-PostPulse-Signature` header should match `HMAC-SHA256(raw_body, POST_PULSE_WEBHOOK_SECRET)`. If Post-Pulse uses a different header name or algorithm, fix [src/lib/post-pulse/webhook.ts](../src/lib/post-pulse/webhook.ts) and update this doc.

**Post stuck in `scheduled` past its time** — Post-Pulse holds the schedule, so the cron job at [src/app/api/cron/publish-scheduled/route.ts](../src/app/api/cron/publish-scheduled/route.ts) is a safety net only (it re-sends posts that didn't reach Post-Pulse the first time). If Post-Pulse has the post but didn't fire it, inspect the Post-Pulse dashboard for status.
