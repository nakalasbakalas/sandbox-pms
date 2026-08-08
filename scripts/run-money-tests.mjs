/* global console */
import assert from 'node:assert/strict'
import {
  bahtToSatang,
  dualWriteMoney,
  moneyReadAuthority,
  readMoneySatang,
  resolveMoneyInput,
  satangToBahtNumber,
  stringifyJsonWithBigInt,
} from '../server/money.mjs'
import { calculateStayPricingSatang } from '../server/pms-domain.mjs'
import { createPayment } from '../server/pms-service.mjs'

assert.equal(bahtToSatang('1234.56'), 123456n)
assert.equal(bahtToSatang('1.005'), 101n, 'baht conversion uses deterministic half-up rounding')
assert.equal(bahtToSatang('-1.005'), -101n, 'negative halves round away from zero')
assert.equal(satangToBahtNumber(123456n), 1234.56)
assert.deepEqual(dualWriteMoney('amount', 'amountSatang', 3005n), { amount: 30.05, amountSatang: 3005n })
assert.deepEqual(resolveMoneyInput({ amount: 30.05, amountSatang: '3005' }), { legacyBaht: 30.05, satang: 3005n })
assert.throws(
  () => resolveMoneyInput({ amount: 30.05, amountSatang: '3006' }),
  /must represent the same value/,
)
assert.equal(moneyReadAuthority({ MONEY_READ_AUTHORITY: 'satang' }), 'satang')
assert.throws(
  () => moneyReadAuthority({ MONEY_READ_AUTHORITY: 'invalid' }),
  /must be one of: legacy_float, satang/,
  'unknown authority values are rejected for runtime and preflight callers',
)
assert.equal(readMoneySatang({ amount: 1.23, amountSatang: 124n }, 'amount', 'amountSatang', { MONEY_READ_AUTHORITY: 'legacy_float' }), 123n)
assert.equal(readMoneySatang({ amount: 1.23, amountSatang: 124n }, 'amount', 'amountSatang', { MONEY_READ_AUTHORITY: 'satang' }), 124n)
assert.equal(stringifyJsonWithBigInt({ amountSatang: 3005n }), '{"amountSatang":"3005"}')

const exactPricingBase = {
  checkIn: '2026-08-10',
  adults: 2,
  childAges: [],
  standardOccupancy: 2,
  maxOccupancy: 4,
  ratePerNightSatang: '75000',
  extraGuestFeePerNightSatang: '30000',
  childSharingFeePerNightSatang: '30000',
}
assert.equal(
  calculateStayPricingSatang({ ...exactPricingBase, checkOut: '2026-08-11' }).totalSatang,
  75_000n,
  'one THB 750 night prices exactly',
)
assert.equal(
  calculateStayPricingSatang({ ...exactPricingBase, checkOut: '2026-08-12' }).totalSatang,
  150_000n,
  'multi-night pricing multiplies exact satang',
)
assert.equal(
  calculateStayPricingSatang({ ...exactPricingBase, checkOut: '2026-08-11', adults: 3 }).extraGuestFeeSatang,
  30_000n,
  'extra-adult fees use the exact property shadow',
)
assert.equal(
  calculateStayPricingSatang({ ...exactPricingBase, checkOut: '2026-08-11', childAges: [8] }).childFeeSatang,
  30_000n,
  'child-sharing fees use the exact property shadow',
)
const oddExplicitTotal = calculateStayPricingSatang({
  ...exactPricingBase,
  checkOut: '2026-08-12',
  ratePerNightSatang: '5001',
  totalAmountSatang: '10001',
})
assert.equal(oddExplicitTotal.calculatedTotalSatang, 10_002n)
assert.equal(oddExplicitTotal.totalSatang, 10_001n, 'an explicit odd booking total is not rebuilt from a rounded uniform nightly rate')
assert.throws(
  () => calculateStayPricingSatang({ ...exactPricingBase, checkOut: '2026-08-11', childSharingFeePerNightSatang: null }),
  /childSharingFeePerNightSatang.*(?:required|base-10 satang integer)/,
  'exact pricing rejects a missing fee shadow',
)

function paymentFixture({ status = 'OPEN', balanceSatang = 10_000n, failSerializableOnce = false } = {}) {
  const payments = []
  const audits = []
  const domainEvents = []
  const transactionOptions = []
  let transactionAttempts = 0
  const folio = {
    id: 'folio-1',
    status,
    subtotal: 100,
    subtotalSatang: 10_000n,
    tax: 0,
    taxSatang: 0n,
    total: 100,
    totalSatang: 10_000n,
    paid: satangToBahtNumber(10_000n - balanceSatang),
    paidSatang: 10_000n - balanceSatang,
    balance: satangToBahtNumber(balanceSatang),
    balanceSatang,
    reservation: { propertyId: 'property-1' },
  }
  const charges = [{ id: 'charge-1', folioId: folio.id, total: 100, totalSatang: 10_000n, void: false }]

  const prisma = {
    property: {
      findUnique: async ({ where }) => where.id === 'property-1' || where.code === 'SANDBOX'
        ? { id: 'property-1', code: 'SANDBOX' }
        : null,
    },
    bookingEmailEvent: {
      findFirst: async ({ where }) => where.id === 'source-event-1' && where.propertyId === 'property-1'
        ? { id: 'source-event-1' }
        : null,
    },
    folio: {
      findUnique: async ({ where }) => where.id === folio.id ? { ...folio } : null,
      findFirst: async ({ where }) => where.id === folio.id && where.reservation?.propertyId === folio.reservation.propertyId
        ? { ...folio }
        : null,
      update: async ({ where, data }) => {
        assert.equal(where.id, folio.id)
        Object.assign(folio, data)
        return { ...folio, charges: [...charges], payments: [...payments] }
      },
    },
    charge: {
      findMany: async ({ where }) => charges.filter((charge) => charge.folioId === where.folioId && !charge.void),
    },
    payment: {
      findUnique: async ({ where }) => {
        if (where.propertyId_idempotencyKey) {
          return payments.find((payment) => payment.propertyId === where.propertyId_idempotencyKey.propertyId && payment.idempotencyKey === where.propertyId_idempotencyKey.idempotencyKey) || null
        }
        if (where.propertyId_referenceFingerprint) {
          return payments.find((payment) => payment.propertyId === where.propertyId_referenceFingerprint.propertyId && payment.referenceFingerprint === where.propertyId_referenceFingerprint.referenceFingerprint) || null
        }
        if (where.idempotencyKey) return payments.find((payment) => payment.idempotencyKey === where.idempotencyKey) || null
        if (where.referenceFingerprint) return payments.find((payment) => payment.referenceFingerprint === where.referenceFingerprint) || null
        if (where.sourceEmailEventId) return payments.find((payment) => payment.sourceEmailEventId === where.sourceEmailEventId) || null
        return null
      },
      findMany: async ({ where }) => payments.filter((payment) => payment.folioId === where.folioId),
      create: async ({ data }) => {
        const payment = { id: `payment-${payments.length + 1}`, createdAt: new Date(), ...data }
        payments.push(payment)
        return payment
      },
    },
    auditLog: {
      create: async ({ data }) => {
        audits.push(data)
        return data
      },
    },
    domainEvent: {
      create: async ({ data }) => {
        const event = { id: BigInt(domainEvents.length + 1), createdAt: new Date(), ...data }
        domainEvents.push(event)
        return event
      },
    },
    $transaction: async (callback, options) => {
      transactionAttempts += 1
      transactionOptions.push(options)
      if (failSerializableOnce && transactionAttempts === 1) {
        const error = new Error('serialization conflict')
        error.code = 'P2034'
        throw error
      }
      return callback(prisma)
    },
  }

  return { prisma, folio, payments, audits, domainEvents, transactionOptions, transactionAttempts: () => transactionAttempts }
}

const fixture = paymentFixture()
const paymentInput = {
  folioId: fixture.folio.id,
  amount: 30.05,
  amountSatang: '3005',
  method: 'CASH',
  idempotencyKey: 'front-desk-attempt-1',
}
const created = await createPayment(fixture.prisma, paymentInput, { id: 'cashier-1', name: 'Cashier' })
assert.equal(created.payment.amount, 30.05, 'legacy Float response remains available')
assert.equal(created.payment.amountSatang, 3005n)
assert.equal(created.folio.paidSatang, 3005n)
assert.equal(created.folio.balanceSatang, 6995n)
assert.equal(fixture.transactionOptions[0].isolationLevel, 'Serializable')
assert.equal(fixture.payments.length, 1)
assert.equal(fixture.audits.length, 1)
assert.equal(fixture.domainEvents.length, 1)

const replay = await createPayment(fixture.prisma, paymentInput, { id: 'cashier-1', name: 'Cashier' })
assert.equal(replay.idempotentReplay, true)
assert.equal(replay.payment.id, created.payment.id)
assert.equal(fixture.payments.length, 1, 'idempotent replay does not create a second payment')
assert.equal(fixture.audits.length, 1, 'idempotent replay does not duplicate audit evidence')
assert.equal(fixture.domainEvents.length, 1, 'idempotent replay does not duplicate domain events')

await assert.rejects(
  createPayment(fixture.prisma, { ...paymentInput, amount: 31, amountSatang: '3100' }, { id: 'cashier-1' }),
  (error) => error?.statusCode === 409 && /different payment/.test(error.message),
)

await assert.rejects(
  createPayment(paymentFixture().prisma, { folioId: 'folio-1', amount: 1, method: 'CASH' }, { id: 'cashier-1' }),
  /idempotency key is required/,
  'payment writes reject requests without an idempotency key',
)

await assert.rejects(
  createPayment(paymentFixture().prisma, {
    folioId: 'folio-1',
    amount: 1,
    method: 'CASH',
    idempotencyKey: 'foreign-email-event-attempt',
    sourceEmailEventId: 'source-event-from-another-property',
  }, { id: 'cashier-1' }),
  (error) => error?.statusCode === 404 && /active property/.test(error.message),
  'payment writes reject booking-email links outside the active property',
)

const closedFixture = paymentFixture({ status: 'CLOSED', balanceSatang: 0n })
await assert.rejects(
  createPayment(closedFixture.prisma, { folioId: 'folio-1', amount: 1, method: 'CASH', allowOverpayment: true, idempotencyKey: 'closed-folio-attempt' }, { id: 'cashier-1' }),
  (error) => error?.statusCode === 409 && /open folio/.test(error.message),
)

const overpaymentFixture = paymentFixture({ balanceSatang: 500n })
await assert.rejects(
  createPayment(overpaymentFixture.prisma, { folioId: 'folio-1', amount: 5.01, method: 'CASH', idempotencyKey: 'overpayment-attempt' }, { id: 'cashier-1' }),
  /cannot exceed the remaining balance/,
)
await assert.rejects(
  createPayment(paymentFixture({ balanceSatang: 500n }).prisma, {
    folioId: 'folio-1',
    amount: 5.01,
    method: 'CASH',
    allowOverpayment: true,
    idempotencyKey: 'overpayment-override-attempt',
  }, { id: 'cashier-1' }),
  /cannot exceed the remaining balance/,
  'caller-supplied overpayment flags cannot bypass the balance guard',
)

const retryFixture = paymentFixture({ failSerializableOnce: true })
await createPayment(retryFixture.prisma, { folioId: 'folio-1', amount: 1, method: 'CASH', idempotencyKey: 'serialization-retry-attempt' }, { id: 'cashier-1' })
assert.equal(retryFixture.transactionAttempts(), 2, 'serialization conflicts are retried once')

console.log('Exact-money and payment-safety tests passed.')
