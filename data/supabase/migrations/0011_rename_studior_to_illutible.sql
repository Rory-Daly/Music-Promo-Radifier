-- Rename the auto-bootstrapped 'studior' artist (created from the
-- user's email handle by ensureFirstArtist) to 'illutible', and apply
-- the brand-kit seed payload from 0010 to it.
--
-- Background: migration 0010 used `where slug like 'illutible%' or
-- lower(name) = 'illutible'` to target the artist row, but the row's
-- name had been auto-derived from the user's email ('studior@…'), so
-- the WHERE clause matched zero rows. This migration corrects both:
-- the human-readable name and the brand_kit payload.
--
-- Idempotent: matches any artist whose current name/slug is either
-- 'studior' or 'illutible' (handles re-runs in any order). Slug becomes
-- the bare 'illutible' so future smart-link URLs at
-- /r/illutible/{track_slug} are clean.

update public.artists
set
  name = 'illutible',
  slug = 'illutible',
  brand_kit = jsonb_build_object(
    'version', 1,
    'tagline', 'cinematic hip hop, trip hop & downtempo',
    'location', 'Brisbane, Australia',

    'colours', jsonb_build_object(
      'bg',       '#0e0c0a',
      'bg_2',     '#16120e',
      'fg',       '#ece6dc',
      'fg_dim',   '#ece6dc9e',
      'fg_faint', '#ece6dc4d',
      'accent',   '#c9a06b',
      'accent_2', '#8a3a2a',
      'rule',     '#ece6dc24'
    ),

    'fonts', jsonb_build_object(
      'body', jsonb_build_object(
        'family', 'DM Sans',
        'google_font', 'DM Sans',
        'weights', jsonb_build_array(400, 500, 700)
      ),
      'display', jsonb_build_object(
        'family', 'Special Elite',
        'google_font', 'Special Elite',
        'weights', jsonb_build_array(400)
      ),
      'mono', jsonb_build_object(
        'family', 'JetBrains Mono',
        'google_font', 'JetBrains Mono',
        'weights', jsonb_build_array(400, 500)
      )
    ),

    'logo', jsonb_build_object(
      'wordmark_asset_id', null,
      'wordmark_storage_path', null,
      'casing', 'lowercase',
      'text_fallback', 'illutible'
    ),

    'smart_link', jsonb_build_object(
      'template', 'https://legatograph.app/r/illutible/{slug}',
      'dsps', jsonb_build_array(
        jsonb_build_object('platform', 'spotify',    'handle', '@illutible',      'url', 'https://open.spotify.com/artist/7MyS1G1tyAkJreuRKZXbk4'),
        jsonb_build_object('platform', 'apple',      'handle', '@illutible',      'url', 'https://music.apple.com/us/artist/illutible/1459962369'),
        jsonb_build_object('platform', 'youtube',    'handle', '@illutiblemusic', 'url', 'https://www.youtube.com/@illutiblemusic'),
        jsonb_build_object('platform', 'bandcamp',   'handle', '@illutible',      'url', 'https://illutible.bandcamp.com/'),
        jsonb_build_object('platform', 'soundcloud', 'handle', '/illutible',      'url', 'https://soundcloud.com/illutible'),
        jsonb_build_object('platform', 'tidal',      'handle', '@illutible',      'url', 'https://tidal.com/artist/15239393'),
        jsonb_build_object('platform', 'deezer',     'handle', '@illutible',      'url', 'https://www.deezer.com/us/artist/61270312')
      )
    ),

    'voice', jsonb_build_object(
      'register', 'evocative',
      'exemplars', jsonb_build_array(
        'Cinematic hip hop, trip hop & downtempo — music for film, games & good times.',
        'Sometimes it''s nice to feel sad.',
        'Original scores for short films, sync licensing, custom edits.'
      ),
      'avoid', jsonb_build_array(
        'Hype-bro voice (''this one goes hard'', ''banger alert'')',
        'Excessive emoji',
        'AI-generation language (''crafted by AI'', ''generated with'')',
        'Begging for engagement (''drop a like'', ''smash that follow'')'
      ),
      'max_chars_per_platform', jsonb_build_object(
        'x', 280,
        'threads', 500,
        'ig', 2200,
        'tiktok', 2200,
        'yt_short', 5000
      )
    ),

    'caption_presets', jsonb_build_array(
      jsonb_build_object(
        'id', 'tease',
        'label', 'Tease (pre-release)',
        'platforms', jsonb_build_array('ig_reel', 'tiktok', 'yt_short'),
        'template', '{track_title}. Coming {release_date}.' || E'\n\n' || '{smart_link}' || E'\n\n' || '{hashtags}'
      ),
      jsonb_build_object(
        'id', 'drop_day',
        'label', 'Drop day',
        'platforms', jsonb_build_array('ig_reel', 'tiktok', 'yt_short', 'x', 'threads'),
        'template', 'New: {track_title}.' || E'\n\n' || 'Everywhere now → {smart_link}' || E'\n\n' || '{hashtags}'
      ),
      jsonb_build_object(
        'id', 'behind',
        'label', 'Behind the scenes',
        'platforms', jsonb_build_array('ig_reel', 'ig_story', 'tiktok'),
        'template', '{location_or_mood}. Sound from {track_title}.' || E'\n\n' || '{smart_link}'
      ),
      jsonb_build_object(
        'id', 'sync_pitch',
        'label', 'Sync angle (film/game)',
        'platforms', jsonb_build_array('ig_reel', 'yt_short', 'x'),
        'template', '{track_title} — for the cut you haven''t made yet.' || E'\n' || 'Licensing: rory@illutible.com' || E'\n\n' || '{smart_link}'
      )
    ),

    'hashtag_presets', jsonb_build_object(
      'default', jsonb_build_array(
        '#cinematic', '#triphop', '#downtempo', '#instrumentalmusic',
        '#brisbanemusic', '#indieelectronic', '#filmmusic', '#syncmusic',
        '#dronefootage', '#illutible'
      ),
      'by_platform', jsonb_build_object(
        'ig_reel',  jsonb_build_array('#reels', '#reelsinstagram', '#cinematic', '#downtempo', '#instrumental'),
        'tiktok',   jsonb_build_array('#fyp', '#cinematictok', '#instrumental', '#downtempo', '#producer'),
        'yt_short', jsonb_build_array('#shorts', '#instrumental', '#cinematic', '#downtempo')
      )
    )
  ),
  updated_at = now()
where
  lower(name) in ('studior', 'illutible')
  or slug like 'studior-%'
  or slug like 'illutible%';
