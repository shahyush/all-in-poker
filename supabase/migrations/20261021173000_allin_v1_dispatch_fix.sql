-- Migration 5/5: fix the scheduler dispatch function (APPLIED 2026-10-21 17:37 UTC via apply_migration).
-- The previous body declared a plpgsql variable `key` that collided with app_settings.key ("column reference key is
-- ambiguous"), so every cron tick failed as soon as a table was due; the empty early-return path hid it from monitoring.
-- Existing data: untouched (function body only). Rollback: redeploy the previous body from migration 20261021140300.
-- Locally this file is applied too (bootstrap_local.sql stubs net.http_post) so server tests cover the dispatch path.
create or replace function public.allin_dispatch_due() returns integer
language plpgsql security definer set search_path = public as $$
declare v_ids jsonb; v_url text; v_anon text; v_key text;
begin
  v_ids := public.allin_claim_due('{"limit": 10}'::jsonb);
  if v_ids is null or jsonb_array_length(v_ids) = 0 then return 0; end if;
  select s.value into v_url  from public.app_settings s where s.key = 'function_url';
  select s.value into v_anon from public.app_settings s where s.key = 'anon_key';
  select s.value into v_key  from public.app_settings s where s.key = 'job_key';
  if v_url is null or v_key is null then return -1; end if;
  perform net.http_post(
    url := v_url || '/jobs',
    body := jsonb_build_object('tableIds', v_ids),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-allin-job', v_key, 'apikey', coalesce(v_anon, '')),
    timeout_milliseconds := 8000
  );
  return jsonb_array_length(v_ids);
end $$;
