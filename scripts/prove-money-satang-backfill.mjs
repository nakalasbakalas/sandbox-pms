/* global console, process */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'

import { createPrismaClient } from '../server/prisma-client.mjs'
import { assertSafeE2EDatabase, parseDatabaseUrl } from './db-safety.mjs'
import { loadEnvDefaults } from './env-utils.mjs'
import { reconcileMoneySatang } from './reconcile-money-satang.mjs'
import { bin, run } from './run-command.mjs'

function isolatedTarget(baseDatabaseUrl) {
  const url = parseDatabaseUrl(baseDatabaseUrl, 'E2E_DATABASE_URL')
  const schema = `money_backfill_${Date.now()}_${randomUUID().replaceAll('-', '').slice(0, 12)}`
  url.searchParams.set('schema', schema)
  return { schema, url: url.toString() }
}

async function executeSqlFile(file, databaseUrl) {
  await run(bin('npx'), [
    'prisma',
    'db',
    'execute',
    '--file',
    file,
    '--schema',
    'prisma/schema.prisma',
  ], {
    env: { DATABASE_URL: databaseUrl },
    display: `prisma db execute --file ${file} --schema prisma/schema.prisma`,
  })
}

export async function proveMoneySatangBackfill() {
  loadEnvDefaults()
  const guardedUrl = assertSafeE2EDatabase()
  const target = isolatedTarget(guardedUrl)
  const adminUrl = parseDatabaseUrl(guardedUrl, 'E2E_DATABASE_URL')
  adminUrl.searchParams.set('schema', 'public')
  const admin = createPrismaClient(adminUrl.toString())

  try {
    await admin.$executeRawUnsafe(`CREATE SCHEMA "${target.schema}"`)
    await executeSqlFile('tests/fixtures/money-satang-legacy-rows.sql', target.url)
    await executeSqlFile('prisma/migrations/20260713100000_money_satang_expand/migration.sql', target.url)
    await executeSqlFile('prisma/migrations/20260714110000_rate_calendar_satang_and_provider_text/migration.sql', target.url)
    await executeSqlFile('tests/fixtures/money-satang-backfill-assertions.sql', target.url)

    const probe = createPrismaClient(target.url)
    try {
      const report = await reconcileMoneySatang(probe)
      assert.equal(report.status, 'PASS')
      assert.equal(report.totals.tables, 9)
      assert.equal(report.totals.unexplainedDifferences, 0)
      assert.equal(report.totals.matchedValues, 19)
    } finally {
      await probe.$disconnect().catch(() => {})
    }

    console.log(JSON.stringify({
      status: 'PASS',
      proof: 'POPULATED_LEGACY_ROWS_BACKFILLED_AND_RECONCILED',
      tables: 9,
      matchedValues: 19,
      invalidLegacyValuesQuarantined: true,
      providerStorageExtensible: true,
      target: 'ISOLATED_DISPOSABLE_SCHEMA',
    }))
  } finally {
    await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${target.schema}" CASCADE`).catch(() => {})
    await admin.$disconnect().catch(() => {})
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  proveMoneySatangBackfill().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
