# Google Drive integration

Legatograph can import drone clips directly from Google Drive instead of uploading them to Supabase Storage. The Drive file ID is stored on the clip row; at render time the server streams the file straight from Drive into a temp dir, runs the compose pipeline, then deletes the temp file. **Nothing is mirrored into Supabase Storage** — this keeps storage cost flat regardless of how much source footage you have.

## Trade-offs

| | Drive | Supabase Storage |
|---|---|---|
| Per-file size cap | Drive's per-file limit (5 TB) | 50 MB free / 50 GB Pro |
| Upload time | None — already on Drive | Multi-GB clips: minutes-to-hours |
| Render time | +seconds per clip (download) | Negligible |
| Cost at terabytes of source | Free | Expensive |
| Auth | One shared folder per artist | Per-user via RLS |

Drive is the right default for source clips. Tracks (your audio masters) still upload to Supabase Storage because they're much smaller and used by the hook detector immediately.

## Two auth modes

| | OAuth (recommended) | API key |
|---|---|---|
| Auth | "Sign in with Google" once per artist | None — uses a server-side API key |
| Folder visibility | Can read **private** folders the user has access to | Folder must be **publicly shared** ("Anyone with the link") |
| Per-file quota | Effectively unlimited (per-user) | Google's anonymous quota: roughly 100 MB / file / day, often less for popular folders |
| Best for | Production use; iterating on the same folder repeatedly | One-off public-folder imports without sign-in friction |

The app supports both. If both are configured, OAuth takes precedence per-artist (once that artist connects); API key is the fallback. Configure both for the safest setup, OAuth alone is fine if you don't want anonymous fallback.

## One-time setup (OAuth — recommended)

### 1. Create OAuth credentials

1. Open the [Google Cloud Console → APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials).
2. **Create Credentials → OAuth client ID**. If asked, configure the OAuth consent screen first:
   - User type: **External** (for personal Google accounts) or **Internal** (Workspace).
   - App name: Legatograph. Support email: yours.
   - Scopes: add `https://www.googleapis.com/auth/drive.readonly`.
   - Test users: add your own Google account email if the app is in **Testing** mode.
3. Back at **Create OAuth client ID**: type **Web application**.
4. Authorized redirect URIs: add `http://localhost:3000/api/integrations/google/callback`. For production, also add your deployed URL with the same path.
5. **Create** → copy the **Client ID** and **Client secret**.

### 2. Add credentials to `.env.local`

```bash
GOOGLE_OAUTH_CLIENT_ID=...apps.googleusercontent.com
GOOGLE_OAUTH_CLIENT_SECRET=...
```

Restart `npm run dev` so the new env vars are picked up.

### 3. Connect Google Drive in the vault

1. Open [http://localhost:3000/vault](http://localhost:3000/vault) → **Clips** tab.
2. Click **Connect Google Drive**. You'll redirect to Google's consent screen, grant Drive read access, then redirect back.
3. The banner should say "Google Drive connected". You can now import private folders (no public sharing required) and won't hit the per-file anonymous quotas.

To disconnect: click **Disconnect** next to the Google Drive status. This revokes the token on Google's side and deletes it from our database.

## One-time setup (API key — fallback / public folders only)

### 1. Get a Google API key

1. Open the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project (or reuse one). Name doesn't matter; "Legatograph" works.
3. From the left menu: **APIs & Services → Library → search for "Google Drive API" → Enable**.
4. Then: **APIs & Services → Credentials → Create Credentials → API key**.
5. Copy the key shown.
6. Click **Edit API key** on the new entry. Under **API restrictions** pick **Restrict key** and select only **Google Drive API**. This stops the key from being usable for anything else if it leaks.

### 2. Add the key to `.env.local`

```bash
GOOGLE_API_KEY=AIzaSy...
```

Restart `npm run dev` so the new env var is picked up.

### 3. Share your clips folder publicly

The API key can only read files marked as "Anyone with the link can view".

1. In Google Drive, right-click the folder containing your drone clips → **Share**.
2. Under **General access**, change from "Restricted" to **"Anyone with the link"**.
3. Role: **Viewer** (Editor would also work; Viewer is enough).
4. Click **Copy link** — you'll paste this in Legatograph.

The folder URL looks like:
```
https://drive.google.com/drive/folders/1IkkIYY6PV-EukVsNbO_ySXLNJ7ofVfA1?usp=sharing
```

Knowing the unguessable folder ID is the access token. Don't post the URL publicly.

## Importing a folder

1. Open [http://localhost:3000/vault](http://localhost:3000/vault) → **Clips** tab.
2. Paste the folder URL into **Import from Google Drive** → click **Import**.
3. The server lists every video file in the folder, skips ones already imported, and creates clip rows referencing the Drive file IDs. The actual files stay in Drive.
4. The vault grid shows Drive clips with a small `drive` badge in the corner; thumbnails come from Drive directly (no API key in the URL, safe to expose).

Re-running an import is idempotent — the unique index on `(artist_id, gdrive_file_id)` (migration 0005) means already-imported files are skipped silently.

## How rendering works

When you queue a render that uses a Drive clip:

1. The render API resolves each clip ID to either a Supabase Storage path (`source = 'upload'`) or a Drive file ID (`source = 'gdrive'`).
2. The render engine downloads each Drive clip via `https://www.googleapis.com/drive/v3/files/<id>?alt=media&key=…`, streaming directly to a temp file (no buffering — large files are fine).
3. ffmpeg + Remotion compose the reel from the temp files exactly as for uploaded clips.
4. Temp files are deleted after the render finishes.

Each render incurs one Drive download per clip. A typical reel uses 4–6 clips; with a fast connection this adds seconds, not minutes.

## Troubleshooting

**"The download quota for this file has been exceeded"** — Google's per-file anonymous quota (resets every ~24 h). This only affects the API-key path. Connecting Google Drive via OAuth in the vault eliminates the quota entirely — the download counts against your per-user quota, which is effectively unlimited.

**"Drive folder lookup failed: HTTP 403"** — the folder isn't accessible to whichever auth is in play. For API key: share the folder as "Anyone with the link". For OAuth: make sure the signed-in user has at least Viewer access to the folder.

**"Drive folder lookup failed: HTTP 404"** — the folder ID is wrong, or it was deleted / moved out of the user's scope.

**"No video files found in that folder"** — files exist but Drive's `mimeType` doesn't start with `video/`. Check Drive thinks they're videos (raw `.mov` files sometimes end up tagged as `application/octet-stream`).

**"No Drive auth configured"** — neither OAuth nor `GOOGLE_API_KEY` is set up. Either connect Drive in the vault or set the env var. See setup sections above.

**OAuth: "Google did not return a refresh token"** — the user previously approved the app, so Google skips refresh-token issuance. Fix: visit [Google Account → Security → Apps with access](https://myaccount.google.com/permissions), remove "Legatograph", and reconnect from the vault.

## What's NOT supported (yet)

- **Per-file imports** — only folder imports right now. Easy to add if needed (the helper exposes `getFileMetadata` and `extractFileId`).
- **Watch / sync** — imports are one-shot. Add a clip to Drive, you need to re-run the import to pick it up. A scheduled `db:push` could sync nightly if that becomes painful.
- **Tracks (audio) from Drive** — only clips. Tracks are usually under 100 MB so the upload-to-Supabase path is fine; the hook detector reads them immediately and we need them in our control plane.
