-- Autonomous timers: pg_cron polls for due tables every second and asks the API (via pg_net) to resolve them.
-- Production only (requires pg_cron and pg_net, available on the hosted platform).
create extension if not exists pg_cron;
create extension if not exists pg_net;

insert into public.app_settings (key, value)
  values ('job_key', encode(extensions.gen_random_bytes(32), 'hex'))
  on conflict (key) do nothing;

create or replace function public.allin_dispatch_due()
returns int language plpgsql volatile security definer set search_path = public as $$
declare ids jsonb; fn_url text; anon text; key text;
begin
  ids := public.allin_claim_due('{"limit": 10}'::jsonb);
  if jsonb_array_length(ids) = 0 then return 0; end if;
  select value into fn_url from public.app_settings where key = 'function_url';
  select value into anon from public.app_settings where key = 'anon_key';
  select value into key from public.app_settings where key = 'job_key';
  if fn_url is null or key is null then return -1; end if;
  perform net.http_post(
    url := fn_url || '/jobs',
    body := jsonb_build_object('tableIds', ids),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-allin-job', key, 'apikey', coalesce(anon, '')),
    timeout_milliseconds := 8000
  );
  return jsonb_array_length(ids);
end $$;
revoke all on function public.allin_dispatch_due() from public;

-- a table whose lease expired without a commit is simply claimed again on the next tick (idempotent handler)
do $$
begin
  if exists (select 1 from cron.job where jobname = 'allin-dispatch-due') then perform cron.unschedule('allin-dispatch-due'); end if;
  perform cron.schedule('allin-dispatch-due', '1 seconds', $cron$ select public.allin_dispatch_due(); $cron$);
end $$;

-- keep cron history small
do $$
begin
  if exists (select 1 from cron.job where jobname = 'allin-cron-cleanup') then perform cron.unschedule('allin-cron-cleanup'); end if;
  perform cron.schedule('allin-cron-cleanup', '17 * * * *', $cron$ delete from cron.job_run_details where end_time < now() - interval '2 hours'; $cron$);
end $$;
