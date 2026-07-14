/* global process */
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import { createPrismaClient } from '../server/prisma-client.mjs'
import {
  MONEY_SATANG_MAX,
  MONEY_SATANG_MIN,
  TAX_RATE_BPS_MAX,
  TAX_RATE_BPS_MIN,
} from '../server/money-satang.mjs'

const rawSpecs = [
  {
    table: 'Property',
    fields: [
      { source: 'taxRate', shadow: 'taxRateBps', scale: 100, minimum: TAX_RATE_BPS_MIN, maximum: TAX_RATE_BPS_MAX },
      { source: 'extraGuestFee', shadow: 'extraGuestFeeSatang', scale: 100, minimum: 0, maximum: MONEY_SATANG_MAX },
      { source: 'childFee', shadow: 'childFeeSatang', scale: 100, minimum: 0, maximum: MONEY_SATANG_MAX },
      { source: 'inventoryMinimumRate', shadow: 'inventoryMinimumRateSatang', scale: 100, minimum: 0, maximum: MONEY_SATANG_MAX },
    ],
  },
  {
    table: 'RoomType',
    fields: [
      { source: 'baseRate', shadow: 'baseRateSatang', scale: 100, minimum: 0, maximum: MONEY_SATANG_MAX },
    ],
  },
  {
    table: 'Reservation',
    fields: [
      { source: 'ratePerNight', shadow: 'ratePerNightSatang', scale: 100, minimum: 0, maximum: MONEY_SATANG_MAX },
      { source: 'totalAmount', shadow: 'totalAmountSatang', scale: 100, minimum: 0, maximum: MONEY_SATANG_MAX },
      { source: 'depositAmount', shadow: 'depositAmountSatang', scale: 100, minimum: 0, maximum: MONEY_SATANG_MAX },
    ],
  },
  {
    table: 'RoomDateInventory',
    fields: [
      { source: 'rate', shadow: 'rateSatang', scale: 100, minimum: 0, maximum: MONEY_SATANG_MAX },
    ],
  },
  {
    table: 'RateCalendar',
    fields: [
      { source: 'rate', shadow: 'rateSatang', scale: 100, minimum: 0, maximum: MONEY_SATANG_MAX },
    ],
  },
  {
    table: 'Folio',
    fields: [
      { source: 'subtotal', shadow: 'subtotalSatang', scale: 100, minimum: 0, maximum: MONEY_SATANG_MAX },
      { source: 'tax', shadow: 'taxSatang', scale: 100, minimum: 0, maximum: MONEY_SATANG_MAX },
      { source: 'total', shadow: 'totalSatang', scale: 100, minimum: 0, maximum: MONEY_SATANG_MAX },
      { source: 'paid', shadow: 'paidSatang', scale: 100, minimum: 0, maximum: MONEY_SATANG_MAX },
      { source: 'balance', shadow: 'balanceSatang', scale: 100, minimum: MONEY_SATANG_MIN, maximum: MONEY_SATANG_MAX },
    ],
  },
  {
    table: 'Charge',
    fields: [
      { source: 'amount', shadow: 'amountSatang', scale: 100, minimum: 0, maximum: MONEY_SATANG_MAX },
      { source: 'total', shadow: 'totalSatang', scale: 100, minimum: 0, maximum: MONEY_SATANG_MAX },
    ],
  },
  {
    table: 'Payment',
    fields: [
      { source: 'amount', shadow: 'amountSatang', scale: 100, minimum: 0, maximum: MONEY_SATANG_MAX },
    ],
  },
  {
    table: 'BookingEmailEvent',
    fields: [
      { source: 'amount', shadow: 'amountSatang', scale: 100, minimum: MONEY_SATANG_MIN, maximum: MONEY_SATANG_MAX },
    ],
  },
]

export const MONEY_RECONCILIATION_SPECS = Object.freeze(rawSpecs.map((tableSpec) => Object.freeze({
  ...tableSpec,
  fields: Object.freeze(tableSpec.fields.map((fieldSpec) => Object.freeze({ ...fieldSpec }))),
})))

function quoteIdentifier(identifier) {
  if (typeof identifier !== 'string' || !/^[A-Za-z][A-Za-z0-9]*$/.test(identifier)) {
    throw new TypeError('Money reconciliation uses an invalid schema identifier.')
  }
  return `"${identifier}"`
}

export function buildFieldReconciliationQuery(tableSpec, fieldSpec) {
  const table = quoteIdentifier(tableSpec.table)
  const source = quoteIdentifier(fieldSpec.source)
  const shadow = quoteIdentifier(fieldSpec.shadow)
  const { scale, minimum, maximum } = fieldSpec

  if (![scale, minimum, maximum].every(Number.isSafeInteger) || scale < 1 || minimum > maximum) {
    throw new TypeError('Money reconciliation uses invalid numeric bounds.')
  }

  return `
WITH evaluated AS (
  SELECT
    ${source} AS "sourceValue",
    ${shadow} AS "shadowValue",
    CASE
      WHEN ${source} IS NULL THEN NULL
      WHEN ${source}::text IN ('NaN', 'Infinity', '-Infinity') THEN NULL
      WHEN ROUND(${source}::numeric * ${scale}) BETWEEN ${minimum} AND ${maximum}
        THEN ROUND(${source}::numeric * ${scale})::integer
      ELSE NULL
    END AS "expectedValue",
    CASE
      WHEN ${source} IS NULL THEN false
      WHEN ${source}::text IN ('NaN', 'Infinity', '-Infinity') THEN true
      WHEN ROUND(${source}::numeric * ${scale}) NOT BETWEEN ${minimum} AND ${maximum} THEN true
      ELSE false
    END AS "sourceInvalid"
  FROM ${table}
)
SELECT
  COUNT(*)::bigint AS "rowCount",
  COUNT(*) FILTER (WHERE "sourceValue" IS NULL)::bigint AS "sourceNullRows",
  COUNT(*) FILTER (WHERE "sourceValue" IS NOT NULL AND NOT "sourceInvalid")::bigint AS "validSourceRows",
  COUNT(*) FILTER (WHERE "sourceInvalid")::bigint AS "invalidSourceRows",
  COUNT(*) FILTER (
    WHERE "sourceValue" IS NOT NULL AND NOT "sourceInvalid" AND "shadowValue" IS NULL
  )::bigint AS "missingShadowRows",
  COUNT(*) FILTER (
    WHERE "sourceValue" IS NULL AND "shadowValue" IS NOT NULL
  )::bigint AS "orphanShadowRows",
  COUNT(*) FILTER (
    WHERE "sourceValue" IS NOT NULL AND NOT "sourceInvalid" AND "shadowValue" IS NOT NULL
  )::bigint AS "comparedRows",
  COUNT(*) FILTER (
    WHERE "sourceValue" IS NOT NULL
      AND NOT "sourceInvalid"
      AND "shadowValue" IS NOT NULL
      AND "shadowValue" = "expectedValue"
  )::bigint AS "matchedRows",
  COUNT(*) FILTER (
    WHERE "sourceValue" IS NOT NULL
      AND NOT "sourceInvalid"
      AND "shadowValue" IS NOT NULL
      AND "shadowValue" <> "expectedValue"
  )::bigint AS "mismatchRows",
  COUNT(*) FILTER (
    WHERE "sourceInvalid" AND "shadowValue" IS NOT NULL
  )::bigint AS "invalidSourceWithShadowRows"
FROM evaluated
`.trim()
}

function safeCount(value, label) {
  const count = typeof value === 'bigint' ? value : BigInt(value)
  if (count < 0n || count > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError(`${label} is outside the machine-readable safe count range.`)
  }
  return Number(count)
}

function normalizeFieldResult(fieldSpec, row) {
  const counts = {
    rowCount: safeCount(row.rowCount, 'Row count'),
    sourceNullRows: safeCount(row.sourceNullRows, 'Source-null count'),
    validSourceRows: safeCount(row.validSourceRows, 'Valid-source count'),
    invalidSourceRows: safeCount(row.invalidSourceRows, 'Invalid-source count'),
    missingShadowRows: safeCount(row.missingShadowRows, 'Missing-shadow count'),
    orphanShadowRows: safeCount(row.orphanShadowRows, 'Orphan-shadow count'),
    comparedRows: safeCount(row.comparedRows, 'Compared-row count'),
    matchedRows: safeCount(row.matchedRows, 'Matched-row count'),
    mismatchRows: safeCount(row.mismatchRows, 'Mismatch-row count'),
    invalidSourceWithShadowRows: safeCount(row.invalidSourceWithShadowRows, 'Invalid-source shadow count'),
  }
  const unexplainedDifferences = counts.invalidSourceRows
    + counts.missingShadowRows
    + counts.orphanShadowRows
    + counts.mismatchRows

  return {
    sourceField: fieldSpec.source,
    shadowField: fieldSpec.shadow,
    scale: fieldSpec.scale,
    allowedScaledRange: { minimum: fieldSpec.minimum, maximum: fieldSpec.maximum },
    ...counts,
    unexplainedDifferences,
    status: unexplainedDifferences === 0 ? 'PASS' : 'FAIL',
  }
}

export function buildMoneyReconciliationReport(tableResults, {
  checkedAt = new Date(),
} = {}) {
  const checkedAtDate = checkedAt instanceof Date ? checkedAt : new Date(checkedAt)
  if (Number.isNaN(checkedAtDate.getTime())) throw new TypeError('checkedAt must be a valid date.')

  const tables = MONEY_RECONCILIATION_SPECS.map((tableSpec) => {
    const rawFields = tableResults.get(tableSpec.table)
    if (!Array.isArray(rawFields) || rawFields.length !== tableSpec.fields.length) {
      throw new Error('Money reconciliation result coverage is incomplete.')
    }
    const fields = tableSpec.fields.map((fieldSpec, index) => normalizeFieldResult(fieldSpec, rawFields[index]))
    const rowCount = fields[0]?.rowCount ?? 0
    if (fields.some((field) => field.rowCount !== rowCount)) {
      throw new Error('Money reconciliation table snapshots are inconsistent.')
    }
    const unexplainedDifferences = fields.reduce((sum, field) => sum + field.unexplainedDifferences, 0)
    return {
      table: tableSpec.table,
      rowCount,
      unexplainedDifferences,
      status: unexplainedDifferences === 0 ? 'PASS' : 'FAIL',
      fields,
    }
  })

  const totals = tables.reduce((summary, table) => {
    summary.rows += table.rowCount
    summary.fields += table.fields.length
    summary.comparedValues += table.fields.reduce((sum, field) => sum + field.comparedRows, 0)
    summary.matchedValues += table.fields.reduce((sum, field) => sum + field.matchedRows, 0)
    summary.invalidSourceValues += table.fields.reduce((sum, field) => sum + field.invalidSourceRows, 0)
    summary.missingShadowValues += table.fields.reduce((sum, field) => sum + field.missingShadowRows, 0)
    summary.orphanShadowValues += table.fields.reduce((sum, field) => sum + field.orphanShadowRows, 0)
    summary.parityMismatches += table.fields.reduce((sum, field) => sum + field.mismatchRows, 0)
    summary.unexplainedDifferences += table.unexplainedDifferences
    return summary
  }, {
    tables: tables.length,
    rows: 0,
    fields: 0,
    comparedValues: 0,
    matchedValues: 0,
    invalidSourceValues: 0,
    missingShadowValues: 0,
    orphanShadowValues: 0,
    parityMismatches: 0,
    unexplainedDifferences: 0,
  })

  return {
    schemaVersion: 2,
    checkedAt: checkedAtDate.toISOString(),
    mode: 'READ_ONLY',
    readAuthority: 'SATANG',
    writeContract: 'DUAL_WRITE_SATANG_WITH_FLOAT_ROLLBACK',
    floatRole: 'ROLLBACK_PARITY',
    satangContract: 'POSTGRESQL_INTEGER_SATANG',
    status: totals.unexplainedDifferences === 0 ? 'PASS' : 'FAIL',
    totals,
    tables,
  }
}

export async function reconcileMoneySatang(prisma, options = {}) {
  if (!prisma || typeof prisma.$transaction !== 'function') {
    throw new TypeError('A Prisma client is required for money reconciliation.')
  }

  const tableResults = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY')
    const results = new Map()
    for (const tableSpec of MONEY_RECONCILIATION_SPECS) {
      const fieldRows = []
      for (const fieldSpec of tableSpec.fields) {
        const rows = await tx.$queryRawUnsafe(buildFieldReconciliationQuery(tableSpec, fieldSpec))
        if (!Array.isArray(rows) || rows.length !== 1) {
          throw new Error('Money reconciliation query returned an unexpected result shape.')
        }
        fieldRows.push(rows[0])
      }
      results.set(tableSpec.table, fieldRows)
    }
    return results
  }, {
    isolationLevel: 'RepeatableRead',
    maxWait: 10_000,
    timeout: 60_000,
  })

  return buildMoneyReconciliationReport(tableResults, options)
}

async function main() {
  if (!process.env.DATABASE_URL?.trim()) {
    process.stdout.write(`${JSON.stringify({
      schemaVersion: 2,
      mode: 'READ_ONLY',
      status: 'ERROR',
      error: { code: 'DATABASE_URL_REQUIRED' },
    })}\n`)
    process.exitCode = 2
    return
  }

  const prisma = createPrismaClient()
  try {
    const report = await reconcileMoneySatang(prisma)
    process.stdout.write(`${JSON.stringify(report)}\n`)
    if (report.status !== 'PASS') process.exitCode = 1
  } catch {
    process.stdout.write(`${JSON.stringify({
      schemaVersion: 2,
      mode: 'READ_ONLY',
      status: 'ERROR',
      error: { code: 'RECONCILIATION_QUERY_FAILED' },
    })}\n`)
    process.exitCode = 2
  } finally {
    await prisma.$disconnect().catch(() => {})
  }
}

const isDirectRun = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))

if (isDirectRun) await main()
