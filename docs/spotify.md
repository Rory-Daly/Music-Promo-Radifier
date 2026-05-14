# Spotify Web API setup

We use the Spotify Web API for:

- **Track metadata** — title, album, artwork, release date, ISRC. Used to enrich our local track records and generate smart links. **Client Credentials flow** (server-to-server, no user login).
- **Spotify for Artists / user-scoped data** *(later)* — will require user OAuth (Authorization Code flow).

> **Audio Analysis (sections, beats, tempo) is NOT available to us.** Spotify deprecated `/v1/audio-analysis`, `/v1/audio-features`, `/v1/recommendations`, related-artists, and a few others in **November 2024** for new apps. Pre-existing apps were grandfathered; ours (created after that cut-off) returns 403. We've pivoted to local audio analysis (FFmpeg-based) as the primary path. Confirmed 2026-05-13 by hitting the endpoint against both a private track and a known-public public track — both 403. Do not waste time retrying the audio-analysis endpoint.

## Create the Spotify dev app

1. Go to the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard).
2. Log in with your Spotify account (the artist account is fine).
3. Click **Create app**.
4. Fill in:
   - **App name:** any (e.g. "illutible promo tool")
   - **App description:** any (e.g. "internal automation")
   - **Redirect URI:** `http://127.0.0.1:3000/api/integrations/spotify/callback`
   - **Which API/SDKs are you planning to use:** check **Web API**
5. Agree to terms → **Save**.
6. On the app's page click **Settings** → copy **Client ID** and **Client Secret** into `.env.local`:

   ```
   SPOTIFY_CLIENT_ID=...
   SPOTIFY_CLIENT_SECRET=...
   ```

## Redirect URI gotcha

Spotify rejects:

- `http://localhost:...` — `localhost` is explicitly disallowed in their dashboard.
- `http://<any-non-loopback>:...` — non-HTTPS is rejected unless it's a loopback IP.

Spotify accepts:

- `https://...` — anything HTTPS.
- `http://127.0.0.1:PORT/...` — explicit IPv4 loopback.
- `http://[::1]:PORT/...` — explicit IPv6 loopback.

Use `http://127.0.0.1:3000/api/integrations/spotify/callback` for local development. When we deploy to Vercel later, add the production HTTPS URL alongside it (Spotify lets you list multiple).

The redirect URI is **unused by the hook detector** (Client Credentials flow doesn't redirect), but Spotify requires you to configure one at app-creation time anyway. The same app will reuse it when we add user-OAuth flows later.
