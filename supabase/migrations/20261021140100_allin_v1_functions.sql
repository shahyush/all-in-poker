-- Service-only transactional functions used by the API. Clients never call these.

create or replace function public.allin_now()
returns bigint language sql stable as $$ select (extract(epoch from clock_timestamp()) * 1000)::bigint $$;
create or replace function public.allin_now(p jsonb)
returns jsonb language sql stable as $$ select to_jsonb((extract(epoch from clock_timestamp()) * 1000)::bigint) $$;
revoke all on function public.allin_now(jsonb) from public;
grant execute on function public.allin_now(jsonb) to service_role;

-- Load everything a command handler needs for one table in a single round trip.
create or replace function public.allin_load(p jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare t public.tables%rowtype; sec jsonb; mem jsonb; res jsonb;
begin
  select * into t from public.tables where id = (p->>'table_id')::uuid;
  if not found then return jsonb_build_object('found', false, 'now', public.allin_now()); end if;
  select secret into sec from public.table_secrets where table_id = t.id;
  select coalesce(jsonb_agg(jsonb_build_object('user_id', m.user_id, 'role', m.role, 'seat', m.seat, 'status', m.status,
           'last_seen', (extract(epoch from m.last_seen) * 1000)::bigint, 'joined_at', (extract(epoch from m.joined_at) * 1000)::bigint,
           'name', pr.display_name, 'avatar', pr.avatar) order by m.joined_at), '[]'::jsonb)
    into mem from public.table_members m join public.profiles pr on pr.id = m.user_id where m.table_id = t.id;
  res := jsonb_build_object(
    'found', true, 'now', public.allin_now(),
    'table', jsonb_build_object('id', t.id, 'name', t.name, 'host_id', t.host_id, 'invite_code', t.invite_code, 'config', t.config,
      'status', t.status, 'version', t.version, 'mode', t.mode, 'seats', t.seats, 'host_epoch', t.host_epoch,
      'due_at', (extract(epoch from t.due_at) * 1000)::bigint, 'archived_at', t.archived_at, 'summary', t.summary, 'seq', t.seq,
      'created_at', (extract(epoch from t.created_at) * 1000)::bigint),
    'secret', sec, 'members', mem);
  return res;
end $$;
revoke all on function public.allin_load(jsonb) from public;
grant execute on function public.allin_load(jsonb) to service_role;

-- Atomic compare-and-swap commit of one table transition with all side effects.
create or replace function public.allin_commit(p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  tid uuid := (p->>'table_id')::uuid;
  expected int := (p->>'expected_version')::int;
  cur int; newv int; r jsonb; due timestamptz; m jsonb; existing_receipt jsonb;
begin
  -- idempotency: an identical receipt already stored returns its original result without touching state
  if p ? 'receipt' and (p->'receipt') is not null and jsonb_typeof(p->'receipt') = 'object' then
    select jsonb_build_object('status', c.status, 'result', c.result, 'request_hash', c.request_hash) into existing_receipt
      from public.command_receipts c where c.user_id = (p->'receipt'->>'user_id')::uuid and c.action_id = (p->'receipt'->>'action_id')::uuid;
    if existing_receipt is not null then
      return jsonb_build_object('ok', false, 'duplicate', true, 'receipt', existing_receipt);
    end if;
  end if;

  if coalesce((p->>'create')::boolean, false) then
    insert into public.tables (id, name, host_id, invite_code, config, status, state, version, mode, seats, host_epoch, due_at, seq, started_at)
    values (tid, p->>'name', (p->>'host_id')::uuid, p->>'invite_code', coalesce(p->'config', '{}'::jsonb), p->>'status', p->'public_state', 1,
            p->>'mode', (p->>'seats')::int, coalesce((p->>'host_epoch')::int, 1), to_timestamp((p->>'due_at')::double precision / 1000.0), coalesce((p->>'seq')::bigint, 0), null);
    insert into public.table_secrets (table_id, secret) values (tid, p->'private_state');
    newv := 1;
  else
    select version into cur from public.tables where id = tid for update;
    if not found then return jsonb_build_object('ok', false, 'missing', true); end if;
    if cur <> expected then return jsonb_build_object('ok', false, 'conflict', true, 'version', cur); end if;
    newv := cur + 1;
    due := case when p->>'due_at' is null then null else to_timestamp((p->>'due_at')::double precision / 1000.0) end;
    update public.tables set
      state = coalesce(p->'public_state', state), version = newv, status = coalesce(p->>'status', status),
      host_id = coalesce((p->>'host_id')::uuid, host_id), host_epoch = coalesce((p->>'host_epoch')::int, host_epoch),
      due_at = due, job_lease_until = null, seq = coalesce((p->>'seq')::bigint, seq),
      started_at = coalesce(case when p->>'started_at' is null then null else to_timestamp((p->>'started_at')::double precision / 1000.0) end, started_at),
      updated_at = now()
    where id = tid;
    if p ? 'private_state' and (p->'private_state') is not null and jsonb_typeof(p->'private_state') <> 'null' then
      insert into public.table_secrets (table_id, secret, updated_at) values (tid, p->'private_state', now())
        on conflict (table_id) do update set secret = excluded.secret, updated_at = now();
    end if;
  end if;

  if p ? 'touch' and (p->>'touch') is not null then
    update public.table_members set last_seen = now() where table_id = tid and user_id = (p->>'touch')::uuid;
  end if;

  -- members (upsert)
  for m in select * from jsonb_array_elements(coalesce(p->'members', '[]'::jsonb)) loop
    insert into public.table_members (table_id, user_id, role, seat, status, joined_at, last_seen, removed_at)
    values (tid, (m->>'user_id')::uuid, coalesce(m->>'role', 'player'), (m->>'seat')::int, coalesce(m->>'status', 'active'), now(), now(),
            case when m->>'status' in ('removed','left') then now() else null end)
    on conflict (table_id, user_id) do update set
      role = coalesce(excluded.role, public.table_members.role),
      seat = case when m ? 'seat' then excluded.seat else public.table_members.seat end,
      status = coalesce(excluded.status, public.table_members.status),
      removed_at = case when excluded.status in ('removed','left') then now() else null end,
      joined_at = case when public.table_members.status in ('removed','left') and excluded.status = 'active' then now() else public.table_members.joined_at end;
  end loop;

  -- hole cards: replace the table's private cards when provided
  if p ? 'hole_cards' and jsonb_typeof(p->'hole_cards') = 'array' then
    delete from public.hole_cards where table_id = tid;
    insert into public.hole_cards (table_id, user_id, hand_no, hand_id, cards)
      select tid, (h->>'user_id')::uuid, (h->>'hand_no')::int, h->>'hand_id', array(select jsonb_array_elements_text(h->'cards'))::int[]
      from jsonb_array_elements(p->'hole_cards') h;
  end if;

  -- durable history (idempotent per hand number)
  insert into public.hand_history (table_id, hand_no, hand_id, results)
    select tid, (h->>'hand_no')::int, h->>'hand_id', h->'record' from jsonb_array_elements(coalesce(p->'history', '[]'::jsonb)) h
    on conflict (table_id, hand_no) do nothing;

  -- ledger (unique source ids make credits exactly-once)
  insert into public.ledger (table_id, user_id, kind, amount, source_id, hand_no)
    select tid, (l->>'user_id')::uuid, l->>'kind', (l->>'amount')::bigint, l->>'source_id', coalesce((l->>'hand_no')::int, 0)
    from jsonb_array_elements(coalesce(p->'ledger', '[]'::jsonb)) l
    on conflict (source_id) do nothing;

  -- participants (archive-safe accounts)
  for m in select * from jsonb_array_elements(coalesce(p->'participants', '[]'::jsonb)) loop
    insert into public.session_participants (table_id, user_id, name, joined_at, left_at, added, taken_off, final_stack, place)
    values (tid, (m->>'user_id')::uuid, coalesce(m->>'name', ''), now(), case when m ? 'left_at' then now() else null end,
            coalesce((m->>'added_delta')::bigint, 0), coalesce((m->>'taken_off_delta')::bigint, 0), (m->>'final_stack')::bigint, (m->>'place')::int)
    on conflict (table_id, user_id) do update set
      name = coalesce(nullif(excluded.name, ''), public.session_participants.name),
      left_at = case when m ? 'left_at' then now() when m ? 'rejoined' then null else public.session_participants.left_at end,
      added = public.session_participants.added + coalesce((m->>'added_delta')::bigint, 0),
      taken_off = public.session_participants.taken_off + coalesce((m->>'taken_off_delta')::bigint, 0),
      final_stack = coalesce(excluded.final_stack, public.session_participants.final_stack),
      place = coalesce(excluded.place, public.session_participants.place);
  end loop;

  -- reload request transitions
  for m in select * from jsonb_array_elements(coalesce(p->'reloads', '[]'::jsonb)) loop
    if m ? 'insert' then
      insert into public.reload_requests (id, table_id, user_id, amount, status, requested_at)
      values ((m->>'id')::uuid, tid, (m->>'user_id')::uuid, (m->>'amount')::bigint, 'requested', now())
      on conflict (id) do nothing;
    else
      update public.reload_requests set status = m->>'status',
        decided_at = case when m->>'status' in ('approved','rejected','cancelled') then now() else decided_at end,
        decided_by = coalesce((m->>'decided_by')::uuid, decided_by), host_epoch = coalesce((m->>'host_epoch')::int, host_epoch),
        credited_hand_no = coalesce((m->>'credited_hand_no')::int, credited_hand_no)
      where id = (m->>'id')::uuid and table_id = tid and status = coalesce(m->>'from_status', status);
    end if;
  end loop;

  -- chat
  for m in select * from jsonb_array_elements(coalesce(p->'chat', '[]'::jsonb)) loop
    insert into public.chat_messages (table_id, user_id, body) values (tid, (m->>'user_id')::uuid, m->>'body');
  end loop;

  -- archive: delete volatile live state, keep durable rows
  if p ? 'archive' and jsonb_typeof(p->'archive') = 'object' then
    delete from public.table_secrets where table_id = tid;
    delete from public.hole_cards where table_id = tid;
    delete from public.chat_messages where table_id = tid;
    update public.table_members set status = 'left', removed_at = coalesce(removed_at, now()) where table_id = tid and status = 'active';
    update public.reload_requests set status = 'cancelled', decided_at = now() where table_id = tid and status in ('requested','approved');
    update public.tables set archived_at = now(), due_at = null, summary = coalesce(p->'archive'->'summary', summary) where id = tid;
    insert into public.table_tombstones (table_id, reason) values (tid, p->'archive'->>'reason') on conflict do nothing;
  end if;

  if p ? 'diagnostic' and jsonb_typeof(p->'diagnostic') = 'object' then
    insert into public.diagnostics (table_id, kind, detail) values (tid, p->'diagnostic'->>'kind', p->'diagnostic');
  end if;

  -- receipt
  if p ? 'receipt' and jsonb_typeof(p->'receipt') = 'object' then
    insert into public.command_receipts (user_id, action_id, request_hash, status, result)
    values ((p->'receipt'->>'user_id')::uuid, (p->'receipt'->>'action_id')::uuid, p->'receipt'->>'request_hash', (p->'receipt'->>'status')::int, p->'receipt'->'result')
    on conflict do nothing;
  end if;

  return jsonb_build_object('ok', true, 'version', newv);
end $$;
revoke all on function public.allin_commit(jsonb) from public;
grant execute on function public.allin_commit(jsonb) to service_role;

-- Store a command receipt outside a table transition (e.g. rejected commands).
create or replace function public.allin_receipt(p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare existing jsonb;
begin
  select jsonb_build_object('status', c.status, 'result', c.result, 'request_hash', c.request_hash) into existing
    from public.command_receipts c where c.user_id = (p->>'user_id')::uuid and c.action_id = (p->>'action_id')::uuid;
  if existing is not null then return jsonb_build_object('duplicate', true, 'receipt', existing); end if;
  insert into public.command_receipts (user_id, action_id, request_hash, status, result)
    values ((p->>'user_id')::uuid, (p->>'action_id')::uuid, p->>'request_hash', (p->>'status')::int, p->'result')
    on conflict do nothing;
  return jsonb_build_object('duplicate', false);
end $$;
revoke all on function public.allin_receipt(jsonb) from public;
grant execute on function public.allin_receipt(jsonb) to service_role;

-- Rate limiting helper: count attempts of a kind by a key within a window and record this one.
create or replace function public.allin_attempt(p jsonb)
returns int language plpgsql volatile security definer set search_path = public as $$
declare c int;
begin
  delete from public.invite_attempts where at < now() - interval '1 day';
  select count(*) into c from public.invite_attempts where user_id = (p->>'key')::uuid and kind = p->>'kind' and at > now() - make_interval(secs => (p->>'window_s')::int);
  if c < (p->>'limit')::int then insert into public.invite_attempts (user_id, kind) values ((p->>'key')::uuid, p->>'kind'); end if;
  return c;
end $$;
revoke all on function public.allin_attempt(jsonb) from public;
grant execute on function public.allin_attempt(jsonb) to service_role;

-- Lease due tables for the job runner (called by pg_cron; also usable by tests).
create or replace function public.allin_claim_due(p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare ids jsonb;
begin
  with due as (
    select id from public.tables
    where due_at is not null and due_at <= now() and (job_lease_until is null or job_lease_until < now()) and archived_at is null
    order by due_at limit coalesce((p->>'limit')::int, 10)
    for update skip locked
  ), leased as (
    update public.tables t set job_lease_until = now() + interval '8 seconds' from due where t.id = due.id returning t.id
  )
  select coalesce(jsonb_agg(id), '[]'::jsonb) into ids from leased;
  return ids;
end $$;
revoke all on function public.allin_claim_due(jsonb) from public;
grant execute on function public.allin_claim_due(jsonb) to service_role;
