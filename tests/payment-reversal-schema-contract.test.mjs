import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const schema = readFileSync(path.join(root, 'prisma/schema.prisma'), 'utf8')
const migration = readFileSync(
  path.join(
    root,
    'prisma/migrations/20260715150000_payment_reversal_idempotency/migration.sql',
  ),
  'utf8',
)
const compactMigration = migration.replace(/\s+/g, ' ')

function modelBlock(name) {
  const match = new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`).exec(schema)
  assert.ok(match, `Prisma model ${name} is missing.`)
  return match[1]
}

test('payment reversal migration is explicitly transactional', () => {
  assert.equal((migration.match(/^BEGIN;$/gm) || []).length, 1)
  assert.equal((migration.match(/^COMMIT;$/gm) || []).length, 1)
  assert.ok(migration.indexOf('BEGIN;') < migration.indexOf('CREATE TYPE "PaymentEntryKind"'))
  assert.equal(migration.trim().endsWith('COMMIT;'), true)
})

test('Prisma schema exposes immutable reversal linkage and idempotency fields', () => {
  const payment = modelBlock('Payment')
  const charge = modelBlock('Charge')

  assert.match(schema, /enum PaymentEntryKind\s*{\s*PAYMENT\s*REVERSAL\s*}/s)
  assert.match(payment, /entryKind\s+PaymentEntryKind\s+@default\(PAYMENT\)/)
  assert.match(payment, /reversesPaymentId\s+String\?/)
  assert.match(
    payment,
    /reversesPayment\s+Payment\?\s+@relation\("PaymentReversals", fields: \[reversesPaymentId], references: \[id], onDelete: Restrict\)/,
  )
  assert.match(payment, /reversalEntries\s+Payment\[\]\s+@relation\("PaymentReversals"\)/)
  assert.match(payment, /reversalReason\s+String\?/)
  assert.match(payment, /clientRequestId\s+String\?\s+@unique/)
  assert.match(payment, /@@index\(\[reversesPaymentId]\)/)

  assert.match(charge, /clientRequestId\s+String\?\s+@unique/)
  assert.match(charge, /voidRequestId\s+String\?\s+@unique/)
  assert.match(charge, /voidedAt\s+DateTime\?/)
  assert.match(charge, /voidedBy\s+String\?/)
})

test('entry-kind checks preserve nullable legacy shadows and require signed reversal evidence', () => {
  assert.match(migration, /DROP CONSTRAINT "Payment_amountSatang_nonnegative_check"/)
  assert.match(migration, /ADD CONSTRAINT "Payment_entry_kind_shape_check"/)
  assert.match(
    compactMigration,
    /WHEN 'PAYMENT' THEN .*"reversesPaymentId" IS NULL .*"reversalReason" IS NULL .*"amountSatang" IS NULL .*"amountSatang" > 0 AND "amount" > 0/,
  )
  assert.match(
    compactMigration,
    /WHEN 'REVERSAL' THEN .*"reversesPaymentId" IS NOT NULL .*"amountSatang" IS NOT NULL .*"amountSatang" < 0 .*"amount" < 0 .*length\(btrim\("reversalReason"\)\) > 0/,
  )
  assert.match(migration, /ADD CONSTRAINT "Payment_amount_dual_write_parity_check"/)
  assert.match(migration, /WHEN "amountSatang" IS NULL THEN TRUE/)
  assert.match(migration, /ROUND\("amount"::numeric \* 100\)::integer = "amountSatang"/)
})

test('database keys make payment, charge, and void retries independently idempotent', () => {
  for (const index of [
    'Payment_clientRequestId_key',
    'Charge_clientRequestId_key',
    'Charge_voidRequestId_key',
  ]) {
    assert.match(migration, new RegExp(`CREATE UNIQUE INDEX "${index}"`))
  }
  assert.match(migration, /CREATE INDEX "Payment_reversesPaymentId_idx"/)
  assert.match(migration, /ADD CONSTRAINT "Payment_reversesPaymentId_fkey"/)
  assert.match(migration, /ON DELETE RESTRICT ON UPDATE CASCADE/)
  assert.match(migration, /ADD CONSTRAINT "Charge_void_metadata_shape_check"/)
  assert.match(compactMigration, /"voidRequestId" IS NULL AND "voidedAt" IS NULL AND "voidedBy" IS NULL.*OR "void" = TRUE/)
})
