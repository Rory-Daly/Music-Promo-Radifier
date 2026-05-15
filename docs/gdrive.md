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

## One-time setup

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

**"Drive folder lookup failed: HTTP 403"** — the folder isn't shared "Anyone with the link". Re-share it.

**"Drive folder lookup failed: HTTP 404"** — the folder ID is wrong, or the folder was deleted/moved out of the shared scope.

**"No video files found in that folder"** — files exist but Drive's `mimeType` doesn't start with `video/`. Check Drive thinks they're videos (sometimes raw `.mov` files end up tagged as `application/octet-stream`).

**Renders fail with "GOOGLE_API_KEY not set — cannot resolve Drive clip"** — the env var is missing from the server's environment. On Vercel, add it under **Settings → Environment Variables** for the appropriate environment and redeploy.

**API quota errors during a big import** — the default Drive API quota (10k requests / 100s / user) is more than enough for normal use; if you hit it, paste an audit script from [docs/supabase.md](supabase.md) to verify only your project is using the key.

## What's NOT supported (yet)

- **OAuth flow** — currently the folder must be publicly shared. A future enhancement: sign in with Google so private folders work and multi-user setups are properly isolated.
- **Per-file imports** — only folder imports right now. Easy to add if needed (the helper exposes `getFileMetadata` and `extractFileId`).
- **Watch / sync** — imports are one-shot. Add a clip to Drive, you need to re-run the import to pick it up. A scheduled `db:push` could sync nightly if that becomes painful.
- **Tracks (audio) from Drive** — only clips. Tracks are usually under 100 MB so the upload-to-Supabase path is fine; the hook detector reads them immediately and we need them in our control plane.
