-- Local test bootstrap: emulate the Supabase roles and auth helpers that exist on the hosted platform.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema if not exists auth;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create table if not exists auth.users (id uuid primary key, is_anonymous boolean not null default true, created_at timestamptz not null default now());
create or replace function auth.uid() returns uuid language sql stable as $$
  select (nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'sub')::uuid
$$;
create or replace function auth.role() returns text language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'role'
$$;
grant usage on schema public to anon, authenticated, service_role;
grant usage on schema extensions to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;
grant all on all tables in schema public to service_role;
grant select on all tables in schema public to anon, authenticated;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant select on tables to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

-- Test-only helper: shift every millisecond timestamp inside a private table state (simulates waiting without sleeping).
create or replace function public.allin_shift_time(s jsonb, delta bigint) returns jsonb language plpgsql immutable as $$
declare keys text[] := array['dueAt','lastActivityAt','deadline','actionReadyAt','choiceDeadline','revealDeadline','nextAt','startedAt','at'];
  k text; h jsonb; v jsonb; q jsonb; i int; arr jsonb;
begin
  foreach k in array keys loop
    if s ? k and jsonb_typeof(s->k) = 'number' then s := jsonb_set(s, array[k], to_jsonb((s->>k)::bigint + delta)); end if;
  end loop;
  if s ? 'hand' and jsonb_typeof(s->'hand') = 'object' then
    h := s->'hand';
    foreach k in array keys loop
      if h ? k and jsonb_typeof(h->k) = 'number' then h := jsonb_set(h, array[k], to_jsonb((h->>k)::bigint + delta)); end if;
    end loop;
    if h ? 'vote' and jsonb_typeof(h->'vote') = 'object' and (h->'vote') ? 'deadline' then
      h := jsonb_set(h, '{vote,deadline}', to_jsonb((h->'vote'->>'deadline')::bigint + delta));
    end if;
    if h ? 'runoutQueue' and jsonb_typeof(h->'runoutQueue') = 'array' then
      arr := '[]'::jsonb;
      for q in select * from jsonb_array_elements(h->'runoutQueue') loop
        arr := arr || jsonb_build_array(jsonb_set(q, '{at}', to_jsonb((q->>'at')::bigint + delta)));
      end loop;
      h := jsonb_set(h, '{runoutQueue}', arr);
    end if;
    s := jsonb_set(s, '{hand}', h);
  end if;
  if s ? 'tournament' and jsonb_typeof(s->'tournament') = 'object' and (s->'tournament') ? 'startedAt' then
    s := jsonb_set(s, '{tournament,startedAt}', to_jsonb((s->'tournament'->>'startedAt')::bigint + delta));
  end if;
  return s;
end $$;

-- Local stand-in for pg_net so the dispatcher function can be exercised by the server tests: records every call.
create schema if not exists net;
create table if not exists net.local_calls (id bigserial primary key, url text, body jsonb, headers jsonb, created_at timestamptz default now());
create or replace function net.http_post(url text, body jsonb default '{}'::jsonb, params jsonb default '{}'::jsonb, headers jsonb default '{}'::jsonb, timeout_milliseconds int default 5000)
returns bigint language plpgsql as $$
declare rid bigint;
begin
  insert into net.local_calls (url, body, headers) values (url, body, headers) returning id into rid;
  return rid;
end $$;
