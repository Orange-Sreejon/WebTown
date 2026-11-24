-- WebTown Phase 5 stabilization (S4): signed-in users may execute only the `private` functions they actually need.
--
-- The Phase 4 and Phase 5 migrations granted EXECUTE on every function in schema `private` to `authenticated`.
-- Two of them are SECURITY DEFINER and act on any ids they are given:
--   private.drop_member(world, user)    removes any member from any world and deletes their house there
--   private.player_context(user, world) returns any user's profile, world and houses
-- The Data API exposes only `public`, so nobody can call them today; but if `private` were ever exposed (a setting in
-- the dashboard), any signed-in user could remove anyone from any world. This revokes what nothing needs.
--
-- What stays granted, and why (checked against pg_policies and every function body, see the schema tests):
--   used by RLS policies, which run as the signed-in user:
--     is_world_member, shares_world, owns_house, can_view_house, house_path_allows, realtime_world_member
--   used by SECURITY INVOKER functions in `public` (they run as the signed-in user):
--     owns_house, can_view_house, house_folder, iso
--   the trigger function touch_updated_at
-- What is revoked: functions called only from SECURITY DEFINER functions, which run as their owner and keep working.
--
-- Consequence for future migrations: do not use `grant execute on all functions in schema private to authenticated`
-- again; grant each new private function only if a policy or an invoker function needs it.

revoke execute on function
  private.drop_member(uuid, uuid),
  private.player_context(uuid, uuid),
  private.is_world_owner(uuid),
  private.need_user(),
  private.new_invite_code(),
  private.invite_hash(text),
  private.normalise_invite(text),
  private.max_world_members(),
  private.town_slots()
from authenticated, anon, public;
