/* global console, process */
import { fileURLToPath } from 'node:url'
import { assertSafeE2EDatabase, redactDatabaseUrl } from './db-safety.mjs'
import { loadEnvDefaults } from './env-utils.mjs'
import { bin, run } from './run-command.mjs'

export async function prepareE2EDatabase() {
  loadEnvDefaults()

  const e2eDatabaseUrl = assertSafeE2EDatabase()
  console.log(`Preparing guarded E2E database: ${redactDatabaseUrl(e2eDatabaseUrl)}`)

  const e2eEnv = {
    ...process.env,
    ALLOW_DB_E2E: 'true',
    DATABASE_URL: e2eDatabaseUrl,
    E2E_DATABASE_URL: e2eDatabaseUrl,
    SEED_MODE: 'e2e',
  }

  await run(bin('npx'), ['prisma', 'generate'], {
    env: e2eEnv,
  })
  await run(bin('npx'), ['prisma', 'migrate', 'deploy'], {
    env: e2eEnv,
  })
  await run(bin('npm'), ['run', 'db:seed'], {
    env: e2eEnv,
  })

  process.env.DATABASE_URL = e2eDatabaseUrl
  process.env.SEED_MODE = 'e2e'
  console.log('E2E database is migrated and seeded.')
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  prepareE2EDatabase().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
