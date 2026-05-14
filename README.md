# Legatograph

A reel composer for instrumental musicians. Track in → 9:16 reel out: detect the most reel-worthy 15-30s hook, beat-align cuts to bars (rock-solid auto BPM and downbeat detection), splice your own footage at downbeats, layer brand overlays.

Currently in standalone CLI form. See `PROJECT_SPEC.md` for the broader multi-artist app v1 scope. Built for the artist [illutible](https://soundcloud.com/illutible).

## Commands

```bash
# Detect the top reel-worthy moments in a track
npm run hooks:detect -- tracks/my-track.wav

# Compose a beat-aligned reel
npm run reel:compose -- --audio=tracks/my-track.wav --hook=1:36-1:56 \
                        --clipsFolder="clips/Drone clips" --output=out/reel.mp4

# Full help
npm run reel:compose -- --help
```

## Stack

Next.js 15 + TypeScript, Remotion for video rendering, FFmpeg + custom DSP for tempo/beat detection, Tailwind for UI (when the app layer comes), Supabase for the multi-artist data layer (planned).
