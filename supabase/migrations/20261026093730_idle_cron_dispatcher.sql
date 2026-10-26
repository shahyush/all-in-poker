-- Sleep the high-frequency dispatcher when no game has pending timers.
-- The wake trigger and idle check share a transaction lock so a concurrent
-- new timer cannot be lost between the idle check and disabling the job.
create or replace function public.allin_sync_dispatcher()
returns void language plpgsql security definer set search_path = pg_catalog as $$
declare v_id bigint; v_active boolean; v_needed boolean;
begin
  perform pg_advisory_xact_lock(71426093730::bigint);
  select jobid, active into v_id, v_active from cron.job
    where jobname = 'allin-dispatch-due';
  if v_id is null then raise exception 'All In dispatcher is missing'; end if;
  select exists(select 1 from public.tables
    where due_at is not null and archived_at is null) into v_needed;
  if v_active is distinct from v_needed then
    perform cron.alter_job(v_id, active := v_needed);
  end if;
end $$;
revoke all on function public.allin_sync_dispatcher() from public, anon, authenticated, service_role;

create or replace function public.allin_wake_dispatcher()
returns trigger language plpgsql security definer set search_path = pg_catalog as $$
begin
  -- Only a newly scheduled table needs the wake path. Ordinary game updates
  -- don't lock or write cron configuration.
  if TG_OP = 'UPDATE' then
    if OLD.due_at is not null and OLD.archived_at is null then return NEW; end if;
  end if;
  perform public.allin_sync_dispatcher();
  return NEW;
end $$;
revoke all on function public.allin_wake_dispatcher() from public, anon, authenticated, service_role;
create trigger allin_wake_dispatcher
after insert or update of due_at, archived_at on public.tables
for each row when (NEW.due_at is not null and NEW.archived_at is null)
execute function public.allin_wake_dispatcher();

-- Reconcile once a minute: sleep after the last game ends, and recover if an
-- operator disables the dispatcher while a table still needs it.
select cron.schedule('allin-dispatch-watchdog', '* * * * *',
  'select public.allin_sync_dispatcher();');
select public.allin_sync_dispatcher();

-- Bound scheduler history; never delete accounting or game records.
select cron.schedule('allin-cron-cleanup', '* * * * *', $job$
with expired as (
  select runid from cron.job_run_details
  where jobid in (select jobid from cron.job where jobname in
    ('allin-dispatch-due','allin-cron-cleanup','allin-dispatch-watchdog'))
    and end_time < now() - interval '2 hours'
  order by runid limit 1000
)
delete from cron.job_run_details d using expired e where d.runid=e.runid;
$job$);

-- Rollback: unschedule allin-dispatch-watchdog, drop the wake trigger and
-- both functions, then cron.alter_job(dispatcher_jobid, active := true).
