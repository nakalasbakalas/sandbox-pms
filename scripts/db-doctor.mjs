/* global console, process */
import { assertSafeE2EDatabase, redactDatabaseUrl, summarizeDatabaseUrl } from './db-safety.mjs'
import { loadEnvDefaults } from './env-utils.mjs'
import { bin, run } from './run-command.mjs'

loadEnvDefaults()

const fallbackValidateUrl = 'postgresql://sandbox:sandbox@localhost:55432/sandbox_hotel_dev?schema=public'
const checks = []

function printUrlSummary(label, value) {
  console.log(`\n${label}: ${value ? 'configured' : 'missing'}`)
  if (!value) return

  try {
    const summary = summarizeDatabaseUrl(value, label)
    console.log(`  url: ${summary.redacted}`)
    console.log(`  host: ${summary.host}`)
    console.log(`  port: ${summary.port}`)
    console.log(`  database: ${summary.database}`)
    console.log(`  schema: ${summary.schema}`)
    console.log(`  user: ${summary.user}`)
  } catch (error) {
    console.log(`  invalid: ${error instanceof Error ? error.message : String(error)}`)
    checks.push({ label, ok: false })
  }
}

async function testConnection(label, value) {
  if (!value) {
    console.log(`\n${label} connectivity: skipped because ${label} is missing.`)
    return
  }

  let prisma
  try {
    const { PrismaClient } = await import('@prisma/client')
    prisma = new PrismaClient({
      datasources: {
        db: {
          url: value,
        },
      },
    })
    await prisma.$queryRaw`SELECT 1`
    console.log(`\n${label} connectivity: ok`)
    checks.push({ label: `${label} connectivity`, ok: true })
  } catch (error) {
    console.log(`\n${label} connectivity: failed`)
    console.log(`  ${error instanceof Error ? error.message : String(error)}`)
    console.log('  Likely fixes:')
    console.log('  - Start Docker Desktop, then run npm run db:up.')
    console.log('  - Confirm the URL uses host port 55432 for local Docker Postgres.')
    console.log('  - Confirm the database name, user, and password match the compose file.')
    console.log('  - If an old Docker volume has different credentials, run npm run db:down, then remove the sandbox_hotel_postgres_data volume intentionally.')
    console.log('  - For hosted staging, confirm firewall/IP allowlisting and SSL requirements.')
    checks.push({ label: `${label} connectivity`, ok: false })
  } finally {
    await prisma?.$disconnect?.()
  }
}

async function runPrismaValidate() {
  const validateUrl = process.env.DATABASE_URL || process.env.E2E_DATABASE_URL || fallbackValidateUrl
  const result = await run(bin('npx'), ['prisma', 'validate'], {
    allowFailure: true,
    stdio: 'pipe',
    env: {
      DATABASE_URL: validateUrl,
    },
  })

  console.log('\nPrisma validate:')
  if (result.code === 0) {
    console.log('  ok')
    checks.push({ label: 'Prisma validate', ok: true })
  } else {
    console.log('  failed')
    console.log(`  ${(result.stderr || result.stdout).trim()}`)
    checks.push({ label: 'Prisma validate', ok: false })
  }
}

async function runMigrateStatus(label, value) {
  if (!value) {
    console.log(`\n${label} migrate status: skipped because ${label} is missing.`)
    return
  }

  const result = await run(bin('npx'), ['prisma', 'migrate', 'status'], {
    allowFailure: true,
    stdio: 'pipe',
    env: {
      DATABASE_URL: value,
    },
  })

  console.log(`\n${label} migrate status:`)
  if (result.code === 0) {
    console.log('  ok')
    checks.push({ label: `${label} migrate status`, ok: true })
  } else {
    console.log('  unavailable or not clean')
    console.log(`  ${(result.stderr || result.stdout).trim() || 'No additional output from Prisma.'}`)
    checks.push({ label: `${label} migrate status`, ok: false })
  }
}

console.log('Hotel PMS database doctor')

printUrlSummary('DATABASE_URL', process.env.DATABASE_URL)
printUrlSummary('E2E_DATABASE_URL', process.env.E2E_DATABASE_URL)

console.log('\nDatabase-mutating E2E:')
try {
  const e2eUrl = assertSafeE2EDatabase()
  console.log(`  allowed for ${redactDatabaseUrl(e2eUrl)}`)
  checks.push({ label: 'E2E guard', ok: true })
} catch (error) {
  console.log(`  blocked: ${error instanceof Error ? error.message : String(error)}`)
}

await runPrismaValidate()
await testConnection('DATABASE_URL', process.env.DATABASE_URL)
await testConnection('E2E_DATABASE_URL', process.env.E2E_DATABASE_URL)
await runMigrateStatus('DATABASE_URL', process.env.DATABASE_URL)
await runMigrateStatus('E2E_DATABASE_URL', process.env.E2E_DATABASE_URL)

const failed = checks.filter((check) => !check.ok)
console.log('\nDoctor summary:')
if (failed.length === 0) {
  console.log('  No failing configured checks.')
} else {
  for (const check of failed) console.log(`  failed: ${check.label}`)
  process.exitCode = 1
}
