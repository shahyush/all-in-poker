-- Rollback-only hosted integration check. Run only when no table has timers.
-- Expected: all assertions pass; no game or cron state is committed.
begin;
do $test$
declare tid uuid; jid bigint;
begin
 if exists(select 1 from public.tables where due_at is not null and archived_at is null) then raise exception 'Active timers appeared; abort test'; end if;
 select jobid into jid from cron.job where jobname='allin-dispatch-due';
 if (select active from cron.job where jobid=jid) then raise exception 'Idle did not sleep'; end if;
 select id into tid from public.tables where archived_at is not null limit 1;
 if tid is null then raise exception 'No rollback-only test row available'; end if;
 update public.tables set archived_at=null,due_at=now()+interval '1 hour' where id=tid;
 if not (select active from cron.job where jobid=jid) then raise exception 'New timer failed to wake dispatcher'; end if;
 perform public.allin_sync_dispatcher();
 if not (select active from cron.job where jobid=jid) then raise exception 'Future timer incorrectly slept'; end if;
 update public.tables set due_at=null where id=tid;
 perform public.allin_sync_dispatcher();
 if (select active from cron.job where jobid=jid) then raise exception 'Final timer removal failed to sleep'; end if;
 if has_function_privilege('authenticated','public.allin_sync_dispatcher()','EXECUTE') then raise exception 'Client privilege leaked'; end if;
end $test$;
rollback;
