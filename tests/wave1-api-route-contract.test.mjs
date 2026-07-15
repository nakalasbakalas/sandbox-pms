import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveApiRouteContract } from '../server/api-routes.mjs'

for (const [label, pathname] of [
  ['payment reversal', '/api/payments/payment-1/reversals'],
  ['charge void', '/api/charges/charge-1/void'],
  ['booking-email evidence access', '/api/booking-email/events/event-1/evidence'],
]) {
  test(`${label} route is registered as POST-only`, () => {
    assert.deepEqual(resolveApiRouteContract(pathname), {
      methods: ['POST'],
      allow: 'POST',
    })
  })
}
