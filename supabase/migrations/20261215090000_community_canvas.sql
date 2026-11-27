-- WebTown Community Hall, CH-03: the shared canvas's durable data. Vector strokes on an infinite-feeling plane, an
-- operation log clients catch up from, and the functions that add, erase, undo, restore, clear and lock.
-- See .kiro/specs/community-hall/design.md (H5, H6, sections 3 and 4.2).
--
-- Every write goes through these security-definer functions; tables have no client write grants. The database
-- computes each stroke's bounding box itself and stamps its author, so nothing a client claims is trusted.
-- Committed operations are announced on the Hall's private channel `hall:<uuid>` by the database (realtime.send) as
-- `{ seq, kind }` only. Members may broadcast on that channel too, so an announcement is just a hint to catch up:
-- clients read what changed from canvas_ops_since, never from the message. An announcement that fails never undoes
-- the stored change.

-- ── Tables ──────────────────────────────────────────────────────────────────────────────────────────────────

create table public.canvas_strokes (
  -- Made by the client: a stroke resent after a reconnect is the same stroke, not a second one.
  id uuid primary key,
  world_id uuid not null references public.community_halls (world_id) on delete cascade,
  -- Kept when the author leaves the town (shown as "a former member"); cleared only if the account is deleted.
  author_id uuid references auth.users (id) on delete set null,
  tool text not null check (tool in ('pen', 'marker')),
  color text not null check (color ~ '^#[0-9a-f]{6}$'),
  width smallint not null check (width between 1 and 64),
  -- x0, y0, x1, y1, ... in world units, each within +-1,000,000; 1 to 2,000 points.
  points int[] not null check (array_ndims(points) = 1 and cardinality(points) between 2 and 4000 and cardinality(points) % 2 = 0),
  -- Computed by add_canvas_stroke from the points and the width; what viewport queries use.
  bbox box not null,
  created_at timestamptz not null default now(),
  hidden_at timestamptz,
  hidden_by uuid references auth.users (id) on delete set null,
  hidden_reason text check (hidden_reason in ('erased', 'undone', 'moderated', 'cleared')),
  check ((hidden_at is null) = (hidden_reason is null))
);
-- What viewport loads use: visible strokes overlapping a box.
create index canvas_strokes_visible_bbox on public.canvas_strokes using gist (bbox) where hidden_at is null;
create index canvas_strokes_by_world on public.canvas_strokes (world_id, created_at);
-- Rate limits look at one author's recent strokes.
create index canvas_strokes_by_author on public.canvas_strokes (world_id, author_id, created_at);

-- Everything that changed the canvas, in order: what a client catches up from after a reconnect.
create table public.canvas_ops (
  seq bigint generated always as identity primary key,
  world_id uuid not null references public.community_halls (world_id) on delete cascade,
  kind text not null check (kind in ('add', 'hide', 'restore', 'clear')),
  stroke_id uuid,
  -- 'clear': the region cleared and the strokes it hid.
  region box,
  stroke_ids uuid[],
  actor_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  check ((kind = 'clear') = (region is not null and stroke_ids is not null)),
  check ((kind = 'clear') = (stroke_id is null))
);
create index canvas_ops_by_world on public.canvas_ops (world_id, seq);

alter table public.canvas_strokes enable row level security;
alter table public.canvas_ops enable row level security;
-- Hidden strokes (erased, removed by a moderator) only to their author and the Hall's moderators.
create policy canvas_strokes_read on public.canvas_strokes for select to authenticated using (
  private.is_world_member(world_id)
  and (hidden_at is null or author_id = (select auth.uid()) or private.is_hall_moderator(world_id)));
create policy canvas_ops_read on public.canvas_ops for select to authenticated using (private.is_world_member(world_id));
revoke all on public.canvas_strokes, public.canvas_ops from anon, authenticated, public;
grant select on public.canvas_strokes, public.canvas_ops to authenticated;

-- ── Limits ──────────────────────────────────────────────────────────────────────────────────────────────────

create function private.canvas_limit(p_what text) returns int language sql immutable set search_path = '' as $$
  select case p_what
    when 'coordinate' then 1000000      -- +-, world units
    when 'per_minute' then 60           -- strokes a member may add in a minute
    when 'per_day' then 1500            -- ... and in a day, erased ones included (bounds what one member can store)
    when 'visible' then 20000           -- visible strokes a Hall may hold
    when 'query' then 5000              -- strokes one viewport load may return
    when 'ops' then 1000                -- operations one catch-up may return
    when 'clear' then 5000              -- strokes one clear may hide
  end
$$;

-- ── Helpers ─────────────────────────────────────────────────────────────────────────────────────────────────

-- A stroke as the app reads it. The author's name only while they are in the town.
create function private.canvas_stroke_json(s public.canvas_strokes) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', s.id, 'authorId', s.author_id, 'authorName', private.member_name(s.world_id, s.author_id),
    'tool', s.tool, 'color', s.color, 'width', s.width, 'points', to_jsonb(s.points),
    'createdAt', private.iso(s.created_at), 'hidden', s.hidden_at is not null)
$$;

create function private.canvas_box_json(b box) returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object('x1', (b[1])[0], 'y1', (b[1])[1], 'x2', (b[0])[0], 'y2', (b[0])[1])
$$;

-- One operation as the app reads it. An 'add' or 'restore' carries its stroke while the stroke is visible (null once
-- it is hidden again, which a later 'hide' or 'clear' in the log explains), so catching up needs nothing else and
-- hidden drawing is never handed out.
create function private.canvas_op_json(o public.canvas_ops) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('seq', o.seq, 'kind', o.kind, 'strokeId', o.stroke_id, 'actorId', o.actor_id,
      'createdAt', private.iso(o.created_at))
    || case when o.kind in ('add', 'restore') then jsonb_build_object('stroke',
         (select private.canvas_stroke_json(s) from public.canvas_strokes s where s.id = o.stroke_id and s.hidden_at is null))
       else '{}'::jsonb end
    || case when o.kind = 'clear' then jsonb_build_object('region', private.canvas_box_json(o.region), 'strokeIds', to_jsonb(o.stroke_ids))
       else '{}'::jsonb end
$$;

-- Records an operation and announces `{ seq, kind }` on `hall:<world>`. The announcement is best effort: a failure
-- (Realtime not available) is ignored, because clients also catch up from canvas_ops by sequence number.
create function private.canvas_record(p_world uuid, p_kind text, p_stroke uuid, p_region box, p_strokes uuid[]) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  op public.canvas_ops;
  message jsonb;
begin
  insert into public.canvas_ops (world_id, kind, stroke_id, region, stroke_ids, actor_id)
  values (p_world, p_kind, p_stroke, p_region, p_strokes, (select auth.uid()))
  returning * into op;
  message := private.canvas_op_json(op);
  begin
    perform realtime.send(jsonb_build_object('seq', op.seq, 'kind', op.kind), 'canvas', 'hall:' || p_world::text, true);
  exception when others then
    null;
  end;
  return message;
end $$;

-- Parses a box from four numbers (any corners), refusing anything outside the plane.
create function private.canvas_box(p_x1 int, p_y1 int, p_x2 int, p_y2 int) returns box
language plpgsql immutable set search_path = '' as $$
declare
  lim constant int := private.canvas_limit('coordinate');
begin
  if p_x1 is null or p_y1 is null or p_x2 is null or p_y2 is null
     or greatest(abs(p_x1), abs(p_y1), abs(p_x2), abs(p_y2)) > lim then
    raise exception 'That area is outside the canvas.' using errcode = '22023';
  end if;
  return box(point(p_x1, p_y1), point(p_x2, p_y2));
end $$;

-- Moderators may draw on a locked canvas; others may not.
create function private.canvas_need_unlocked(p_world uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if (select h.canvas_locked from public.community_halls h where h.world_id = p_world) and not private.is_hall_moderator(p_world) then
    raise exception 'The canvas is locked by a moderator for now.' using errcode = '22023';
  end if;
end $$;

-- ── Functions the app calls ─────────────────────────────────────────────────────────────────────────────────

-- Adds a stroke. Sending the same id again (a retry after a reconnect) returns the stored stroke unchanged.
create function public.add_canvas_stroke(p_world uuid, p_id uuid, p_tool text, p_color text, p_width int, p_points int[])
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  uid uuid := private.need_hall_member(p_world);
  lim constant int := private.canvas_limit('coordinate');
  existing public.canvas_strokes;
  n int;
  pad numeric;
  min_x int; min_y int; max_x int; max_y int;
begin
  if p_id is null then
    raise exception 'The stroke is damaged.' using errcode = '22023';
  end if;
  -- One change at a time per Hall, so the limits and the lock below hold when members draw at the same moment.
  perform 1 from public.community_halls h where h.world_id = p_world for update;
  select * into existing from public.canvas_strokes s where s.id = p_id;
  if existing.id is not null then
    if existing.world_id <> p_world or existing.author_id is distinct from uid then
      raise exception 'That stroke is not yours.' using errcode = '42501';
    end if;
    return (select private.canvas_op_json(o) from public.canvas_ops o where o.stroke_id = p_id and o.kind = 'add');
  end if;

  perform private.canvas_need_unlocked(p_world);
  if p_tool is null or p_tool not in ('pen', 'marker') or p_color is null or p_color !~ '^#[0-9a-f]{6}$'
     or p_width is null or p_width not between 1 and 64 then
    raise exception 'That pen is not one WebTown has.' using errcode = '22023';
  end if;
  n := coalesce(cardinality(p_points), 0);
  if p_points is null or array_ndims(p_points) <> 1 or n < 2 or n > 4000 or n % 2 <> 0
     or array_position(p_points, null) is not null then
    raise exception 'The stroke is damaged or too long.' using errcode = '22023';
  end if;
  select min(v) filter (where i % 2 = 1), max(v) filter (where i % 2 = 1),
         min(v) filter (where i % 2 = 0), max(v) filter (where i % 2 = 0)
    into min_x, max_x, min_y, max_y
    from unnest(p_points) with ordinality as t(v, i);
  if greatest(abs(min_x), abs(max_x), abs(min_y), abs(max_y)) > lim then
    raise exception 'That stroke goes outside the canvas.' using errcode = '22023';
  end if;

  if (select count(*) from public.canvas_strokes s where s.world_id = p_world and s.author_id = uid
        and s.created_at > now() - interval '1 minute') >= private.canvas_limit('per_minute') then
    raise exception 'Slow down a little: you can draw again in a moment.' using errcode = '22023';
  end if;
  if (select count(*) from public.canvas_strokes s where s.world_id = p_world and s.author_id = uid
        and s.created_at > now() - interval '1 day') >= private.canvas_limit('per_day') then
    raise exception 'That is a lot of drawing for one day. You can draw again tomorrow.' using errcode = '22023';
  end if;
  if (select count(*) from public.canvas_strokes s where s.world_id = p_world and s.hidden_at is null) >= private.canvas_limit('visible') then
    raise exception 'The canvas is full. A moderator can clear part of it.' using errcode = '22023';
  end if;

  pad := ceil(p_width / 2.0);
  insert into public.canvas_strokes (id, world_id, author_id, tool, color, width, points, bbox)
  values (p_id, p_world, uid, p_tool, p_color, p_width, p_points,
          box(point(min_x - pad, min_y - pad), point(max_x + pad, max_y + pad)));
  return private.canvas_record(p_world, 'add', p_id, null, null);
end $$;

-- Erase or undo your own stroke ('erased', 'undone'); moderators may hide anyone's ('moderated', logged).
-- Hiding a stroke that is already hidden changes nothing and returns null.
create function public.hide_canvas_stroke(p_world uuid, p_id uuid, p_reason text, p_note text default null) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  uid uuid := private.need_hall_member(p_world);
  s public.canvas_strokes;
begin
  select * into s from public.canvas_strokes x where x.id = p_id and x.world_id = p_world for update;
  if s.id is null then
    raise exception 'That stroke is not on this canvas.' using errcode = '22023';
  end if;
  if p_reason in ('erased', 'undone') then
    if s.author_id is distinct from uid then
      raise exception 'You can only erase your own drawing. A moderator can remove others''.' using errcode = '42501';
    end if;
    perform private.canvas_need_unlocked(p_world);
  elsif p_reason = 'moderated' then
    if not private.is_hall_moderator(p_world) then
      raise exception 'Only moderators can remove other people''s drawing.' using errcode = '42501';
    end if;
  else
    raise exception 'That is not a reason WebTown knows.' using errcode = '22023';
  end if;
  if s.hidden_at is not null then
    return null;
  end if;
  update public.canvas_strokes x set hidden_at = now(), hidden_by = uid, hidden_reason = p_reason where x.id = p_id;
  if p_reason = 'moderated' then
    perform private.log_moderation(p_world, 'hide_stroke', jsonb_build_object('strokeId', p_id, 'authorId', s.author_id), p_note);
  end if;
  return private.canvas_record(p_world, 'hide', p_id, null, null);
end $$;

-- Brings a hidden stroke back. Only its author after their own erase or undo (redo): a moderator can't overrule
-- someone taking their own drawing away. Moderators bring back what a moderator removed or cleared (logged).
-- Restoring a visible stroke changes nothing and returns null.
create function public.restore_canvas_stroke(p_world uuid, p_id uuid, p_note text default null) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  uid uuid := private.need_hall_member(p_world);
  s public.canvas_strokes;
begin
  perform 1 from public.community_halls h where h.world_id = p_world for update;
  select * into s from public.canvas_strokes x where x.id = p_id and x.world_id = p_world for update;
  if s.id is null then
    raise exception 'That stroke is not on this canvas.' using errcode = '22023';
  end if;
  if s.hidden_at is null then
    return null;
  end if;
  if s.hidden_reason in ('erased', 'undone') then
    if s.author_id is distinct from uid then
      raise exception 'Only the person who drew it can bring it back.' using errcode = '42501';
    end if;
    perform private.canvas_need_unlocked(p_world);
  elsif not private.is_hall_moderator(p_world) then
    raise exception 'Only moderators can bring back drawing a moderator removed.' using errcode = '42501';
  end if;
  if (select count(*) from public.canvas_strokes x where x.world_id = p_world and x.hidden_at is null) >= private.canvas_limit('visible') then
    raise exception 'The canvas is full. A moderator can clear part of it.' using errcode = '22023';
  end if;
  update public.canvas_strokes x set hidden_at = null, hidden_by = null, hidden_reason = null where x.id = p_id;
  if s.hidden_reason in ('moderated', 'cleared') then
    perform private.log_moderation(p_world, 'restore_stroke', jsonb_build_object('strokeId', p_id, 'authorId', s.author_id), p_note);
  end if;
  return private.canvas_record(p_world, 'restore', p_id, null, null);
end $$;

-- Moderators: hides every visible stroke touching the area (at most 5,000 at a time; call again for more).
create function public.clear_canvas_region(p_world uuid, p_x1 int, p_y1 int, p_x2 int, p_y2 int, p_note text default null)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  uid uuid := private.need_hall_member(p_world);
  area box;
  ids uuid[];
begin
  if not private.is_hall_moderator(p_world) then
    raise exception 'Only moderators can clear part of the canvas.' using errcode = '42501';
  end if;
  area := private.canvas_box(p_x1, p_y1, p_x2, p_y2);
  with hit as (
    select s.id from public.canvas_strokes s
    where s.world_id = p_world and s.hidden_at is null and s.bbox && area
    order by s.created_at limit private.canvas_limit('clear')
    for update
  ), hidden as (
    update public.canvas_strokes s set hidden_at = now(), hidden_by = uid, hidden_reason = 'cleared'
    from hit where s.id = hit.id returning s.id
  )
  select coalesce(array_agg(id), '{}') into ids from hidden;
  if cardinality(ids) = 0 then
    return null;
  end if;
  perform private.log_moderation(p_world, 'clear_region',
    jsonb_build_object('region', private.canvas_box_json(area), 'strokes', cardinality(ids)), p_note);
  return private.canvas_record(p_world, 'clear', null, area, ids);
end $$;

-- Moderators: lock or unlock the canvas or the website draft. No change, no log entry.
create function public.set_hall_lock(p_world uuid, p_what text, p_locked boolean, p_note text default null) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  uid uuid := private.need_hall_member(p_world);
  was boolean;
begin
  if not private.is_hall_moderator(p_world) then
    raise exception 'Only moderators can lock or unlock.' using errcode = '42501';
  end if;
  if p_what not in ('canvas', 'draft') or p_locked is null then
    raise exception 'That is not something WebTown can lock.' using errcode = '22023';
  end if;
  if p_what = 'canvas' then
    select h.canvas_locked into was from public.community_halls h where h.world_id = p_world for update;
    update public.community_halls h set canvas_locked = p_locked where h.world_id = p_world;
  else
    select h.draft_locked into was from public.community_halls h where h.world_id = p_world for update;
    update public.community_halls h set draft_locked = p_locked where h.world_id = p_world;
  end if;
  if was is distinct from p_locked then
    perform private.log_moderation(p_world, (case when p_locked then 'lock_' else 'unlock_' end) || p_what, '{}'::jsonb, p_note);
  end if;
end $$;

-- Visible strokes touching an area, oldest first, and the newest operation number (to catch up from afterwards).
create function public.canvas_strokes_in(p_world uuid, p_x1 int, p_y1 int, p_x2 int, p_y2 int, p_limit int default 2000)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  area box;
  latest bigint;
  found_count int;
  result jsonb;
begin
  perform private.need_hall_member(p_world);
  if p_limit is null or p_limit < 1 or p_limit > private.canvas_limit('query') then
    raise exception 'Ask for 1 to 5,000 strokes.' using errcode = '22023';
  end if;
  area := private.canvas_box(p_x1, p_y1, p_x2, p_y2);
  -- The operation number first: anything after it is caught up from the log, so nothing falls in between.
  select coalesce(max(o.seq), 0) into latest from public.canvas_ops o where o.world_id = p_world;
  select coalesce(jsonb_agg(private.canvas_stroke_json(s) order by s.created_at, s.id), '[]'::jsonb), count(*)
    into result, found_count
    from (select * from public.canvas_strokes s
          where s.world_id = p_world and s.hidden_at is null and s.bbox && area
          order by s.created_at, s.id limit p_limit + 1) s;
  if found_count > p_limit then
    result := result - p_limit; -- drop the extra one fetched only to know there are more
  end if;
  return jsonb_build_object('seq', latest, 'strokes', result, 'truncated', found_count > p_limit);
end $$;

-- What changed after `p_seq`, in order. `more` says to ask again.
create function public.canvas_ops_since(p_world uuid, p_seq bigint, p_limit int default 500) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  ops jsonb;
  n int;
begin
  perform private.need_hall_member(p_world);
  if p_seq is null or p_seq < 0 then
    raise exception 'That is not a place in the canvas history.' using errcode = '22023';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > private.canvas_limit('ops') then
    raise exception 'Ask for 1 to 1,000 changes.' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(private.canvas_op_json(o) order by o.seq), '[]'::jsonb), count(*) into ops, n
    from (select * from public.canvas_ops o where o.world_id = p_world and o.seq > p_seq order by o.seq limit p_limit + 1) o;
  if n > p_limit then
    ops := ops - p_limit;
  end if;
  return jsonb_build_object('ops', ops, 'more', n > p_limit);
end $$;

-- ── Grants (S4 rule: private helpers only where a policy needs them; none here does) ────────────────────────

revoke all on function private.canvas_limit(text), private.canvas_stroke_json(public.canvas_strokes),
  private.canvas_box_json(box), private.canvas_op_json(public.canvas_ops),
  private.canvas_record(uuid, text, uuid, box, uuid[]), private.canvas_box(int, int, int, int),
  private.canvas_need_unlocked(uuid)
from public, anon, authenticated;

revoke all on function public.add_canvas_stroke(uuid, uuid, text, text, int, int[]),
  public.hide_canvas_stroke(uuid, uuid, text, text), public.restore_canvas_stroke(uuid, uuid, text),
  public.clear_canvas_region(uuid, int, int, int, int, text), public.set_hall_lock(uuid, text, boolean, text),
  public.canvas_strokes_in(uuid, int, int, int, int, int), public.canvas_ops_since(uuid, bigint, int)
from public, anon;
grant execute on function public.add_canvas_stroke(uuid, uuid, text, text, int, int[]),
  public.hide_canvas_stroke(uuid, uuid, text, text), public.restore_canvas_stroke(uuid, uuid, text),
  public.clear_canvas_region(uuid, int, int, int, int, text), public.set_hall_lock(uuid, text, boolean, text),
  public.canvas_strokes_in(uuid, int, int, int, int, int), public.canvas_ops_since(uuid, bigint, int)
to authenticated;
