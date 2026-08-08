/* global console, URL */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  MONEY_RECONCILIATION_MODELS,
  MoneyReconciliationError,
  assertSafeReadOnlyDatabase,
  parseReconciliationArgs,
  reconcileMoney,
  reconcileMoneyRows,
  reconciliationFailureReport,
} from './reconcile-money.mjs'

const requiredPairs = [
  'Property.extraGuestFee:extraGuestFeeSatang',
  'Property.childFee:childFeeSatang',
  'Property.inventoryMinimumRate:inventoryMinimumRateSatang',
  'RoomType.baseRate:baseRateSatang',
  'Reservation.ratePerNight:ratePerNightSatang',
  'Reservation.totalAmount:totalAmountSatang',
  'Reservation.depositAmount:depositAmountSatang',
  'RoomDateInventory.rate:rateSatang',
  'Folio.subtotal:subtotalSatang',
  'Folio.tax:taxSatang',
  'Folio.total:totalSatang',
  'Folio.paid:paidSatang',
  'Folio.balance:balanceSatang',
  'Charge.amount:amountSatang',
  'Charge.total:totalSatang',
  'Payment.amount:amountSatang',
  'BookingEmailEvent.amount:amountSatang',
  'HotelOpsTask.rateAmount:rateAmountSatang',
  'RateRule.adjustment:adjustmentSatang',
  'RateCalendar.rate:rateSatang',
]

const configuredPairs = MONEY_RECONCILIATION_MODELS.flatMap((config) => config.pairs.map(
  (fieldPair) => `${config.name}.${fieldPair.legacyField}:${fieldPair.shadowField}`,
))
assert.deepEqual(configuredPairs, requiredPairs, 'the audit covers every real legacy/satang money pair')

const paymentConfig = MONEY_RECONCILIATION_MODELS.find((config) => config.name === 'Payment')
assert.deepEqual(reconcileMoneyRows([
  { amount: 0, amountSatang: 0n },
  { amount: -1.005, amountSatang: -101n },
  { amount: 2, amountSatang: null },
  { amount: 3.01, amountSatang: 302n },
], paymentConfig), { checked: 4, null: 1, mismatch: 1 }, 'zero, negative, null, and mismatched values are classified exactly')

const propertyConfig = MONEY_RECONCILIATION_MODELS.find((config) => config.name === 'Property')
assert.deepEqual(reconcileMoneyRows([{
  extraGuestFee: 0,
  extraGuestFeeSatang: 0n,
  childFee: 1,
  childFeeSatang: null,
  inventoryMinimumRate: null,
  inventoryMinimumRateSatang: null,
}], propertyConfig), { checked: 1, null: 1, mismatch: 0 }, 'one database row is counted once even when several fields are inspected')

const rateRuleConfig = MONEY_RECONCILIATION_MODELS.find((config) => config.name === 'RateRule')
assert.deepEqual(reconcileMoneyRows([
  { adjustmentType: 'PERCENTAGE', adjustment: -10, adjustmentSatang: null },
  { adjustmentType: 'FIXED_AMOUNT', adjustment: -10, adjustmentSatang: -1000n },
], rateRuleConfig), { checked: 1, null: 0, mismatch: 0 }, 'percentage rules use basis points while fixed negative adjustments use satang')

assert.throws(
  () => assertSafeReadOnlyDatabase('postgresql://audit_user@prod.example.test/live?schema=public'),
  (error) => error instanceof MoneyReconciliationError && error.code === 'UNSAFE_DATABASE_TARGET',
  'production-like targets are refused without making a connection',
)
assert.throws(
  () => assertSafeReadOnlyDatabase('postgresql://audit_user@db.example.test/hotel?schema=public'),
  (error) => error instanceof MoneyReconciliationError && error.code === 'UNSAFE_DATABASE_TARGET',
  'unclassified nonlocal targets are refused without making a connection',
)
assert.equal(
  assertSafeReadOnlyDatabase(
    'postgresql://readonly_user@staging-db.example.test/sandbox_stage?schema=public',
    'approved-staging',
  ),
  'postgresql://readonly_user@staging-db.example.test/sandbox_stage?schema=public',
  'the bounded approved-staging override allows a clearly marked staging target',
)
assert.equal(
  assertSafeReadOnlyDatabase('postgresql://local_user@127.0.0.1:55432/sandbox_hotel_dev?schema=public'),
  'postgresql://local_user@127.0.0.1:55432/sandbox_hotel_dev?schema=public',
  'a non-production local database is allowed by default',
)
assert.deepEqual(parseReconciliationArgs(['--database-role=approved-staging']), { databaseRole: 'approved-staging' })
assert.throws(() => parseReconciliationArgs(['--confirm']), /Unsupported money reconciliation option/)

const rowsByDelegate = Object.fromEntries(MONEY_RECONCILIATION_MODELS.map((config) => [config.delegate, []]))
rowsByDelegate.payment = [
  { id: 'payment-a', amount: 0, amountSatang: 0n },
  { id: 'payment-b', amount: -2, amountSatang: -200n },
  { id: 'payment-c', amount: 4, amountSatang: null },
]

const readCalls = []
const prismaFixture = Object.fromEntries(Object.entries(rowsByDelegate).map(([delegate, rows]) => [delegate, {
  findMany: async (query) => {
    readCalls.push({ delegate, method: 'findMany', query })
    return rows
  },
}]))
const report = await reconcileMoney(prismaFixture, { pageSize: 100 })
assert.equal(report.checkedRows, 3)
assert.equal(report.nullShadowRows, 1)
assert.equal(report.mismatchRows, 0)
assert.deepEqual(report.tables.Payment, { checked: 3, null: 1, mismatch: 0 })
assert.ok(readCalls.every((call) => call.method === 'findMany'), 'the injected client is used only through findMany')
assert.ok(readCalls.every((call) => Object.keys(call.query.select).every((field) => field === 'id' || requiredPairs.some((item) => item.includes(`.${field}:`) || item.endsWith(`:${field}`)) || field === 'adjustmentType')), 'queries select only pagination and money reconciliation fields')

const source = readFileSync(new URL('./reconcile-money.mjs', import.meta.url), 'utf8')
const forbiddenWriteMethod = /\.\s*(?:create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/
const forbiddenWriteQuery = /\$(?:executeRaw|executeRawUnsafe)|\b(?:INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE)\b/i
assert.equal(forbiddenWriteMethod.test(source), false, 'the command source has no Prisma write methods')
assert.equal(forbiddenWriteQuery.test(source), false, 'the command source has no mutating raw-query path')
assert.match(source, /\.findMany\(/, 'the command source uses an explicit Prisma read method')

const failure = reconciliationFailureReport(new MoneyReconciliationError('UNSAFE_DATABASE_TARGET', 'redacted'))
assert.deepEqual(failure, {
  checkedRows: 0,
  nullShadowRows: 0,
  mismatchRows: 0,
  tables: {},
  errorCode: 'UNSAFE_DATABASE_TARGET',
})
assert.equal(JSON.stringify(failure).includes('postgresql://'), false, 'failure output never contains a database URL')

console.log('Read-only money reconciliation tests passed.')
