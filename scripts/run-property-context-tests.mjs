/* global console */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { URL } from 'node:url'
import { resolveRequestContext } from '../server/request-context.mjs'
import { canPerformAction, requirePermission } from '../server/rbac.mjs'

const property = { id: 'property-sandbox', code: 'SANDBOX' }
const globalAdmin = { id: 'user-1', username: 'staff', role: 'ADMIN', active: true }

function prismaFor(membership) {
  return {
    property: {
      findUnique: async ({ where }) => where.code === property.code ? property : null,
    },
    userPropertyMembership: {
      findUnique: async ({ where }) => {
        assert.deepEqual(where, {
          userId_propertyId: { userId: globalAdmin.id, propertyId: property.id },
        })
        return membership
      },
    },
  }
}

const context = await resolveRequestContext(
  prismaFor({ id: 'membership-1', role: 'FRONT_DESK', active: true }),
  globalAdmin,
  { requestId: 'request-12345678', headers: { 'x-idempotency-key': 'payment-1' } },
)

assert.equal(context.role, 'FRONT_DESK')
assert.equal(context.actor.role, 'FRONT_DESK')
assert.equal(context.actor.propertyId, property.id)
assert.equal(context.actor.membershipId, 'membership-1')
assert.equal(context.idempotencyKey, 'payment-1')
assert.equal(canPerformAction(context.actor, 'create:reservation'), true)
assert.equal(canPerformAction(context.actor, 'manage:users'), false)
assert.throws(() => requirePermission(context.actor, 'manage:users'), { statusCode: 403 })

await assert.rejects(
  resolveRequestContext(
    prismaFor({ id: 'membership-disabled', role: 'ADMIN', active: false }),
    globalAdmin,
    { requestId: 'request-12345678', headers: {} },
  ),
  { statusCode: 403 },
)

const propertyScopeMigration = await readFile(
  new URL('../prisma/migrations/20260717120000_property_scope_legacy_records/migration.sql', import.meta.url),
  'utf8',
)
assert.match(
  propertyScopeMigration,
  /GROUP BY r\."guestId"\s+HAVING COUNT\(DISTINCT r\."propertyId"\) > 1/,
  'property migration fails before assigning one guest to an arbitrary property',
)
assert.match(
  propertyScopeMigration,
  /GROUP BY a\."userId"\s+HAVING COUNT\(DISTINCT m\."propertyId"\) > 1/,
  'property migration fails before assigning multi-property audit evidence arbitrarily',
)
assert.match(propertyScopeMigration, /quarantine and reconcile those guests before retrying/)
assert.match(propertyScopeMigration, /quarantine and reconcile those audit rows before retrying/)

console.log('Property request-context tests passed.')
