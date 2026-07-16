/* global process */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import {
  MONEY_RECONCILIATION_SPECS,
  buildFieldReconciliationQuery,
  buildMoneyReconciliationReport,
  reconcileMoneySatang,
} from '../scripts/reconcile-money-satang.mjs'

function matchingRow(rowCount = 2n) {
  return {
    rowCount,
    sourceNullRows: 0n,
    validSourceRows: rowCount,
    invalidSourceRows: 0n,
    missingShadowRows: 0n,
    orphanShadowRows: 0n,
    comparedRows: rowCount,
    matchedRows: rowCount,
    mismatchRows: 0n,
    invalidSourceWithShadowRows: 0n,
  }
}

function completeResults(rowFactory = () => matchingRow()) {
  return new Map(MONEY_RECONCILIATION_SPECS.map((tableSpec) => [
    tableSpec.table,
    tableSpec.fields.map((fieldSpec, fieldIndex) => rowFactory(tableSpec, fieldSpec, fieldIndex)),
  ]))
}

test('reconciliation query uses PostgreSQL numeric rounding and aggregate counts only', () => {
  const tableSpec = MONEY_RECONCILIATION_SPECS.find((candidate) => candidate.table === 'Reservation')
  const fieldSpec = tableSpec.fields.find((candidate) => candidate.source === 'ratePerNight')
  const sql = buildFieldReconciliationQuery(tableSpec, fieldSpec)

  assert.match(sql, /ROUND\("ratePerNight"::numeric \* 100\)/)
  assert.match(sql, /FROM "Reservation"/)
  assert.doesNotMatch(sql, /SELECT\s+"id"/i)
  assert.doesNotMatch(sql, /guest|sender|recipient|subject|rawText/i)
})

test('machine-readable reconciliation report passes only complete parity', () => {
  const report = buildMoneyReconciliationReport(completeResults(), {
    checkedAt: new Date('2026-07-13T00:00:00.000Z'),
  })

  assert.equal(report.status, 'PASS')
  assert.equal(report.mode, 'READ_ONLY')
  assert.equal(report.schemaVersion, 2)
  assert.equal(report.readAuthority, 'SATANG')
  assert.equal(report.writeContract, 'DUAL_WRITE_SATANG_WITH_FLOAT_ROLLBACK')
  assert.equal(report.floatRole, 'ROLLBACK_PARITY')
  assert.equal(report.totals.tables, 9)
  assert.equal(report.totals.fields, 19)
  assert.equal(report.totals.rows, 18)
  assert.equal(report.totals.comparedValues, 38)
  assert.equal(report.totals.unexplainedDifferences, 0)
  assert.equal(report.checkedAt, '2026-07-13T00:00:00.000Z')
})

test('invalid, missing, orphaned, and mismatched shadows make reconciliation fail', () => {
  const results = completeResults((tableSpec) => matchingRow(tableSpec.table === 'Reservation' ? 4n : 2n))
  const reservationRows = results.get('Reservation')
  reservationRows[0] = {
    ...matchingRow(4n),
    validSourceRows: 2n,
    invalidSourceRows: 1n,
    missingShadowRows: 1n,
    orphanShadowRows: 1n,
    comparedRows: 1n,
    matchedRows: 0n,
    mismatchRows: 1n,
  }
  const report = buildMoneyReconciliationReport(results)
  const reservation = report.tables.find((table) => table.table === 'Reservation')

  assert.equal(report.status, 'FAIL')
  assert.equal(reservation.status, 'FAIL')
  assert.equal(reservation.fields[0].unexplainedDifferences, 4)
  assert.equal(report.totals.unexplainedDifferences, 4)
})

test('database collection starts a read-only repeatable-read transaction', async () => {
  const commands = []
  const queries = []
  let transactionOptions
  const tx = {
    async $executeRawUnsafe(command) {
      commands.push(command)
      return 0
    },
    async $queryRawUnsafe(query) {
      queries.push(query)
      return [matchingRow(1n)]
    },
  }
  const prisma = {
    async $transaction(callback, options) {
      transactionOptions = options
      return callback(tx)
    },
  }

  const report = await reconcileMoneySatang(prisma, {
    checkedAt: new Date('2026-07-13T00:00:00.000Z'),
  })

  assert.deepEqual(commands, ['SET TRANSACTION READ ONLY'])
  assert.equal(transactionOptions.isolationLevel, 'RepeatableRead')
  assert.equal(queries.length, 19)
  assert.equal(report.status, 'PASS')
})

test('CLI requires DATABASE_URL and emits only a structured error', () => {
  const currentFile = fileURLToPath(import.meta.url)
  const script = path.resolve(path.dirname(currentFile), '../scripts/reconcile-money-satang.mjs')
  const environment = { ...process.env }
  delete environment.DATABASE_URL

  const result = spawnSync(process.execPath, [script], {
    cwd: path.dirname(script),
    env: environment,
    encoding: 'utf8',
  })

  assert.equal(result.status, 2)
  assert.equal(result.stderr, '')
  assert.deepEqual(JSON.parse(result.stdout), {
    schemaVersion: 2,
    mode: 'READ_ONLY',
    status: 'ERROR',
    error: { code: 'DATABASE_URL_REQUIRED' },
  })
})
