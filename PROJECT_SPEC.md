# Project Specification — Legatograph

> Source of truth for v1 scope, data model, and architecture. Update this file before adding/changing user-facing functionality.

## Overview

**Problem being solved:**
Independent musicians who release regularly (every 4-6 weeks) lose hours per release on the same three bottlenecks: creating content, editing video, and posting to every platform manually. The work is largely repetitive, but generic schedulers (Buffer, Later) don't help with the creative production, and video editors (CapCut) don't help with cross-posting or campaigns.

**Core value proposition:**
Track in → ten posts out, scheduled and published. The tool finds the most reel-worthy moments in a track, auto-cuts them against the artist's own footage (drone, behind-the-scenes, performance), renders platform-specific variants in a consistent brand, and publishes everywhere in one approval step.

**Target users:**

- **Primary (v1):** illutible (Rory Daly) — Brisbane-based instrumental electronic producer, ~10 releases/year, 206-track back catalogue, drone footage as primary visual asset, targeting both listeners and sync (soundtrack/game) licensing.
- **Secondary (v2+):** Other independent instrumental/electronic/cinematic artists with similar workflows. Multi-artist from day 1 in the data model so this transition is cheap.

**Positioning angle:** "100% human-made." The tool automates *workflow* (transcription, beat detection, scheduling, cross-posting). It does **not** fabricate creative output. Visuals come from the artist's own footage; music comes from the artist's tracks. AI is a workflow accelerator, not a content generator. This is a deliberate positioning choice in an AI-saturated content landscape.

---

## Feature List (v1 only)

### In scope

- [ ] **Multi-artist workspaces** — auth scoped to artists; one user can manage many artists; every asset belongs to an artist.
- [ ] **Asset vault** — upload/import tracks (audio + artwork), import drone clips from Google Drive, tag clips by mood/location/time-of-day.
- [x] **Brand kit per artist** — fonts, colours, logo, smart-link template, default hashtag/caption presets. Pre-seeded with the illutible aesthetic for the primary artist. *(v1: viewer + JSON editor; structured field editors deferred.)*
- [ ] **Hook detector** — given an uploaded audio file, surface the 3-5 most reel-worthy 15-30s sections using local audio analysis (FFmpeg → RMS energy curve → score by mean energy × contrast × position). **Note:** Spotify's Audio Analysis API (sections/beats/tempo) was originally planned as the primary path; it was deprecated for new apps in Nov 2024 and returns 403 for our app. See [docs/spotify.md](docs/spotify.md). Beat-aligned cutting (for the auto-cut composer) will need a separate local beat-tracker — likely [essentia.js](https://essentia.upf.edu/essentiajs.html) — added when we wire video rendering.
- [ ] **Auto-cut composer (Remotion)** — given a chosen hook and a set of drone clips, render reel variants for IG Reel (9:16), IG Story (9:16), IG feed (1:1), TikTok (9:16), YouTube Short (9:16), and X/Threads (16:9 or 1:1). Cuts on beat. Overlays artwork, title card, smart-link CTA. Reusable templates so output stays brand-consistent across releases.
- [x] **Caption generator** — drafts platform-specific captions (TikTok punchy, IG vibe, YT SEO-friendly) using track metadata and brand kit voice. User edits + approves. *(v1: POST /api/captions/draft against `claude-opus-4-7` with adaptive thinking + low effort + prompt-cached voice system prompt; per-platform editable preview in compose. Needs `ANTHROPIC_API_KEY`.)*
- [ ] **Multi-platform publisher** — schedule or post to IG (Reels/Story/Feed), TikTok, YouTube Shorts, X, Threads, Facebook via Ayrshare. One approval, fans out. Per-artist account connections.
- [ ] **Release campaign templates** — given a release date, autogenerate a calendar of 8-12 post slots across a 4-week window (tease, countdown, drop day, behind-scenes, alt cuts, follow-ups). User batch-approves drafts.
- [x] **Smart link generator** — single URL → all DSPs (linkfire-style). Per-track. Public page at `/r/<artist>/<track>` fans out to Spotify/Apple/YouTube/Bandcamp/SoundCloud/Tidal/Deezer using the artist's `brand_kit.smart_link.dsps`. Track slugs auto-generated on upload.

### Out of scope (v2+)

- Performance analytics loop (metrics back to "which hooks/cuts/captions converted").
- Trending audio/format radar.
- Sync licensing pitch tooling (B2B outbound to filmmakers/game devs).
- Fan DM automation, comment management.
- Spotify Canvas generation.
- Talking-head/lyric video features (not applicable to instrumental catalogue).
- Public landing/marketing site for the tool itself.
- Stripe billing and tiered plans (only relevant if/when opening to other artists).

---

## User Roles & Permissions

| Role | Can do | Cannot do |
|---|---|---|
| **Owner** (artist account holder, v1 = Rory) | Everything: manage artists, vault, brand, publish, schedule, connect socials, invite collaborators (v2). | — |
| **Collaborator** (v2+, e.g. manager) | View vault, draft posts, schedule. Cannot disconnect socials or delete artist. | Billing, artist deletion, social account removal. |

v1 ships with Owner only. Schema supports Collaborator from day 1 so v2 is additive.

---

## Data Models

All tables include `id uuid primary key`, `created_at timestamptz default now()`, `updated_at timestamptz`. Supabase RLS enforces artist-scoped access.

### `users`
| Field | Type | Notes |
|---|---|---|
| id | uuid | from auth.users |
| email | text | |
| name | text | |

### `artists` (the central tenancy boundary)
| Field | Type | Notes |
|---|---|---|
| name | text | display name |
| slug | text | URL-safe |
| bio | text | |
| contact_email | text | |
| brand_kit | jsonb | fonts, colours, logo asset id, smart-link template, caption presets |

### `artist_memberships` (user ↔ artist join)
| Field | Type | Notes |
|---|---|---|
| user_id | uuid → users | |
| artist_id | uuid → artists | |
| role | enum | `owner` \| `collaborator` |

### `tracks`
| Field | Type | Notes |
|---|---|---|
| artist_id | uuid → artists | |
| title | text | |
| audio_url | text | storage path |
| artwork_url | text | storage path |
| release_date | date | nullable for unreleased |
| spotify_id | text | nullable; used for Audio Analysis API |
| isrc | text | nullable |
| smart_link_url | text | generated |
| duration_seconds | int | |
| analysis | jsonb | cached audio analysis (beats, sections, hooks) |

### `clips` (drone footage and other visual assets)
| Field | Type | Notes |
|---|---|---|
| artist_id | uuid → artists | |
| source | enum | `gdrive` \| `upload` |
| gdrive_file_id | text | nullable |
| storage_url | text | local copy in Supabase Storage if synced |
| duration_seconds | float | |
| width / height | int | |
| tags | text[] | mood, location, time-of-day, weather |
| thumbnail_url | text | |

### `hooks` (detected reel-worthy sections per track)
| Field | Type | Notes |
|---|---|---|
| track_id | uuid → tracks | |
| start_seconds | float | |
| end_seconds | float | |
| score | float | confidence/energy score |
| label | text | e.g. "drop", "build", "main hook" |

### `renders` (a rendered video output)
| Field | Type | Notes |
|---|---|---|
| artist_id | uuid → artists | |
| track_id | uuid → tracks | |
| hook_id | uuid → hooks | |
| template_id | text | which Remotion composition |
| aspect_ratio | enum | `9x16` \| `1x1` \| `16x9` |
| platform | enum | `ig_reel` \| `ig_story` \| `ig_feed` \| `tiktok` \| `yt_short` \| `x` \| `threads` \| `fb` |
| clip_ids | uuid[] | which clips were used |
| output_url | text | storage path |
| status | enum | `queued` \| `rendering` \| `ready` \| `failed` |

### `posts`
| Field | Type | Notes |
|---|---|---|
| artist_id | uuid → artists | |
| render_id | uuid → renders | |
| platform | enum | as above |
| caption | text | |
| hashtags | text[] | |
| scheduled_for | timestamptz | nullable = post now |
| status | enum | `draft` \| `scheduled` \| `published` \| `failed` |
| ayrshare_post_id | text | external id |
| permalink | text | URL of published post |
| error | text | nullable |

### `campaigns` (release campaign)
| Field | Type | Notes |
|---|---|---|
| artist_id | uuid → artists | |
| track_id | uuid → tracks | |
| release_date | date | |
| template | text | which campaign template (e.g. `4_week_single`) |

### `social_connections`
| Field | Type | Notes |
|---|---|---|
| artist_id | uuid → artists | |
| platform | enum | as above |
| ayrshare_profile_key | text | encrypted |
| display_handle | text | |

### `integrations`
| Field | Type | Notes |
|---|---|---|
| user_id | uuid → users | |
| provider | enum | `google_drive` \| `spotify` |
| refresh_token | text | encrypted |
| scopes | text[] | |

---

## Pages & User Flows

### Dashboard — `/`
**Who sees it:** Owner.
**Purpose:** Quick view of current artist, upcoming scheduled posts, recent renders, current/next campaign.

### Artist switcher — top nav
**Purpose:** Switch active artist context; "Create new artist" CTA.

### Vault — `/vault`
- **Tracks tab:** list + upload; for each, show artwork, status (analysed/not), hooks detected.
- **Clips tab:** grid of drone clips with thumbnails, filters by tag. "Import from Google Drive" button → OAuth flow → folder picker → background sync.
- **Brand tab:** edit brand kit (fonts, colours, logo, smart-link template, voice/tone preset).

### Track detail — `/tracks/[id]`
**Purpose:** Pick a hook, pick clips, render variants.
Key interactions:
- Waveform with detected hook markers; user selects one (or trims).
- "Suggest clips" → tool proposes clips matching the track's mood/energy; user can add/remove.
- "Render variants" → kicks off renders for selected platforms; user previews each before publishing.

### Compose — `/compose`
**Purpose:** Skip the per-track flow and build a single post manually (e.g. behind-the-scenes content not tied to a release).

### Campaigns — `/campaigns`
- List campaigns by artist.
- New campaign → pick track + release date + template → tool drafts 8-12 posts → user batch-approves.

### Calendar — `/calendar`
**Purpose:** See all scheduled and published posts across platforms. Drag-reschedule.

### Settings — `/settings`
- Connected socials (per artist) via Ayrshare.
- Connected integrations (Google Drive, Spotify) per user.
- Team members (v2).

---

## API Endpoints

| Method | Route | Auth | Description |
|---|---|---|---|
| POST | `/api/tracks` | required | Create track (metadata + audio upload). |
| POST | `/api/tracks/[id]/analyse` | required | Trigger hook detection (Spotify or local). |
| POST | `/api/clips/import/gdrive` | required | Pull selected Drive files into vault. |
| POST | `/api/renders` | required | Queue a render job (track + hook + clips + template + platform). |
| GET | `/api/renders/[id]` | required | Poll render status. |
| POST | `/api/posts` | required | Create draft post tied to a render. |
| POST | `/api/posts/[id]/publish` | required | Send to Ayrshare (immediate or scheduled). |
| POST | `/api/posts/[id]/schedule` | required | Update scheduled time. |
| POST | `/api/campaigns` | required | Create campaign + draft posts. |
| POST | `/api/integrations/google/callback` | required | OAuth callback. |
| POST | `/api/integrations/spotify/callback` | required | OAuth callback. |
| POST | `/api/ayrshare/webhook` | public + signed | Status callbacks from Ayrshare. |

All inputs validated with Zod (per project conventions).

---

## Error States

- [ ] Network failure on any external API (Spotify, Drive, Ayrshare) — retry with backoff; surface to user with retry CTA.
- [ ] Auth/OAuth token expired — silent refresh; on failure, prompt re-connect.
- [ ] Render failure (Remotion crash, FFmpeg error) — mark render `failed`, show error inline, allow retry.
- [ ] Ayrshare post rejection (e.g. IG aspect ratio off, TikTok caption too long) — surface specific error from Ayrshare; suggest fix.
- [ ] Spotify track not yet released (no analysis available) — fallback to local audio analysis.
- [ ] Google Drive file too large or unsupported codec — flag during import; suggest re-export.
- [ ] User exceeds Ayrshare plan limits — warn before scheduling; link to upgrade.

---

## Tech Stack Decisions

| Layer | Choice | Why |
|---|---|---|
| Frontend | Next.js 15 + TypeScript | Per project template; Vercel-native. |
| Styling | Tailwind CSS | Per project conventions. |
| Database | Supabase Postgres | Auth, Storage, RLS, realtime — all in one. RLS is critical for per-artist tenancy. |
| Auth | Supabase Auth | Email magic link to start; OAuth (Google) later. |
| File storage | Supabase Storage | Audio, artwork, rendered videos, clip thumbnails. |
| Video rendering | [Remotion](https://www.remotion.dev) | React-based programmatic video; version-controlled templates; brand consistency. Self-host renderer initially; move to Remotion Lambda if/when volume justifies. |
| Audio analysis | Local: FFmpeg → RMS energy curve. Beat tracking later via essentia.js (WASM). | Spotify Audio Analysis deprecated for new apps Nov 2024 (returns 403 — see docs/spotify.md). Local analysis is the only viable path. |
| Social publishing | [Ayrshare](https://www.ayrshare.com) | One API for IG/TikTok/YT Shorts/X/Threads/FB; avoids fighting six native APIs and their review processes. |
| Google Drive | Google Drive API v3 | Direct import of drone footage without manual download/upload. |
| SoundCloud ingestion | [yt-dlp](https://github.com/yt-dlp/yt-dlp) CLI shelled out from `/api/vault/tracks/soundcloud` | SoundCloud's official API is closed to new app registrations. yt-dlp is the only reliable path to fetch audio from a public SoundCloud URL. Install: `brew install yt-dlp` on macOS; package manager or the standalone binary on Linux/Vercel. |
| Smart links | Self-hosted (simple per-DSP redirect) or [Linkfire](https://www.linkfire.com)/[Songwhip](https://songwhip.com) | Start self-hosted; switch if it becomes a maintenance burden. |
| Deployment | Vercel | Per template. |
| Background jobs | Vercel cron + Supabase queue table | Renders, scheduled posts, Drive sync. Upgrade to dedicated worker (Inngest/Trigger.dev) only if needed. |

---

## Environment Variables

```
# .env.example
NEXT_PUBLIC_APP_URL=http://localhost:3030

# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Spotify (Audio Analysis API)
SPOTIFY_CLIENT_ID=
SPOTIFY_CLIENT_SECRET=

# Google (Drive)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# Ayrshare
AYRSHARE_API_KEY=
AYRSHARE_WEBHOOK_SECRET=

# Remotion Lambda (only if/when we move off self-host)
REMOTION_AWS_ACCESS_KEY_ID=
REMOTION_AWS_SECRET_ACCESS_KEY=
REMOTION_AWS_REGION=
```

---

## Pricing & Cost Model (AUD, approximate)

| Service | Dev/early | Once publishing at volume |
|---|---|---|
| Supabase | Free tier | Pro ~$38/mo |
| Vercel | Free hobby | Pro ~$30/mo |
| Ayrshare | Basic ~$30/mo | Premium ~$225/mo |
| Remotion | Free self-host | Lambda ~$5-15/mo |
| Spotify API | Free | Free |
| Google Drive API | Free | Free |
| **Total** | **~$30-70/mo AUD** | **~$265-310/mo AUD** |

---

## Visual & Brand (illutible default kit)

Default brand kit for the primary artist, pre-seeded:

- **Wordmark/logo:** existing "illutible" stylised wordmark (white on black). Pull from SoundCloud avatar as starting asset.
- **Palette:** dark backgrounds (near-black), white text, accent from track artwork (sampled per track).
- **Aesthetic:** cinematic, atmospheric, slightly dystopian, painterly. Banner artwork sets the tone (dramatic skylines, weather, light).
- **Typography:** TBC. Default to a clean modern sans (Inter or similar) for UI; track titles in something with more character (TBC during design pass).
- **Voice/tone for captions:** evocative, sparse, mood-led. Avoid hype-bro voice. Sentence fragments OK. "Made by hand" is fine to surface occasionally but not in every caption.

---

## Multi-Artist Architecture Notes

Every domain table has `artist_id`. Supabase RLS policies enforce that a user can only read/write rows for artists they're a member of. No global queries — every query is artist-scoped from the API layer down.

Active artist is stored in user session/cookie. Artist switcher in nav changes the active scope; all pages re-fetch on switch.

Per-artist Ayrshare profile keys mean each artist has its own social account set — no cross-contamination of post destinations.

---

## Resolved Decisions

- **Product name** — **Legatograph**. Musical term *legato* (smoothly connected notes) + *-graph* (written / recorded). Fits the act of smoothly assembling track + footage at beat boundaries.
- **Smart links** — **self-host.** Simple per-track redirect page that fans out to all DSPs. One fewer SaaS bill. Lives in this app.
- **Social publishing** — **Ayrshare for v1.** Revisit moving to native APIs only if cost or feature gaps force it.
- **Sync licensing tooling** — **deferred to a later phase.** Definitely wanted, not in v1. Data model already accommodates per-track metadata (ISRC, mood tags) that future sync flows will need, so this is additive.
- **Render queue infra** — **start self-hosted on Vercel functions.** Measure render times in real use. Upgrade to Remotion Lambda or dedicated worker (Inngest/Trigger.dev) only when measured timeouts force the move.
- **Track analysis** — **local analysis on uploaded audio file** is the *only* path. Spotify Audio Analysis returns 403 for our (post-Nov-2024) app — see [docs/spotify.md](docs/spotify.md). SoundCloud API is closed to new app registrations and doesn't expose audio analysis anyway. So the flow for every track, released or not, is: artist uploads the audio file (WAV/MP3 export from their DAW), tool runs local analysis (FFmpeg → RMS energy → hook scoring). Beat tracking via essentia.js will be added when we wire video rendering, since beat-aligned cuts matter then.
- **Platform target** — **desktop-first for v1.** Posting may happen on phone in future, but the production-heavy workflow (rendering, batch approval, campaign planning) is desktop-native. Mobile-friendly is a v2 enhancement, not a v1 requirement.

## Open Questions

*(None blocking v1. Add here as new decisions arise.)*
