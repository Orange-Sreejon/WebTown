-- WebTown Phase 5: invitations, membership management, and who may use a world's realtime channel.
-- See .kiro/specs/multiplayer/design.md. Every world stays private: nothing here lets anyone find a world, and
-- joining needs a valid invitation code. Everything runs as auth.uid(); client-supplied world ids are checked.

-- ── Invitations ─────────────────────────────────────────────────────────────────────────────────────────────

create table public.world_invites (
  id uuid primary key default gen_random_uuid(),
  world_id uuid not null references public.worlds (id) on delete cascade,
  -- SHA-256 (hex) of the normalised code. The code itself is shown once and never stored.
  code_hash text not null unique check (code_hash ~ '^[0-9a-f]{64}$'),
  -- The last four characters, so the owner can tell invitations apart.
  hint text not null check (hint ~ '^[A-Z0-9]{4}$'),
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  uses int not null default 0 check (uses >= 0)
);
create index world_invites_by_world on public.world_invites (world_id);

-- Only the functions below touch invitations.
alter table public.world_invites enable row level security;
revoke all on public.world_invites from anon, authenticated, public;

-- ── Helpers ─────────────────────────────────────────────────────────────────────────────────────────────────

-- One member per house slot.
create function private.max_world_members() returns int language sql immutable set search_path = '' as $$
  select 7
$$;

-- Codes are 12 characters from an alphabet without I, O, 0 and 1; dashes, spaces and case don't matter.
create function private.normalise_invite(p_code text) returns text language sql immutable set search_path = '' as $$
  select upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'))
$$;

create function private.invite_hash(p_normalised text) returns text language sql immutable set search_path = '' as $$
  select encode(sha256(convert_to(p_normalised, 'UTF8')), 'hex')
$$;

-- 12 characters, 5 random bits each (60 bits), from the random bytes of a v4 UUID (the version and variant
-- bytes 6 and 8 are skipped).
create function private.new_invite_code() returns text language plpgsql volatile set search_path = '' as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  bytes bytea := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
  picks int[] := array[0, 1, 2, 3, 4, 5, 9, 10, 11, 12, 13, 14];
  code text := '';
  i int;
begin
  foreach i in array picks loop
    code := code || substr(alphabet, (get_byte(bytes, i) % 32) + 1, 1);
  end loop;
  return code;
end $$;

create function private.is_world_owner(p_world uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.worlds w where w.id = p_world and w.owner_id = (select auth.uid()))
$$;

create function private.need_user() returns uuid language plpgsql stable set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
begin
  if uid is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  return uid;
end $$;

-- What `bootstrap_player` returns, for any world the user belongs to.
create function private.player_context(p_user uuid, p_world uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'profile', (select jsonb_build_object('id', p.id, 'displayName', p.display_name, 'avatar', p.avatar,
                 'settings', p.settings, 'createdAt', private.iso(p.created_at)) from public.profiles p where p.id = p_user),
    'world', (select jsonb_build_object('id', w.id, 'name', w.name, 'kind', w.kind, 'town', w.town,
               'role', m.role, 'createdAt', private.iso(w.created_at))
              from public.worlds w join public.world_members m on m.world_id = w.id and m.user_id = p_user
              where w.id = p_world),
    'houses', (select coalesce(jsonb_agg(jsonb_build_object('id', h.id, 'slot', h.slot, 'ownerId', h.owner_id,
                'interiorTemplate', h.interior_template) order by h.slot), '[]'::jsonb)
               from public.houses h where h.world_id = p_world)
  )
$$;

-- Takes a member out of a world. Their house there is replaced by an empty one on the same slot (its layout,
-- website and drawings go with the old row), so the next resident starts fresh.
create function private.drop_member(p_world uuid, p_user uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  freed text;
begin
  delete from public.houses h where h.world_id = p_world and h.owner_id = p_user returning h.slot into freed;
  delete from public.world_members m where m.world_id = p_world and m.user_id = p_user;
  if freed is not null then
    insert into public.houses (world_id, slot) values (p_world, freed);
  end if;
end $$;

-- True when a realtime topic is `world:<uuid>` of a world the caller belongs to. Anything else is refused
-- without trying to read it as a UUID.
create function private.realtime_world_member(p_topic text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_topic is null or p_topic !~ '^world:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  return private.is_world_member(substr(p_topic, 7)::uuid);
end $$;

revoke all on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated;

-- ── Functions the app calls ─────────────────────────────────────────────────────────────────────────────────

create function public.create_world_invite(p_world uuid, p_days int default 7) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  uid uuid := private.need_user();
  code text;
  created public.world_invites;
begin
  if not private.is_world_owner(p_world) then
    raise exception 'Only the owner of this town can invite people.' using errcode = '42501';
  end if;
  if p_days is null or p_days < 1 or p_days > 30 then
    raise exception 'An invitation lasts between 1 and 30 days.' using errcode = '22023';
  end if;
  if (select count(*) from public.world_invites i
      where i.world_id = p_world and i.revoked_at is null and i.expires_at > now()) >= 20 then
    raise exception 'This town has 20 open invitations. Revoke one first.' using errcode = '22023';
  end if;
  code := private.new_invite_code();
  insert into public.world_invites (world_id, code_hash, hint, created_by, expires_at)
  values (p_world, private.invite_hash(code), right(code, 4), uid, now() + make_interval(days => p_days))
  returning * into created;
  return jsonb_build_object('id', created.id, 'code', substr(code, 1, 4) || '-' || substr(code, 5, 4) || '-' || substr(code, 9, 4),
    'hint', created.hint, 'createdAt', private.iso(created.created_at), 'expiresAt', private.iso(created.expires_at));
end $$;

create function public.list_world_invites(p_world uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.need_user();
  if not private.is_world_owner(p_world) then
    raise exception 'Only the owner of this town can see its invitations.' using errcode = '42501';
  end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'hint', i.hint, 'uses', i.uses,
      'createdAt', private.iso(i.created_at), 'expiresAt', private.iso(i.expires_at),
      'revoked', i.revoked_at is not null, 'expired', i.expires_at <= now()) order by i.created_at desc), '[]'::jsonb)
    from public.world_invites i where i.world_id = p_world);
end $$;

create function public.revoke_world_invite(p_invite uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  wid uuid;
begin
  perform private.need_user();
  select i.world_id into wid from public.world_invites i where i.id = p_invite;
  if wid is null or not private.is_world_owner(wid) then
    raise exception 'Only the owner of this town can revoke its invitations.' using errcode = '42501';
  end if;
  update public.world_invites i set revoked_at = coalesce(i.revoked_at, now()) where i.id = p_invite;
end $$;

-- What an invitation leads to, before joining. Refuses unknown, revoked and expired codes.
create function public.preview_world_invite(p_code text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  uid uuid := private.need_user();
  normalised text := private.normalise_invite(p_code);
  inv public.world_invites;
begin
  if char_length(normalised) <> 12 then
    raise exception 'That invitation code is not valid.' using errcode = 'WTINV';
  end if;
  select * into inv from public.world_invites i where i.code_hash = private.invite_hash(normalised);
  if inv.id is null or inv.revoked_at is not null then
    raise exception 'That invitation is not valid. Ask for a new one.' using errcode = 'WTINV';
  end if;
  if inv.expires_at <= now() then
    raise exception 'That invitation has expired. Ask for a new one.' using errcode = 'WTEXP';
  end if;
  return (select jsonb_build_object('worldId', w.id, 'worldName', w.name, 'ownerName', p.display_name,
      'members', (select count(*) from public.world_members m where m.world_id = w.id),
      'max', private.max_world_members(),
      'alreadyMember', exists (select 1 from public.world_members m where m.world_id = w.id and m.user_id = uid))
    from public.worlds w join public.profiles p on p.id = w.owner_id where w.id = inv.world_id);
end $$;

-- Joins the world an invitation is for, as a resident with the first free house. Joining twice changes nothing.
create function public.join_world(p_code text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  uid uuid := private.need_user();
  normalised text := private.normalise_invite(p_code);
  inv public.world_invites;
  free uuid;
begin
  if not exists (select 1 from public.profiles p where p.id = uid) then
    raise exception 'Start WebTown first, then open the invitation again.' using errcode = '42501';
  end if;
  if char_length(normalised) <> 12 then
    raise exception 'That invitation code is not valid.' using errcode = 'WTINV';
  end if;
  select * into inv from public.world_invites i where i.code_hash = private.invite_hash(normalised) for update;
  if inv.id is null or inv.revoked_at is not null then
    raise exception 'That invitation is not valid. Ask for a new one.' using errcode = 'WTINV';
  end if;
  if inv.expires_at <= now() then
    raise exception 'That invitation has expired. Ask for a new one.' using errcode = 'WTEXP';
  end if;
  -- One join at a time per world, so the member limit and the house hand-out can't race.
  perform 1 from public.worlds w where w.id = inv.world_id for update;

  if exists (select 1 from public.world_members m where m.world_id = inv.world_id and m.user_id = uid) then
    return jsonb_build_object('worldId', inv.world_id, 'joined', false);
  end if;
  if (select count(*) from public.world_members m where m.world_id = inv.world_id) >= private.max_world_members() then
    raise exception 'This town is full.' using errcode = 'WTFUL';
  end if;
  select h.id into free from public.houses h
  where h.world_id = inv.world_id and h.owner_id is null order by h.slot limit 1;
  if free is null then
    raise exception 'This town has no free house.' using errcode = 'WTFUL';
  end if;

  insert into public.world_members (world_id, user_id, role) values (inv.world_id, uid, 'resident');
  update public.houses h set owner_id = uid where h.id = free;
  update public.world_invites i set uses = i.uses + 1 where i.id = inv.id;
  return jsonb_build_object('worldId', inv.world_id, 'joined', true);
end $$;

create function public.leave_world(p_world uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  uid uuid := private.need_user();
  my_role text;
begin
  select m.role into my_role from public.world_members m where m.world_id = p_world and m.user_id = uid;
  if my_role is null then
    raise exception 'You are not in that town.' using errcode = '42501';
  end if;
  if my_role = 'owner' then
    raise exception 'This is your own town, so you can''t leave it.' using errcode = '22023';
  end if;
  perform private.drop_member(p_world, uid);
end $$;

create function public.remove_world_member(p_world uuid, p_user uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform private.need_user();
  if not private.is_world_owner(p_world) then
    raise exception 'Only the owner of this town can remove people.' using errcode = '42501';
  end if;
  if p_user = (select auth.uid()) then
    raise exception 'You own this town, so you can''t remove yourself.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.world_members m where m.world_id = p_world and m.user_id = p_user) then
    raise exception 'That person is not in this town.' using errcode = '22023';
  end if;
  perform private.drop_member(p_world, p_user);
end $$;

create function public.list_my_worlds() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  uid uuid := private.need_user();
begin
  return (select coalesce(jsonb_agg(jsonb_build_object('id', w.id, 'name', w.name, 'role', m.role,
      'ownerName', p.display_name,
      'members', (select count(*) from public.world_members x where x.world_id = w.id))
      order by (m.role = 'owner') desc, m.joined_at), '[]'::jsonb)
    from public.world_members m join public.worlds w on w.id = m.world_id join public.profiles p on p.id = w.owner_id
    where m.user_id = uid);
end $$;

create function public.list_world_members(p_world uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.need_user();
  if not private.is_world_member(p_world) then
    raise exception 'You are not in that town.' using errcode = '42501';
  end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('userId', m.user_id, 'displayName', p.display_name,
      'avatar', p.avatar, 'role', m.role,
      'slot', (select h.slot from public.houses h where h.world_id = m.world_id and h.owner_id = m.user_id))
      order by m.joined_at), '[]'::jsonb)
    from public.world_members m join public.profiles p on p.id = m.user_id where m.world_id = p_world);
end $$;

-- Opens a world the caller belongs to: the same answer as bootstrap_player, for that world.
create function public.enter_world(p_world uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  uid uuid := private.need_user();
begin
  if not private.is_world_member(p_world) then
    raise exception 'You are not in that town.' using errcode = '42501';
  end if;
  return private.player_context(uid, p_world);
end $$;

revoke all on function public.create_world_invite(uuid, int), public.list_world_invites(uuid),
  public.revoke_world_invite(uuid), public.preview_world_invite(text), public.join_world(text),
  public.leave_world(uuid), public.remove_world_member(uuid, uuid), public.list_my_worlds(),
  public.list_world_members(uuid), public.enter_world(uuid) from public, anon;
grant execute on function public.create_world_invite(uuid, int), public.list_world_invites(uuid),
  public.revoke_world_invite(uuid), public.preview_world_invite(text), public.join_world(text),
  public.leave_world(uuid), public.remove_world_member(uuid, uuid), public.list_my_worlds(),
  public.list_world_members(uuid), public.enter_world(uuid) to authenticated;

-- ── Realtime: a world's channel is for its members only ─────────────────────────────────────────────────────
-- Private channels `world:<uuid>` (broadcast and presence). Supabase Realtime checks these policies with the
-- user's JWT when they join the channel (and on token refresh).

create policy "webtown: world members receive" on realtime.messages for select to authenticated
  using (realtime.messages.extension in ('broadcast', 'presence') and private.realtime_world_member((select realtime.topic())));

create policy "webtown: world members send" on realtime.messages for insert to authenticated
  with check (realtime.messages.extension in ('broadcast', 'presence') and private.realtime_world_member((select realtime.topic())));
