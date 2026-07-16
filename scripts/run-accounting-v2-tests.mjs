/* global console */
import assert from 'node:assert/strict'
import {
  accountingV2Enabled,
  calculateFolioBalanceSatang,
  reverseAccountingCharge,
} from '../server/accounting-service.mjs'

assert.equal(accountingV2Enabled({}), false, 'Accounting V2 defaults disabled when the flag is absent')
assert.equal(accountingV2Enabled({ ACCOUNTING_V2_ENABLED: 'false' }), false, 'Accounting V2 remains disabled for the release default')
assert.equal(accountingV2Enabled({ ACCOUNTING_V2_ENABLED: 'true' }), true, 'Accounting V2 requires an explicit true flag')

assert.equal(calculateFolioBalanceSatang({
  charges: [{ kind: 'CHARGE', amountSatang: 10_000n }],
  payments: [{ kind: 'PAYMENT', amountSatang: 7_000n }],
  receivableEntries: [{ kind: 'TRANSFER', amountSatang: 3_000n }],
}), 0n, 'charge, partial payment, and A/R transfer reconcile to exact zero satang')

function chargeFixture() {
  const original = {
    id: 'charge-original', propertyId: 'property-1', folioId: 'folio-1', kind: 'CHARGE',
    description: 'Room charge', amountSatang: 12_345n, actorId: 'cashier-1', reason: 'Posted room charge',
    idempotencyKey: 'original-charge-1', createdAt: new Date('2026-07-16T00:00:00Z'),
  }
  const rows = [original]
  const prisma = {
    $transaction: async (work) => work(prisma),
    accountingCharge: {
      findUnique: async ({ where }) => rows.find((row) => row.propertyId === where.propertyId_idempotencyKey.propertyId
        && row.idempotencyKey === where.propertyId_idempotencyKey.idempotencyKey) || null,
      findFirst: async ({ where }) => rows.find((row) => {
        if (where.id && row.id !== where.id) return false
        if (where.propertyId && row.propertyId !== where.propertyId) return false
        if (where.kind && row.kind !== where.kind) return false
        if (where.originalChargeId && row.originalChargeId !== where.originalChargeId) return false
        return true
      }) || null,
      create: async ({ data }) => {
        const row = { id: `charge-${rows.length + 1}`, createdAt: new Date(), ...data }
        rows.push(row)
        return row
      },
    },
  }
  return { prisma, rows, original }
}

const disabledFixture = chargeFixture()
await assert.rejects(
  reverseAccountingCharge(disabledFixture.prisma, {
    chargeId: 'charge-original', reason: 'Correct an input mistake', idempotencyKey: 'reverse-charge-disabled',
  }, { propertyId: 'property-1', actor: { id: 'manager-1', role: 'MANAGER' } }, {}),
  /Accounting V2 is disabled/,
  'disabled accounting cannot mutate the ledger',
)
assert.equal(disabledFixture.rows.length, 1)

const fixture = chargeFixture()
const originalSnapshot = { ...fixture.original }
const reversal = await reverseAccountingCharge(fixture.prisma, {
  chargeId: fixture.original.id,
  reason: 'Correct duplicate room charge',
  idempotencyKey: 'reverse-charge-attempt-1',
  auditEvidence: { ticket: 'front-desk-17' },
}, { propertyId: 'property-1', actor: { id: 'manager-1', role: 'MANAGER' } }, { ACCOUNTING_V2_ENABLED: 'true' })

assert.equal(fixture.rows.length, 2, 'reversal appends a second ledger row')
assert.deepEqual(fixture.original, originalSnapshot, 'reversal never mutates the original posted charge')
assert.equal(reversal.kind, 'REVERSAL')
assert.equal(reversal.originalChargeId, fixture.original.id)
assert.equal(reversal.amountSatang, '12345', 'money is returned through the base-10 satang API contract')
assert.equal(calculateFolioBalanceSatang({ charges: fixture.rows }), 0n, 'original and reversal reconcile to exact zero')

const replay = await reverseAccountingCharge(fixture.prisma, {
  chargeId: fixture.original.id,
  reason: 'Correct duplicate room charge',
  idempotencyKey: 'reverse-charge-attempt-1',
  auditEvidence: { ticket: 'front-desk-17' },
}, { propertyId: 'property-1', actor: { id: 'manager-1', role: 'MANAGER' } }, { ACCOUNTING_V2_ENABLED: 'true' })
assert.equal(fixture.rows.length, 2, 'idempotent retry returns the existing reversal without another row')
assert.equal(replay.id, reversal.id)

console.log('Accounting V2 foundation tests passed.')
