-- Migration 3/4: admission and identity RPCs (APPLIED 2026-10-21). allin_admit, allin_set_group_password,
--   allin_update_profile, allin_recovery_create, allin_recover, allin_unbind.
-- Existing data: untouched. Rollback: drop these six functions; group_settings/recovery_codes rows can be truncated safely.
-- Identity, admission and recovery functions (service only).

create or replace function public.allin_admit(p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare pr public.profiles%rowtype; first boolean;
begin
  select * into pr from public.profiles where auth_user_id = (p->>'auth_user_id')::uuid and status = 'active';
  if found then return jsonb_build_object('ok', true, 'player', to_jsonb(pr)); end if;
  if coalesce((p->>'bootstrap')::boolean, false) then
    if exists (select 1 from public.group_settings where id = 1) then
      return jsonb_build_object('ok', false, 'reason', 'already_configured');
    end if;
    insert into public.group_settings (id, password_hash, password_salt, iterations)
      values (1, decode(substr(p->>'password_hash', 3), 'hex'), decode(substr(p->>'password_salt', 3), 'hex'), (p->>'iterations')::int);
    first := true;
  else
    first := false;
  end if;
  insert into public.profiles (id, display_name, auth_user_id, admitted_at, is_owner)
    values (gen_random_uuid(), p->>'display_name', (p->>'auth_user_id')::uuid, now(), first)
    returning * into pr;
  if first then update public.group_settings set rotated_by = pr.id where id = 1; end if;
  return jsonb_build_object('ok', true, 'player', to_jsonb(pr));
end $$;
revoke all on function public.allin_admit(jsonb) from public;
grant execute on function public.allin_admit(jsonb) to service_role;

create or replace function public.allin_set_group_password(p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
begin
  insert into public.group_settings (id, password_hash, password_salt, iterations, rotated_at, rotated_by)
    values (1, decode(substr(p->>'password_hash', 3), 'hex'), decode(substr(p->>'password_salt', 3), 'hex'), (p->>'iterations')::int, now(), (p->>'rotated_by')::uuid)
    on conflict (id) do update set password_hash = excluded.password_hash, password_salt = excluded.password_salt, iterations = excluded.iterations, rotated_at = now(), rotated_by = excluded.rotated_by;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.allin_set_group_password(jsonb) from public;
grant execute on function public.allin_set_group_password(jsonb) to service_role;

create or replace function public.allin_update_profile(p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
begin
  update public.profiles set
    display_name = coalesce(p->>'display_name', display_name),
    avatar = case when p->>'avatar' = '__keep__' then avatar else p->>'avatar' end,
    updated_at = now()
  where id = (p->>'player_id')::uuid;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.allin_update_profile(jsonb) from public;
grant execute on function public.allin_update_profile(jsonb) to service_role;

create or replace function public.allin_recovery_create(p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
begin
  update public.recovery_codes set revoked_at = now() where player_id = (p->>'player_id')::uuid and used_at is null and revoked_at is null;
  insert into public.recovery_codes (player_id, verifier) values ((p->>'player_id')::uuid, decode(substr(p->>'verifier', 3), 'hex'));
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.allin_recovery_create(jsonb) from public;
grant execute on function public.allin_recovery_create(jsonb) to service_role;

-- Atomic recovery: verify the code, rebind the player to this auth session, retire the code.
create or replace function public.allin_recover(p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare rc public.recovery_codes%rowtype; pr public.profiles%rowtype; uid uuid := (p->>'auth_user_id')::uuid;
begin
  if exists (select 1 from public.profiles where auth_user_id = uid and status = 'active') then
    return jsonb_build_object('ok', false, 'reason', 'already_player');
  end if;
  select * into rc from public.recovery_codes where verifier = decode(substr(p->>'verifier', 3), 'hex') and used_at is null and revoked_at is null for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'bad_code'); end if;
  select * into pr from public.profiles where id = rc.player_id and status = 'active' for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'bad_code'); end if;
  update public.recovery_codes set used_at = now(), revoked_at = now() where id = rc.id;
  update public.profiles set auth_user_id = uid, updated_at = now() where id = pr.id returning * into pr;
  return jsonb_build_object('ok', true, 'player', to_jsonb(pr));
end $$;
revoke all on function public.allin_recover(jsonb) from public;
grant execute on function public.allin_recover(jsonb) to service_role;

create or replace function public.allin_unbind(p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
begin
  update public.profiles set auth_user_id = null, updated_at = now() where id = (p->>'player_id')::uuid;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.allin_unbind(jsonb) from public;
grant execute on function public.allin_unbind(jsonb) to service_role;
