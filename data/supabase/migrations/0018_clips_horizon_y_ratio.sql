-- Cache the dominant horizon line of each clip so renders don't need to
-- re-run frame-by-frame edge detection on every job. Ratio is 0..1 of
-- the source frame height (0 = top, 1 = bottom). Null means "not yet
-- detected" — the render path will detect and persist lazily, and a
-- one-shot backfill script can prime existing rows.
--
-- The stored value is the horizon on the *source* clip — the aspect
-- ratio crop applied at render time may shift this slightly for
-- aspects that vertically crop the source. The render-time safety cap
-- on translateY keeps that misalignment invisible.

alter table public.clips
  add column if not exists horizon_y_ratio numeric;

alter table public.clips
  add constraint clips_horizon_y_ratio_range
  check (horizon_y_ratio is null or (horizon_y_ratio >= 0 and horizon_y_ratio <= 1));
