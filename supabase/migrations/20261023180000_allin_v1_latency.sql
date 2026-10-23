-- All In v1 — fewer round trips per command (latency). Additive: new function allin_begin, allin_load gains an
-- 'approved' key (approved reload requests), allin_chat gains membership + rate-limit + receipt handling.
-- Measured before this change on the hosted stack: a command made 6–7 sequential REST/RPC calls from the edge
-- function to Postgres (median 2.7 s per command). After: 3–4.
-- Rollback: drop function public.allin_begin(jsonb); re-create allin_load and allin_chat from the previous
--           migrations (20261021140100, 20261022160000). No table or data changes.

-- One call for what every admitted command needs first: the caller's active player and any prior receipt for
-- this action id (replay protection). Returns {player: null} when the auth user has no active profile.
create or replace function public.allin_begin(p jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare pl jsonb; rc jsonb;
begin
  select jsonb_build_object('id', pr.id, 'display_name', pr.display_name, 'avatar', pr.avatar, 'is_owner', pr.is_owner)
    into pl from public.profiles pr where pr.auth_user_id = (p->>'auth_uid')::uuid and pr.status = 'active' limit 1;
  if pl is null then return jsonb_build_object('player', null, 'receipt', null); end if;
  if p ? 'action_id' and (p->>'action_id') is not null then
    select jsonb_build_object('status', c.status, 'result', c.result, 'request_hash', c.request_hash) into rc
      from public.command_receipts c where c.user_id = (pl->>'id')::uuid and c.action_id = (p->>'action_id')::uuid;
  end if;
  return jsonb_build_object('player', pl, 'receipt', rc);
end $$;
revoke all on function public.allin_begin(jsonb) from public;
grant execute on function public.allin_begin(jsonb) to service_role;

-- allin_load: same shape as before plus 'approved' — the approved reload requests the commit needs as credits.
create or replace function public.allin_load(p jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare t public.tables%rowtype; sec jsonb; mem jsonb; appr jsonb; res jsonb;
begin
  select * into t from public.tables where id = (p->>'table_id')::uuid;
  if not found then return jsonb_build_object('found', false, 'now', public.allin_now()); end if;
  select secret into sec from public.table_secrets where table_id = t.id;
  select coalesce(jsonb_agg(jsonb_build_object('user_id', m.user_id, 'role', m.role, 'seat', m.seat, 'status', m.status,
           'last_seen', (extract(epoch from m.last_seen) * 1000)::bigint, 'joined_at', (extract(epoch from m.joined_at) * 1000)::bigint,
           'name', pr.display_name, 'avatar', pr.avatar) order by m.joined_at), '[]'::jsonb)
    into mem from public.table_members m join public.profiles pr on pr.id = m.user_id where m.table_id = t.id;
  select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'user_id', r.user_id, 'amount', r.amount) order by r.requested_at), '[]'::jsonb)
    into appr from public.reload_requests r where r.table_id = t.id and r.status = 'approved';
  res := jsonb_build_object(
    'found', true, 'now', public.allin_now(),
    'table', jsonb_build_object('id', t.id, 'name', t.name, 'host_id', t.host_id, 'invite_code', t.invite_code, 'config', t.config,
      'status', t.status, 'version', t.version, 'mode', t.mode, 'seats', t.seats, 'host_epoch', t.host_epoch,
      'due_at', (extract(epoch from t.due_at) * 1000)::bigint, 'archived_at', t.archived_at, 'summary', t.summary, 'seq', t.seq,
      'created_at', (extract(epoch from t.created_at) * 1000)::bigint),
    'secret', sec, 'members', mem, 'approved', appr);
  return res;
end $$;

-- allin_chat: membership check, rate limit (20 per 30 s per auth user) and the command receipt all happen here, in one
-- call, instead of three calls from the edge function. Idempotent on action_id as before.
create or replace function public.allin_chat(p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare tid uuid; uid uuid; aid uuid; mid bigint; c int;
begin
  tid := (p->>'table_id')::uuid; uid := (p->>'user_id')::uuid; aid := (p->>'action_id')::uuid;
  if not exists (select 1 from public.table_members m where m.table_id = tid and m.user_id = uid and m.status = 'active') then
    return jsonb_build_object('ok', false, 'error', 'not_member');
  end if;
  if p ? 'auth_uid' then
    c := public.allin_attempt(jsonb_build_object('key', p->>'auth_uid', 'kind', 'chat', 'limit', 20, 'window_s', 30));
    if c >= 20 then return jsonb_build_object('ok', false, 'error', 'rate_limited'); end if;
  end if;
  insert into public.chat_messages (table_id, user_id, body, action_id)
    values (tid, uid, p->>'body', aid)
    on conflict (action_id) where action_id is not null do nothing
    returning id into mid;
  if mid is null then
    select id into mid from public.chat_messages where action_id = aid;
  end if;
  if p ? 'receipt' and jsonb_typeof(p->'receipt') = 'object' then
    insert into public.command_receipts (user_id, action_id, request_hash, status, result)
    values ((p->'receipt'->>'user_id')::uuid, (p->'receipt'->>'action_id')::uuid, p->'receipt'->>'request_hash', (p->'receipt'->>'status')::int, p->'receipt'->'result')
    on conflict do nothing;
  end if;
  return jsonb_build_object('ok', true, 'id', mid);
end $$;
