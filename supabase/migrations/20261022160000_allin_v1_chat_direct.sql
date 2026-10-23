-- All In — direct chat insert (forward-only, additive; no existing object altered destructively, no data dropped).
--
-- Why: chat used to be written as a side-effect of allin_commit, i.e. under the table-row compare-and-swap. A chat
-- message changes no game state, yet it had to win the same optimistic lock that betting actions use. Under a burst of
-- messages (or while a hand is being acted on) the four CAS attempts in withTable() could all lose the race and the
-- message was dropped with 409 'busy'. Reactions never had this problem because allin_react writes directly — which is
-- exactly why a real device saw "reactions work, chat doesn't". This moves chat onto the same direct-write path.
--
-- Exactly-once: the message now carries the command's action_id, with a partial unique index. A retry after a lost
-- response re-sends the same action_id and the insert no-ops, so a dropped HTTP response can never double-post. Legacy
-- rows keep action_id NULL; the partial index ignores NULLs, so multiple legacy NULLs remain valid.
--
-- Rollback: drop function public.allin_chat(jsonb); drop index public.chat_messages_action_uidx;
--           alter table public.chat_messages drop column action_id;   (nothing else touched)

alter table public.chat_messages add column if not exists action_id uuid;
create unique index if not exists chat_messages_action_uidx on public.chat_messages(action_id) where action_id is not null;

-- Insert a chat message directly (no table-version CAS). Membership and body validation happen in the API layer.
-- Idempotent on action_id: a replayed command re-sends the same id and the insert is a no-op, returning the existing row.
create or replace function public.allin_chat(p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare tid uuid; uid uuid; aid uuid; mid bigint;
begin
  tid := (p->>'table_id')::uuid; uid := (p->>'user_id')::uuid; aid := (p->>'action_id')::uuid;
  insert into public.chat_messages (table_id, user_id, body, action_id)
    values (tid, uid, p->>'body', aid)
    on conflict (action_id) where action_id is not null do nothing
    returning id into mid;
  if mid is null then
    -- a concurrent duplicate of the same action_id already landed; return its id so the caller still sees success
    select id into mid from public.chat_messages where action_id = aid;
  end if;
  return jsonb_build_object('ok', true, 'id', mid);
end $$;
revoke all on function public.allin_chat(jsonb) from public;
grant execute on function public.allin_chat(jsonb) to service_role;
