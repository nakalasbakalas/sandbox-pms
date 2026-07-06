/* global console, process */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import net from 'node:net'
import { join, resolve } from 'node:path'
import { loadEnvDefaults } from './env-utils.mjs'
import { bin, run } from './run-command.mjs'
import { redactDatabaseUrl } from './db-safety.mjs'

const root = process.cwd()
const localEnvPath = resolve(root, '.env.local')
const nativePostgresRoot = 'C:\\Program Files\\PostgreSQL'
const nativePort = 5432
const nativeDevUrl = 'postgresql://sandbox:sandbox@localhost:5432/sandbox_hotel_dev?schema=public'
const nativeE2EUrl = 'postgresql://sandbox:sandbox@localhost:5432/sandbox_hotel_e2e?schema=public'
const dockerDevUrl = 'postgresql://sandbox:sandbox@localhost:55432/sandbox_hotel_dev?schema=public'
const dockerE2EUrl = 'postgresql://sandbox:sandbox@localhost:55432/sandbox_hotel_e2e?schema=public'

function fail(message) {
  throw new Error(message)
}

function envValue(value) {
  return JSON.stringify(String(value))
}

function patchEnvFile(filePath, updates) {
  if (!existsSync(filePath)) {
    fail('Create .env.local from .env.local.example before running npm run db:bootstrap.')
  }

  const original = readFileSync(filePath, 'utf8')
  const lines = original.split(/\r?\n/)
  const seen = new Set()

  const updatedLines = lines.map((line) => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) return line

    const separator = line.indexOf('=')
    if (separator < 1) return line

    const key = line.slice(0, separator).trim()
    if (!Object.hasOwn(updates, key)) return line

    seen.add(key)
    return `${key}=${envValue(updates[key])}`
  })

  for (const [key, value] of Object.entries(updates)) {
    if (seen.has(key)) continue
    const hasKey = lines.some((line) => line.trimStart().startsWith(`${key}=`))
    if (!hasKey) updatedLines.push(`${key}=${envValue(value)}`)
  }

  const next = `${updatedLines.join('\n').replace(/\n*$/, '')}\n`
  if (next !== original) {
    writeFileSync(filePath, next, 'utf8')
  }
}

async function portIsOpen(port, host = '127.0.0.1', timeoutMs = 400) {
  return await new Promise((resolvePort) => {
    const socket = net.createConnection({ host, port })
    let settled = false

    const finish = (value) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolvePort(value)
    }

    socket.setTimeout(timeoutMs)
    socket.on('connect', () => finish(true))
    socket.on('timeout', () => finish(false))
    socket.on('error', () => finish(false))
  })
}

function findNativePostgresBin() {
  if (!existsSync(nativePostgresRoot)) return null

  const versions = readdirSync(nativePostgresRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => Number.parseFloat(right) - Number.parseFloat(left))

  for (const version of versions) {
    const binDir = join(nativePostgresRoot, version, 'bin')
    if (
      existsSync(join(binDir, 'psql.exe')) &&
      existsSync(join(binDir, 'createdb.exe'))
    ) {
      return binDir
    }
  }

  return null
}

function commandAvailable(command, args) {
  try {
    execFileSync(command, args, {
      stdio: ['ignore', 'ignore', 'ignore'],
      env: process.env,
    })
    return true
  } catch {
    return false
  }
}

function psqlArgs(extraArgs = []) {
  return [
    '-h',
    'localhost',
    '-p',
    String(nativePort),
    '-U',
    'postgres',
    '-d',
    'postgres',
    ...extraArgs,
  ]
}

function readPsqlValue(psqlPath, sql) {
  return execFileSync(psqlPath, psqlArgs(['-tAc', sql]), {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  }).trim()
}

function runNativeCommand(command, args) {
  console.log(`\n> ${command} ${args.join(' ')}`)
  execFileSync(command, args, {
    stdio: 'inherit',
    env: process.env,
  })
}

function ensureNativeRole(psqlPath) {
  runNativeCommand(
    psqlPath,
    psqlArgs([
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      "DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sandbox') THEN ALTER ROLE sandbox LOGIN PASSWORD 'sandbox'; ELSE CREATE ROLE sandbox LOGIN PASSWORD 'sandbox'; END IF; END $$;",
    ]),
  )
}

function ensureNativeDatabase(psqlPath, createdbPath, databaseName) {
  const exists = readPsqlValue(
    psqlPath,
    `SELECT 1 FROM pg_database WHERE datname = '${databaseName}';`,
  ) === '1'

  if (!exists) {
    runNativeCommand(createdbPath, [
      '-h',
      'localhost',
      '-p',
      String(nativePort),
      '-U',
      'postgres',
      '-O',
      'sandbox',
      databaseName,
    ])
  }

  runNativeCommand(
    psqlPath,
    psqlArgs([
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      `ALTER DATABASE "${databaseName}" OWNER TO sandbox;`,
    ]),
  )
}

function hasLocalAdminSeed() {
  const email = String(process.env.SEED_ADMIN_EMAIL || '').trim()
  const hasCredential = Boolean(
    String(process.env.SEED_ADMIN_PASSWORD_HASH || '').trim() ||
    String(process.env.SEED_USER_PASSWORD_HASH || '').trim() ||
    String(process.env.SEED_ADMIN_PASSWORD || '').trim(),
  )
  return Boolean(email && hasCredential)
}

function ensureSessionSecret() {
  const current = String(process.env.SESSION_SECRET || '').trim()
  if (current && !/replace-with|change-me|placeholder/i.test(current)) return

  const generated = randomBytes(48).toString('base64url')
  patchEnvFile(localEnvPath, {
    SESSION_SECRET: generated,
  })
  process.env.SESSION_SECRET = generated
  console.log('Generated a local SESSION_SECRET in .env.local.')
}

async function main() {
  loadEnvDefaults()
  ensureSessionSecret()

  if (!hasLocalAdminSeed()) {
    fail(
      'Local admin seed is missing. Set SEED_ADMIN_EMAIL plus SEED_ADMIN_PASSWORD_HASH, SEED_USER_PASSWORD_HASH, or SEED_ADMIN_PASSWORD in .env.local before running npm run db:bootstrap.',
    )
  }

  const nativeBin = findNativePostgresBin()
  const nativeReachable = nativeBin && await portIsOpen(nativePort) &&
    commandAvailable(join(nativeBin, 'psql.exe'), psqlArgs(['-tAc', 'SELECT 1;']))

  const usingNative = Boolean(nativeReachable)
  const selectedDevUrl = usingNative ? nativeDevUrl : dockerDevUrl
  const selectedE2EUrl = usingNative ? nativeE2EUrl : dockerE2EUrl
  const selectedBackend = usingNative ? 'native PostgreSQL 16 on localhost:5432' : 'Docker Compose on localhost:55432'

  if (!usingNative) {
    if (!commandAvailable('docker', ['info'])) {
      fail(
        'No usable local Postgres backend found. Start the PostgreSQL 16 service on localhost:5432 or start Docker Desktop, then rerun npm run db:bootstrap.',
      )
    }
  } else {
    const psqlPath = join(nativeBin, 'psql.exe')
    const createdbPath = join(nativeBin, 'createdb.exe')

    patchEnvFile(localEnvPath, {
      DATABASE_URL: selectedDevUrl,
      E2E_DATABASE_URL: selectedE2EUrl,
    })

    process.env.DATABASE_URL = selectedDevUrl
    process.env.E2E_DATABASE_URL = selectedE2EUrl

    console.log(`Using ${selectedBackend}.`)
    console.log(`DATABASE_URL => ${redactDatabaseUrl(selectedDevUrl)}`)
    console.log(`E2E_DATABASE_URL => ${redactDatabaseUrl(selectedE2EUrl)}`)

    ensureNativeRole(psqlPath)
    ensureNativeDatabase(psqlPath, createdbPath, 'sandbox_hotel_dev')
    ensureNativeDatabase(psqlPath, createdbPath, 'sandbox_hotel_e2e')
  }

  if (!usingNative) {
    patchEnvFile(localEnvPath, {
      DATABASE_URL: selectedDevUrl,
      E2E_DATABASE_URL: selectedE2EUrl,
    })

    process.env.DATABASE_URL = selectedDevUrl
    process.env.E2E_DATABASE_URL = selectedE2EUrl

    console.log(`Using ${selectedBackend}.`)
    console.log(`DATABASE_URL => ${redactDatabaseUrl(selectedDevUrl)}`)
    console.log(`E2E_DATABASE_URL => ${redactDatabaseUrl(selectedE2EUrl)}`)

    await run(bin('npm'), ['run', 'db:up'])
  }

  await run(bin('npm'), ['run', 'db:ready'])
  await run(bin('npm'), ['run', 'db:e2e:ready'], {
    env: { ALLOW_DB_E2E: 'true' },
  })
  await run(bin('npm'), ['run', 'db:doctor'], {
    env: { ALLOW_DB_E2E: 'true' },
  })

  console.log('\nLocal bootstrap complete.')
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
