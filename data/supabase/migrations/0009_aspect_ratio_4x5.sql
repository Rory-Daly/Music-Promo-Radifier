-- Add 4x5 (Instagram feed portrait) to the renders.aspect_ratio enum so
-- multi-format renders can target IG feed alongside Reel / Story / Short.

alter table public.renders drop constraint if exists renders_aspect_ratio_check;
alter table public.renders add constraint renders_aspect_ratio_check
  check (aspect_ratio in ('9x16', '1x1', '16x9', '4x5'));
