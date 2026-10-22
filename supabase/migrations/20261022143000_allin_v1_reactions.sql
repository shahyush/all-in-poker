-- All In — table chat reactions (forward-only, additive; no existing object altered, no data dropped).
-- Adds public.chat_reactions and the allin_react RPC. One row per (message, user, emoji): a user may hold several
-- distinct reactions on a message, each at most once, and toggling removes exactly their own. Reads are member-scoped
-- RLS (select only); every write goes through the API via allin_react (service_role). Realtime publishes the table so
-- reactions propagate to the other players exactly like chat messages.
-- Rollback: drop function public.allin_react(jsonb); drop table public.chat_reactions cascade;  (nothing else touched)

create table if not exists public.chat_reactions (
  id bigint generated always as identity primary key,
  table_id uuid not null references public.tables(id) on delete cascade,
  message_id bigint not null references public.chat_messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  unique (message_id, user_id, emoji)
);
create index if not exists chat_reactions_table_idx on public.chat_reactions(table_id);
create index if not exists chat_reactions_message_idx on public.chat_reactions(message_id);

alter table public.chat_reactions enable row level security;
drop policy if exists "reactions visible to members" on public.chat_reactions;
create policy "reactions visible to members" on public.chat_reactions for select to authenticated
  using (public.is_member(table_id));

-- clients may only read; all writes go through the API (service role)
revoke insert, update, delete on public.chat_reactions from anon, authenticated;
revoke select on public.chat_reactions from anon;
grant select on public.chat_reactions to authenticated;

-- realtime: publish reactions so a tap by one player reaches the others immediately
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_reactions') then
    execute 'alter publication supabase_realtime add table public.chat_reactions';
  end if;
end $$;
alter table public.chat_reactions replica identity full;

-- Toggle a reaction. The message must belong to the named table (guards cross-table ids). Add is idempotent; remove only
-- ever deletes the caller's own row. Validation of the emoji allowlist and table membership happens in the API layer.
create or replace function public.allin_react(p jsonb)
returns void language plpgsql volatile security definer set search_path = public as $$
declare tid uuid; mid bigint; uid uuid; em text; op text;
begin
  tid := (p->>'table_id')::uuid; mid := (p->>'message_id')::bigint; uid := (p->>'user_id')::uuid;
  em := p->>'emoji'; op := p->>'op';
  if not exists (select 1 from public.chat_messages where id = mid and table_id = tid) then
    raise exception 'no_such_message';
  end if;
  if op = 'add' then
    insert into public.chat_reactions (table_id, message_id, user_id, emoji)
    values (tid, mid, uid, em) on conflict (message_id, user_id, emoji) do nothing;
  elsif op = 'remove' then
    delete from public.chat_reactions where message_id = mid and user_id = uid and emoji = em;
  else
    raise exception 'bad_op';
  end if;
end $$;
revoke all on function public.allin_react(jsonb) from public;
grant execute on function public.allin_react(jsonb) to service_role;
