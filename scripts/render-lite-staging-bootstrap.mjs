/* global console, process */
import { spawnSync } from 'node:child_process'
import { URL } from 'node:url'
import { createPrismaClient } from '../server/prisma-client.mjs'

const EXPECTED_DATABASE_NAME = 'sandbox_pms_lite_staging'
const VALID_ROLES = new Set(['ADMIN', 'MANAGER', 'FRONT_DESK', 'HOUSEKEEPING', 'CASHIER', 'CAFE_STAFF'])
const FORBIDDEN_SEED_KEYS = [
  'SEED_ADMIN_EMAIL',
  'SEED_ADMIN_PASSWORD_HASH',
  'SEED_USER_PASSWORD_HASH',
  'SEED_ADMIN_PASSWORD',
  'SEED_MANAGER_PASSWORD',
  'SEED_FRONT_DESK_PASSWORD',
  'SEED_HOUSEKEEPING_PASSWORD',
  'SEED_CASHIER_PASSWORD',
  'SEED_CAFE_STAFF_PASSWORD',
]

function fail(message) {
  throw new Error(`Lite staging bootstrap refused: ${message}`)
}

function assertStagingBoundary() {
  if (process.env.PMS_DEPLOYMENT_TIER !== 'staging') {
    fail('PMS_DEPLOYMENT_TIER must be staging.')
  }
  if (process.env.PMS_UI_VARIANT !== 'lite') {
    fail('PMS_UI_VARIANT must be lite.')
  }
  if (process.env.SEED_MODE !== 'prod-safe') {
    fail('SEED_MODE must be prod-safe.')
  }

  let databaseUrl
  try {
    databaseUrl = new URL(String(process.env.DATABASE_URL || ''))
  } catch {
    fail('DATABASE_URL is missing or invalid.')
  }

  if (!['postgres:', 'postgresql:'].includes(databaseUrl.protocol)) {
    fail('DATABASE_URL must use PostgreSQL.')
  }
  const databaseName = decodeURIComponent(databaseUrl.pathname.replace(/^\/+/, ''))
  if (databaseName !== EXPECTED_DATABASE_NAME) {
    fail(`database name must be ${EXPECTED_DATABASE_NAME}; received a different target.`)
  }

  for (const key of FORBIDDEN_SEED_KEYS) {
    if (String(process.env[key] || '').trim()) {
      fail(`${key} is not allowed in this staging bootstrap; use hash-only SEED_USERS_JSON.`)
    }
  }
}

function isSupportedPasswordHash(value) {
  const [algorithm, iterationsText, salt, hash, ...extra] = String(value || '').split('$')
  const iterations = Number(iterationsText)
  return extra.length === 0
    && algorithm === 'pbkdf2_sha256'
    && Number.isInteger(iterations)
    && iterations >= 100_000
    && Boolean(salt)
    && /^[0-9a-f]+$/i.test(hash || '')
}

function isValidLogin(user) {
  const username = String(user.username || user.email || '').trim().toLowerCase()
  if (!username) return false
  if (username.includes('@')) return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(username)
  return /^[a-z0-9][a-z0-9._-]{1,62}$/.test(username)
}

function assertHashOnlyAdminSeed() {
  let users
  try {
    users = JSON.parse(String(process.env.SEED_USERS_JSON || ''))
  } catch {
    fail('SEED_USERS_JSON must be a valid JSON array supplied as a Render secret.')
  }

  if (!Array.isArray(users) || users.length === 0) {
    fail('SEED_USERS_JSON must contain at least one hash-only ADMIN user.')
  }

  let hasAdmin = false
  const logins = new Set()
  const emails = new Set()
  for (const [index, user] of users.entries()) {
    if (!user || typeof user !== 'object' || Array.isArray(user)) {
      fail(`SEED_USERS_JSON[${index}] must be an object.`)
    }
    if (Object.hasOwn(user, 'password')) {
      fail(`SEED_USERS_JSON[${index}] cannot contain a plaintext password field.`)
    }
    if (!isSupportedPasswordHash(user.passwordHash)) {
      fail(`SEED_USERS_JSON[${index}] requires a supported passwordHash.`)
    }
    if (!String(user.firstName || '').trim() || !String(user.lastName || '').trim()) {
      fail(`SEED_USERS_JSON[${index}] requires firstName and lastName.`)
    }
    const email = String(user.email || '').trim().toLowerCase()
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      fail(`SEED_USERS_JSON[${index}] contains an invalid email.`)
    }
    if (email && emails.has(email)) fail(`SEED_USERS_JSON contains a duplicate email at index ${index}.`)
    if (email) emails.add(email)
    if (!isValidLogin(user)) {
      fail(`SEED_USERS_JSON[${index}] requires a valid username or email login.`)
    }

    const login = String(user.username || user.email).trim().toLowerCase()
    if (logins.has(login)) fail(`SEED_USERS_JSON contains a duplicate login at index ${index}.`)
    logins.add(login)

    const role = String(user.role || '').trim().toUpperCase().replaceAll('-', '_')
    if (!VALID_ROLES.has(role)) fail(`SEED_USERS_JSON[${index}] contains an unsupported role.`)
    if (role === 'ADMIN') hasAdmin = true
  }

  if (!hasAdmin) fail('SEED_USERS_JSON must contain at least one ADMIN user.')
}

async function assertDatabaseEmpty() {
  const prisma = createPrismaClient()
  try {
    const [properties, users, rooms, reservations] = await prisma.$transaction([
      prisma.property.count(),
      prisma.user.count(),
      prisma.room.count(),
      prisma.reservation.count(),
    ])
    if (properties || users || rooms || reservations) {
      fail('database already contains PMS data; refusing to seed or reset it.')
    }
  } finally {
    await prisma.$disconnect()
  }
}

async function verifyBootstrap() {
  const prisma = createPrismaClient()
  try {
    const [properties, admins] = await prisma.$transaction([
      prisma.property.count(),
      prisma.user.count({ where: { role: 'ADMIN', active: true } }),
    ])
    if (properties < 1 || admins < 1) fail('seed finished without an active property and ADMIN login.')
  } finally {
    await prisma.$disconnect()
  }
}

async function main() {
  assertStagingBoundary()
  assertHashOnlyAdminSeed()
  await assertDatabaseEmpty()

  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const seed = spawnSync(npmCommand, ['run', 'db:seed'], {
    env: process.env,
    stdio: 'inherit',
  })
  if (seed.error) throw seed.error
  if (seed.status !== 0) fail(`db:seed exited with status ${seed.status}.`)

  await verifyBootstrap()
  console.log('Lite staging bootstrap completed once with a hash-only ADMIN login. Remove SEED_USERS_JSON from Render after first login is verified.')
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
