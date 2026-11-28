-- WebTown Community Hall, CH-07: locking or unlocking the canvas or the website draft is announced on the Hall's
-- channel, so members see it at once instead of when their next stroke or save is refused. The announcement is
-- `{ what, locked }`, event `lock`, best effort, and a hint only (members can broadcast on that channel too): clients
-- read the state again with hall_context. The body is otherwise the one from 20261215090000; `create or replace`
-- keeps the grants.

create or replace function public.set_hall_lock(p_world uuid, p_what text, p_locked boolean, p_note text default null) returns void
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
    begin
      perform realtime.send(jsonb_build_object('what', p_what, 'locked', p_locked), 'lock', 'hall:' || p_world::text, true);
    exception when others then
      null;
    end;
  end if;
end $$;
