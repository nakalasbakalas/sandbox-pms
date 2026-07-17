/* global console */
import assert from 'node:assert/strict'
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

console.log('Property request-context tests passed.')
