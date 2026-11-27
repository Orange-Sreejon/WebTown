-- WebTown Community Hall, CH-04: canvas operations become visible in sequence order.
--
-- canvas_ops.seq comes from an identity, so two changes made at the same moment could commit out of order: a reader
-- could see seq 11 before seq 10 exists, and a client that caught up "to 11" would never ask for 10. Every change
-- now takes its Hall's row lock before anything else, and holds it to commit, so a Hall's operations are numbered
-- and committed one at a time. add_canvas_stroke and restore_canvas_stroke already took that lock first; this
-- makes hide_canvas_stroke and clear_canvas_region do the same (taking it after a stroke's lock could deadlock with
-- a restore) and has canvas_record insist on it. Bodies are otherwise unchanged; `create or replace` keeps grants.

create or replace function private.canvas_record(p_world uuid, p_kind text, p_stroke uuid, p_region box, p_strokes uuid[]) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  op public.canvas_ops;
  message jsonb;
begin
  -- Already held by every caller (taken first, so no deadlock); here so an operation can never be recorded without it.
  perform 1 from public.community_halls h where h.world_id = p_world for update;
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

create or replace function public.hide_canvas_stroke(p_world uuid, p_id uuid, p_reason text, p_note text default null) returns jsonb
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

create or replace function public.clear_canvas_region(p_world uuid, p_x1 int, p_y1 int, p_x2 int, p_y2 int, p_note text default null)
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
  perform 1 from public.community_halls h where h.world_id = p_world for update;
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
