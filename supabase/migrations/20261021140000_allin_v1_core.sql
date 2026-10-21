-- All In V1: forward-only migration on the existing project. No drops of user data.
-- Identity model: profiles.id is the stable player id; profiles.auth_user_id binds the current authenticated session.

create extension if not exists pgcrypto with schema extensions;

-- ---------- profiles: stable player identity ----------
alter table public.profiles
  add column if not exists auth_user_id uuid,
  add column if not exists avatar text,
  add column if not exists status text not null default 'active',
  add column if not exists admitted_at timestamptz,
  add column if not exists is_owner boolean not null default false,
  add column if not exists updated_at timestamptz not null default now();
update public.profiles set auth_user_id = id where auth_user_id is null;
alter table public.profiles drop constraint if exists profiles_id_fkey;
alter table public.profiles alter column id set default gen_random_uuid();
create unique index if not exists profiles_auth_user_idx on public.profiles(auth_user_id) where auth_user_id is not null;
alter table public.profiles drop constraint if exists profiles_status_check;
alter table public.profiles add constraint profiles_status_check check (status in ('active','revoked'));
alter table public.profiles drop constraint if exists profiles_avatar_check;
alter table public.profiles add constraint profiles_avatar_check check (avatar is null or char_length(avatar) <= 8);
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user();

-- ---------- group admission + recovery (server only) ----------
create table if not exists public.group_settings (
  id int primary key default 1 check (id = 1),
  password_hash bytea not null,
  password_salt bytea not null,
  iterations int not null default 210000,
  rotated_at timestamptz not null default now(),
  rotated_by uuid references public.profiles(id)
);
alter table public.group_settings enable row level security;

create table if not exists public.recovery_codes (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.profiles(id) on delete cascade,
  verifier bytea not null,
  created_at timestamptz not null default now(),
  used_at timestamptz,
  revoked_at timestamptz
);
create index if not exists recovery_codes_player_idx on public.recovery_codes(player_id);
alter table public.recovery_codes enable row level security;

-- rate limiting for admission / recovery / invite attempts (keyed by auth uid before admission)
alter table public.invite_attempts add column if not exists kind text not null default 'invite';
create index if not exists invite_attempts_user_kind_idx on public.invite_attempts(user_id, kind, at);

-- ---------- tables (live + archive) ----------
alter table public.tables
  add column if not exists mode text not null default 'cash',
  add column if not exists seats int not null default 9,
  add column if not exists due_at timestamptz,
  add column if not exists job_lease_until timestamptz,
  add column if not exists host_epoch int not null default 1,
  add column if not exists started_at timestamptz,
  add column if not exists archived_at timestamptz,
  add column if not exists summary jsonb,
  add column if not exists seq bigint not null default 0;
alter table public.tables drop constraint if exists tables_status_check;
alter table public.tables add constraint tables_status_check check (status in ('waiting','running','finished','abandoned','closed'));
alter table public.tables drop constraint if exists tables_mode_check;
alter table public.tables add constraint tables_mode_check check (mode in ('cash','tournament'));
create index if not exists tables_due_idx on public.tables(due_at) where due_at is not null;
update public.tables set summary = jsonb_build_object('legacy', true) where summary is null and status = 'closed';

alter table public.table_members
  add column if not exists seat int,
  add column if not exists status text not null default 'active',
  add column if not exists last_seen timestamptz,
  add column if not exists removed_at timestamptz;
alter table public.table_members drop constraint if exists table_members_status_check;
alter table public.table_members add constraint table_members_status_check check (status in ('active','removed','left'));
create unique index if not exists table_members_one_active_seat_idx on public.table_members(user_id) where status = 'active' and seat is not null;

-- private engine state (service only)
alter table public.table_secrets add column if not exists updated_at timestamptz not null default now();

-- hole cards: own private cards for the current hand
alter table public.hole_cards add column if not exists hand_id text;

-- hand history: durable public record
alter table public.hand_history add column if not exists hand_id text;

-- ---------- ledger, reloads, participants ----------
create table if not exists public.ledger (
  id bigint generated always as identity primary key,
  table_id uuid not null references public.tables(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  kind text not null check (kind in ('buyin','reload','exit')),
  amount bigint not null check (amount >= 0 and amount <= 1000000000000),
  source_id text not null unique,
  hand_no int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists ledger_table_idx on public.ledger(table_id, user_id);
alter table public.ledger enable row level security;

create table if not exists public.reload_requests (
  id uuid primary key,
  table_id uuid not null references public.tables(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  amount bigint not null check (amount > 0 and amount <= 1000000000000),
  status text not null check (status in ('requested','approved','rejected','cancelled','credited')),
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references public.profiles(id),
  host_epoch int,
  credited_hand_no int
);
create index if not exists reload_requests_table_idx on public.reload_requests(table_id, status);
alter table public.reload_requests enable row level security;

create table if not exists public.session_participants (
  table_id uuid not null references public.tables(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  name text not null,
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  added bigint not null default 0,
  taken_off bigint not null default 0,
  final_stack bigint,
  place int,
  primary key (table_id, user_id)
);
alter table public.session_participants enable row level security;

create table if not exists public.command_receipts (
  user_id uuid not null references public.profiles(id) on delete cascade,
  action_id uuid not null,
  request_hash text not null,
  status int not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, action_id)
);
alter table public.command_receipts enable row level security;

create table if not exists public.table_tombstones (
  table_id uuid primary key,
  closed_at timestamptz not null default now(),
  reason text not null
);
alter table public.table_tombstones enable row level security;

create table if not exists public.app_settings (
  key text primary key,
  value text not null
);
alter table public.app_settings enable row level security;

create table if not exists public.diagnostics (
  id bigint generated always as identity primary key,
  table_id uuid,
  kind text not null,
  detail jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.diagnostics enable row level security;

-- ---------- helper functions ----------
create or replace function public.current_player_id()
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.profiles where auth_user_id = auth.uid() and status = 'active' limit 1
$$;
revoke all on function public.current_player_id() from public;
grant execute on function public.current_player_id() to authenticated, service_role;

create or replace function public.is_member(t uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.table_members m
    where m.table_id = t and m.status = 'active' and m.user_id = public.current_player_id()
  )
$$;
revoke all on function public.is_member(uuid) from public;
grant execute on function public.is_member(uuid) to authenticated, service_role;

create or replace function public.is_participant(t uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.session_participants p
    where p.table_id = t and p.user_id = public.current_player_id()
  )
$$;
revoke all on function public.is_participant(uuid) from public;
grant execute on function public.is_participant(uuid) to authenticated, service_role;

create or replace function public.shares_table_with(other uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select other = public.current_player_id() or exists (
    select 1 from public.table_members a join public.table_members b on a.table_id = b.table_id
    where a.user_id = public.current_player_id() and a.status = 'active' and b.user_id = other and b.status = 'active'
  ) or exists (
    select 1 from public.session_participants a join public.session_participants b on a.table_id = b.table_id
    where a.user_id = public.current_player_id() and b.user_id = other
  )
$$;
revoke all on function public.shares_table_with(uuid) from public;
grant execute on function public.shares_table_with(uuid) to authenticated, service_role;

-- heartbeat: the only client-side write; records server receipt time for the caller's own membership
create or replace function public.heartbeat(t uuid)
returns timestamptz language plpgsql volatile security definer set search_path = public as $$
declare pid uuid := public.current_player_id();
begin
  if pid is null then raise exception 'not admitted' using errcode = '42501'; end if;
  update public.table_members set last_seen = now() where table_id = t and user_id = pid and status = 'active';
  return now();
end $$;
revoke all on function public.heartbeat(uuid) from public;
grant execute on function public.heartbeat(uuid) to authenticated, service_role;

-- ---------- RLS policies ----------
drop policy if exists "profiles readable by signed-in users" on public.profiles;
drop policy if exists "profiles self insert" on public.profiles;
drop policy if exists "profiles self update" on public.profiles;
drop policy if exists "profiles own or shared" on public.profiles;
create policy "profiles own or shared" on public.profiles for select to authenticated
  using (public.shares_table_with(id));

drop policy if exists "tables visible to members" on public.tables;
drop policy if exists "tables visible to members or participants" on public.tables;
create policy "tables visible to members or participants" on public.tables for select to authenticated
  using (public.is_member(id) or public.is_participant(id));

drop policy if exists "members visible to members" on public.table_members;
create policy "members visible to members" on public.table_members for select to authenticated
  using (public.is_member(table_id));

drop policy if exists "own hole cards" on public.hole_cards;
create policy "own hole cards" on public.hole_cards for select to authenticated
  using (user_id = public.current_player_id() and public.is_member(table_id));

drop policy if exists "chat visible to members" on public.chat_messages;
drop policy if exists "chat insert by members" on public.chat_messages;
create policy "chat visible to members" on public.chat_messages for select to authenticated
  using (public.is_member(table_id));

drop policy if exists "history visible to members" on public.hand_history;
drop policy if exists "history visible to members or participants" on public.hand_history;
create policy "history visible to members or participants" on public.hand_history for select to authenticated
  using (public.is_member(table_id) or public.is_participant(table_id));

drop policy if exists "ledger visible to members or participants" on public.ledger;
create policy "ledger visible to members or participants" on public.ledger for select to authenticated
  using (public.is_member(table_id) or public.is_participant(table_id));

drop policy if exists "reloads visible to members" on public.reload_requests;
create policy "reloads visible to members" on public.reload_requests for select to authenticated
  using (public.is_member(table_id));

drop policy if exists "participants visible to participants" on public.session_participants;
create policy "participants visible to participants" on public.session_participants for select to authenticated
  using (public.is_participant(table_id) or public.is_member(table_id));

-- lock down table grants: clients may only select; all writes go through the API
revoke insert, update, delete on all tables in schema public from anon, authenticated;
revoke all on public.group_settings, public.recovery_codes, public.command_receipts, public.table_secrets,
  public.invite_attempts, public.table_tombstones, public.app_settings, public.diagnostics, public.app_assets from anon, authenticated;
revoke select on public.profiles, public.tables, public.table_members, public.hole_cards, public.chat_messages, public.hand_history,
  public.ledger, public.reload_requests, public.session_participants from anon;

-- ---------- realtime publication ----------
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;
do $$
declare t text;
begin
  foreach t in array array['tables','hole_cards','chat_messages','reload_requests','table_members'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
alter table public.tables replica identity full;
alter table public.hole_cards replica identity full;
alter table public.reload_requests replica identity full;
alter table public.table_members replica identity full;
