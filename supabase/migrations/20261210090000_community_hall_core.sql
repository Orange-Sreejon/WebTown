-- WebTown Community Hall, CH-01: one Hall per world, its moderators, an append-only moderation log, and who may use
-- the Hall's own realtime channel. See .kiro/specs/community-hall/design.md (H1-H4, section 3).
--
-- Nothing here changes an existing table, policy or function. The movement channel `world:<uuid>` keeps its own
-- rules; the Hall gets a second private topic, `hall:<uuid>`, for content only (later milestones).
-- Grants follow the rule in .kiro/steering/security.md: each `private` helper is granted on its own, and only if an
-- RLS policy needs it.

-- ── Tables ──────────────────────────────────────────────────────────────────────────────────────────────────

-- The Hall's id is its world's id: one Hall per world is a primary-key fact (H1).
create table public.community_halls (
  world_id uuid primary key references public.worlds (id) on delete cascade,
  name text not null default 'Community Hall' check (char_length(btrim(name)) between 1 and 60 and name !~ '[[:cntrl:]]'),
  canvas_locked boolean not null default false,
  draft_locked boolean not null default false,
  created_at timestamptz not null default now()
);

-- Moderators besides the owner (who always is one). A moderator is always a member: removing them from the world
-- ends the role (H3).
create table public.world_moderators (
  world_id uuid not null,
  user_id uuid not null,
  granted_by uuid references auth.users (id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (world_id, user_id),
  foreign key (world_id, user_id) references public.world_members (world_id, user_id) on delete cascade
);

-- What moderators did. Written only by the functions below; never changed or removed through the API.
create table public.community_moderation_log (
  id bigint generated always as identity primary key,
  world_id uuid not null references public.community_halls (world_id) on delete cascade,
  actor_id uuid references auth.users (id) on delete set null,
  action text not null check (action in ('grant_moderator', 'revoke_moderator', 'publish', 'rollback', 'hide_stroke',
    'restore_stroke', 'clear_region', 'lock_canvas', 'unlock_canvas', 'lock_draft', 'unlock_draft')),
  target jsonb not null default '{}'::jsonb check (jsonb_typeof(target) = 'object' and octet_length(target::text) <= 4096),
  reason text check (reason is null or (char_length(reason) <= 500 and reason !~ '[[:cntrl:]]')),
  created_at timestamptz not null default now()
);
create index community_moderation_log_by_world on public.community_moderation_log (world_id, id desc);

-- ── Helpers ─────────────────────────────────────────────────────────────────────────────────────────────────

-- Every world gets its Hall when it is created (H2); existing worlds are backfilled below.
create function private.create_community_hall() returns trigger
language plpgsql volatile security definer set search_path = '' as $$
begin
  insert into public.community_halls (world_id) values (new.id) on conflict (world_id) do nothing;
  return new;
end $$;

create trigger worlds_create_community_hall after insert on public.worlds
for each row execute function private.create_community_hall();

insert into public.community_halls (world_id) select w.id from public.worlds w on conflict (world_id) do nothing;

-- The log is append-only: no update ever, and no delete except when the world itself goes (the cascade runs inside
-- the foreign key's own trigger, so it is one level deeper).
create function private.community_log_append_only() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' or pg_trigger_depth() < 2 then
    raise exception 'The moderation log can''t be changed.' using errcode = '42501';
  end if;
  return old;
end $$;

create trigger community_moderation_log_append_only before update or delete on public.community_moderation_log
for each row execute function private.community_log_append_only();

-- True for the world's owner and its appointed moderators (both are members).
create function private.is_hall_moderator(p_world uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.worlds w where w.id = p_world and w.owner_id = (select auth.uid()))
      or exists (select 1 from public.world_moderators m where m.world_id = p_world and m.user_id = (select auth.uid()))
$$;

-- `hall:<uuid>` of a world the caller belongs to (as private.realtime_world_member does for `world:<uuid>`).
create function private.realtime_hall_member(p_topic text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_topic is null or p_topic !~ '^hall:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  return private.is_world_member(substr(p_topic, 6)::uuid);
end $$;

-- A user's name if they are still in the world, otherwise null ("a former member").
create function private.member_name(p_world uuid, p_user uuid) returns text
language sql stable security definer set search_path = '' as $$
  select p.display_name from public.world_members m join public.profiles p on p.id = m.user_id
  where m.world_id = p_world and m.user_id = p_user
$$;

create function private.log_moderation(p_world uuid, p_action text, p_target jsonb, p_reason text) returns void
language sql volatile security definer set search_path = '' as $$
  insert into public.community_moderation_log (world_id, actor_id, action, target, reason)
  values (p_world, (select auth.uid()), p_action, coalesce(p_target, '{}'::jsonb), nullif(btrim(coalesce(p_reason, '')), ''))
$$;

-- Fails with 42501 unless the caller is a member of the world. Returns their id.
create function private.need_hall_member(p_world uuid) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
begin
  if uid is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  if p_world is null or not private.is_world_member(p_world) then
    raise exception 'You are not in that town.' using errcode = '42501';
  end if;
  return uid;
end $$;

-- Execute rights: only what RLS policies need (S4 rule).
revoke all on function private.create_community_hall(), private.community_log_append_only(),
  private.is_hall_moderator(uuid), private.realtime_hall_member(text), private.member_name(uuid, uuid),
  private.log_moderation(uuid, text, jsonb, text), private.need_hall_member(uuid)
from public, anon, authenticated;
grant execute on function private.is_hall_moderator(uuid), private.realtime_hall_member(text) to authenticated;

-- ── Row Level Security ──────────────────────────────────────────────────────────────────────────────────────

alter table public.community_halls enable row level security;
alter table public.world_moderators enable row level security;
alter table public.community_moderation_log enable row level security;

create policy community_halls_read on public.community_halls for select to authenticated
  using (private.is_world_member(world_id));
create policy world_moderators_read on public.world_moderators for select to authenticated
  using (private.is_world_member(world_id));
create policy community_moderation_log_read on public.community_moderation_log for select to authenticated
  using (private.is_hall_moderator(world_id));

revoke all on public.community_halls, public.world_moderators, public.community_moderation_log from anon, authenticated, public;
grant select on public.community_halls, public.world_moderators, public.community_moderation_log to authenticated;

-- ── Functions the app calls ─────────────────────────────────────────────────────────────────────────────────

-- The Hall of a world the caller belongs to, and the caller's role there.
create function public.hall_context(p_world uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  uid uuid := private.need_hall_member(p_world);
begin
  return (select jsonb_build_object('worldId', h.world_id, 'name', h.name,
      'canvasLocked', h.canvas_locked, 'draftLocked', h.draft_locked,
      'role', case when w.owner_id = uid then 'owner'
                   when exists (select 1 from public.world_moderators m where m.world_id = h.world_id and m.user_id = uid) then 'moderator'
                   else 'member' end)
    from public.community_halls h join public.worlds w on w.id = h.world_id where h.world_id = p_world);
end $$;

-- The owner first, then appointed moderators in the order they were appointed.
create function public.list_hall_moderators(p_world uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.need_hall_member(p_world);
  return (select jsonb_build_array(jsonb_build_object('userId', w.owner_id, 'displayName', private.member_name(w.id, w.owner_id),
        'isOwner', true, 'grantedAt', private.iso(w.created_at)))
      || coalesce((select jsonb_agg(jsonb_build_object('userId', m.user_id, 'displayName', private.member_name(m.world_id, m.user_id),
        'isOwner', false, 'grantedAt', private.iso(m.granted_at)) order by m.granted_at, m.user_id)
        from public.world_moderators m where m.world_id = w.id), '[]'::jsonb)
    from public.worlds w where w.id = p_world);
end $$;

create function public.grant_moderator(p_world uuid, p_user uuid, p_reason text default null) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  uid uuid := private.need_hall_member(p_world);
begin
  if not exists (select 1 from public.worlds w where w.id = p_world and w.owner_id = uid) then
    raise exception 'Only the owner of this town can choose moderators.' using errcode = '42501';
  end if;
  if p_user is null or not exists (select 1 from public.world_members m where m.world_id = p_world and m.user_id = p_user) then
    raise exception 'That person is not in this town.' using errcode = '22023';
  end if;
  if p_user = uid then
    raise exception 'You own this town, so you are always a moderator.' using errcode = '22023';
  end if;
  if exists (select 1 from public.world_moderators m where m.world_id = p_world and m.user_id = p_user) then
    return; -- already one: nothing changes, nothing is logged
  end if;
  insert into public.world_moderators (world_id, user_id, granted_by) values (p_world, p_user, uid);
  perform private.log_moderation(p_world, 'grant_moderator', jsonb_build_object('userId', p_user), p_reason);
end $$;

create function public.revoke_moderator(p_world uuid, p_user uuid, p_reason text default null) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  uid uuid := private.need_hall_member(p_world);
begin
  if not exists (select 1 from public.worlds w where w.id = p_world and w.owner_id = uid) then
    raise exception 'Only the owner of this town can choose moderators.' using errcode = '42501';
  end if;
  if p_user = uid then
    raise exception 'You own this town, so you are always a moderator.' using errcode = '22023';
  end if;
  delete from public.world_moderators m where m.world_id = p_world and m.user_id = p_user;
  if found then
    perform private.log_moderation(p_world, 'revoke_moderator', jsonb_build_object('userId', p_user), p_reason);
  end if;
end $$;

-- Newest first; `p_before` (an entry id) pages further back. Names only for people still in the town.
create function public.list_moderation_log(p_world uuid, p_before bigint default null, p_limit int default 50) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.need_hall_member(p_world);
  if not private.is_hall_moderator(p_world) then
    raise exception 'Only moderators can read the moderation log.' using errcode = '42501';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'Ask for 1 to 100 entries.' using errcode = '22023';
  end if;
  return (select coalesce(jsonb_agg(e order by (e ->> 'id')::bigint desc), '[]'::jsonb) from (
    select jsonb_build_object('id', l.id, 'action', l.action, 'target', l.target, 'reason', l.reason,
        'actorId', l.actor_id, 'actorName', private.member_name(l.world_id, l.actor_id),
        'targetName', case when l.target ? 'userId' and (l.target ->> 'userId') ~ '^[0-9a-f-]{36}$'
                           then private.member_name(l.world_id, (l.target ->> 'userId')::uuid) end,
        'createdAt', private.iso(l.created_at)) as e
    from public.community_moderation_log l
    where l.world_id = p_world and (p_before is null or l.id < p_before)
    order by l.id desc limit p_limit) entries);
end $$;

revoke all on function public.hall_context(uuid), public.list_hall_moderators(uuid),
  public.grant_moderator(uuid, uuid, text), public.revoke_moderator(uuid, uuid, text),
  public.list_moderation_log(uuid, bigint, int) from public, anon;
grant execute on function public.hall_context(uuid), public.list_hall_moderators(uuid),
  public.grant_moderator(uuid, uuid, text), public.revoke_moderator(uuid, uuid, text),
  public.list_moderation_log(uuid, bigint, int) to authenticated;

-- ── Realtime: the Hall's channel is for the world's members only ───────────────────────────────────────────

create policy "webtown: hall members receive" on realtime.messages for select to authenticated
  using (realtime.messages.extension in ('broadcast', 'presence') and private.realtime_hall_member((select realtime.topic())));

create policy "webtown: hall members send" on realtime.messages for insert to authenticated
  with check (realtime.messages.extension in ('broadcast', 'presence') and private.realtime_hall_member((select realtime.topic())));
