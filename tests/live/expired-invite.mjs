// The expired-invitation check needs one invitation whose expiry is in the past. The shortest an invitation can be
// made for is 1 day, and only an administrator can change `expires_at`, so it takes two manual steps, once:
//
//   1. node tests/live/expired-invite.mjs
//      Signs in ONE anonymous test guest ("LT expired-invite owner"), creates one 1-day invitation in that guest's
//      own world, saves its id, hint, world and code in the git-ignored file .env.live-expired-invite.local, and
//      prints the SQL for step 2 (it never prints the code). If the file already exists it only prints the SQL again.
//   2. Run the printed SQL in the test project's SQL editor. It changes exactly that one invitation.
//
// The live test "an expired invitation is refused" then uses the saved invitation. Without the file it is skipped,
// with this reason shown.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
export const EXPIRED_INVITE_FILE = join(root, '.env.live-expired-invite.local')

/** The prepared invitation, or null if step 1 has not been done. */
export function readExpiredInvite() {
  if (!existsSync(EXPIRED_INVITE_FILE)) return null
  const v = {}
  for (const line of readFileSync(EXPIRED_INVITE_FILE, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^(EXPIRED_INVITE_[A-Z]+)=(.*)$/)
    if (m) v[m[1]] = m[2].trim()
  }
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
  if (!uuid.test(v.EXPIRED_INVITE_ID ?? '') || !uuid.test(v.EXPIRED_INVITE_WORLD ?? '') || !/^[A-Z0-9]{4}$/.test(v.EXPIRED_INVITE_HINT ?? '') || !v.EXPIRED_INVITE_CODE) {
    throw new Error(`${EXPIRED_INVITE_FILE} is not a prepared invitation; delete it and run node tests/live/expired-invite.mjs again`)
  }
  return { id: v.EXPIRED_INVITE_ID, worldId: v.EXPIRED_INVITE_WORLD, hint: v.EXPIRED_INVITE_HINT, code: v.EXPIRED_INVITE_CODE }
}

/** The one-row update for step 2, and its revert. */
export function expireSql(inv) {
  return {
    expire: [
      'update public.world_invites',
      "   set expires_at = now() - interval '1 minute'",
      ` where id = '${inv.id}'`,
      `   and world_id = '${inv.worldId}'`,
      `   and hint = '${inv.hint}'`,
      '   and revoked_at is null',
      '   and uses = 0',
      'returning id, hint, expires_at;',
    ].join('\n'),
    revert: `update public.world_invites set expires_at = now() + interval '1 day' where id = '${inv.id}' returning id, expires_at;`,
  }
}

async function main() {
  let inv = readExpiredInvite()
  if (!inv) {
    const { makeGuest, rpc } = await import('./live-helpers.mjs')
    const { URL_, KEY } = await import('./live-helpers.mjs')
    if (!URL_ || !KEY) throw new Error('Set WEBTOWN_LIVE_SUPABASE_URL and WEBTOWN_LIVE_SUPABASE_KEY (or .env.live.local) first.')
    const owner = await makeGuest('expired-invite owner')
    const created = await rpc(owner.client, 'create_world_invite', { p_world: owner.worldId, p_days: 1 })
    inv = { id: created.id, worldId: owner.worldId, hint: created.hint, code: created.code }
    writeFileSync(EXPIRED_INVITE_FILE, [
      '# Prepared by tests/live/expired-invite.mjs for the live test "an expired invitation is refused". Git-ignored.',
      `EXPIRED_INVITE_ID=${inv.id}`,
      `EXPIRED_INVITE_WORLD=${inv.worldId}`,
      `EXPIRED_INVITE_HINT=${inv.hint}`,
      `EXPIRED_INVITE_CODE=${inv.code}`,
      '',
    ].join('\n'))
    console.log(`Created invitation ${inv.id} (hint ${inv.hint}) in world ${inv.worldId}; saved to .env.live-expired-invite.local.`)
  } else {
    console.log(`Already prepared: invitation ${inv.id} (hint ${inv.hint}) in world ${inv.worldId}.`)
  }
  const sql = expireSql(inv)
  console.log('\nStep 2, in the TEST project\'s SQL editor (expect exactly one row back):\n')
  console.log(sql.expire)
  console.log('\nTo undo it (not needed for the tests):\n')
  console.log(sql.revert)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch(error => {
    console.error(error.message)
    process.exit(1)
  })
}
