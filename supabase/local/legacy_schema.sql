-- Recreates the pre-existing production schema (allin_initial_schema + app_assets) locally so the forward migration can be tested.
create table if not exists public.profiles (
  id uuid primary key references auth.users(id),
  display_name text not null check (char_length(display_name) >= 1 and char_length(display_name) <= 24),
  created_at timestamptz not null default now()
);
create table if not exists public.tables (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) >= 1 and char_length(name) <= 40),
  host_id uuid not null references public.profiles(id),
  invite_code text unique not null,
  config jsonb not null,
  status text not null default 'waiting' check (status in ('waiting','running','closed')),
  state jsonb not null default '{}'::jsonb,
  version int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.table_members (
  table_id uuid not null references public.tables(id),
  user_id uuid not null references public.profiles(id),
  role text not null default 'player' check (role in ('host','player')),
  joined_at timestamptz not null default now(),
  primary key (table_id, user_id)
);
create table if not exists public.table_secrets (table_id uuid primary key references public.tables(id), secret jsonb not null);
create table if not exists public.hole_cards (
  table_id uuid not null references public.tables(id),
  user_id uuid not null references public.profiles(id),
  hand_no int not null,
  cards int[] not null,
  primary key (table_id, user_id)
);
create table if not exists public.chat_messages (
  id bigint generated always as identity primary key,
  table_id uuid not null references public.tables(id),
  user_id uuid not null references public.profiles(id),
  body text not null check (char_length(body) >= 1 and char_length(body) <= 500),
  created_at timestamptz not null default now()
);
create table if not exists public.hand_history (
  table_id uuid not null references public.tables(id),
  hand_no int not null,
  results jsonb not null,
  created_at timestamptz not null default now(),
  primary key (table_id, hand_no)
);
create table if not exists public.invite_attempts (user_id uuid not null, at timestamptz not null default now());
create table if not exists public.app_assets (path text primary key, body text not null, updated_at timestamptz not null default now());
alter table public.profiles enable row level security;
alter table public.tables enable row level security;
alter table public.table_members enable row level security;
alter table public.table_secrets enable row level security;
alter table public.hole_cards enable row level security;
alter table public.chat_messages enable row level security;
alter table public.hand_history enable row level security;
alter table public.invite_attempts enable row level security;
alter table public.app_assets enable row level security;
create or replace function public.is_member(t uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.table_members where table_id = t and user_id = auth.uid())
$$;
create policy "profiles readable by signed-in users" on public.profiles for select to authenticated using (true);
create policy "profiles self insert" on public.profiles for insert to authenticated with check (id = auth.uid());
create policy "profiles self update" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy "tables visible to members" on public.tables for select to authenticated using (is_member(id));
create policy "members visible to members" on public.table_members for select to authenticated using (is_member(table_id));
create policy "own hole cards" on public.hole_cards for select to authenticated using (user_id = auth.uid());
create policy "chat visible to members" on public.chat_messages for select to authenticated using (is_member(table_id));
create policy "chat insert by members" on public.chat_messages for insert to authenticated with check (user_id = auth.uid() and is_member(table_id));
create policy "history visible to members" on public.hand_history for select to authenticated using (is_member(table_id));
