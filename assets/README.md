# Brand assets

Project-level brand kit assets. Tracked in git so the brand travels with the code.

## illutible wordmark

Expected file: `assets/illutible-wordmark.png`

- White on transparent background (the composer renders over dark drone footage)
- High resolution — at least 1920×500 to scale cleanly to 9:16 reels at 1080p
- Source of truth: the artist's stylised wordmark (the dripping distressed lettering from the SoundCloud avatar/banner)

Once present, the composer (`scripts/compose-reel.ts`) loads it automatically and replaces the system-font text wordmark in `scripts/remotion/BasicReel.tsx`.

## Adding new artists

When the tool becomes multi-artist, each artist gets their own brand kit under `data/artist-assets/<artist-slug>/`. For v1 standalone (illutible only), brand assets live here at the project root.
