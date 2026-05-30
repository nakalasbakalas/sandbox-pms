/* global console, process, URL */
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { loadEnvFile } from './env-utils.mjs'

async function loadOptionalEnv(path) {
  try {
    await readFile(path, 'utf8')
  } catch {
    return
  }
  loadEnvFile(path)
}

function value(key) {
  return String(process.env[key] || '').trim()
}

function isPlaceholder(raw) {
  const text = String(raw || '').toLowerCase()
  return !text ||
    text.includes('change-me') ||
    text.includes('replace-with') ||
    text.includes('user:password') ||
    text.includes('host:5432') ||
    text.includes('localhost') ||
    text.includes('127.0.0.1') ||
    text.includes('sandbox:sandbox') ||
    text.includes('sandbox_hotel_dev') ||
    text.includes('sandbox_hotel_e2e') ||
    text.includes('your-') ||
    text.includes('example')
}

function addLine(lines, label, message) {
  lines.push(`${label}: ${message}`)
}

function looksLikePasswordHash(raw) {
  const [algorithm, iterationsText, salt, hash] = String(raw || '').split('$')
  const iterations = Number(iterationsText)
  return algorithm === 'pbkdf2_sha256' &&
    Number.isInteger(iterations) &&
    iterations >= 100_000 &&
    Boolean(salt) &&
    /^[0-9a-f]+$/i.test(hash || '')
}

function validateSeedUsersJson() {
  const raw = value('SEED_USERS_JSON')
  if (!raw) return

  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    addLine(errors, 'SEED_USERS_JSON', 'must be valid JSON')
    return
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    addLine(errors, 'SEED_USERS_JSON', 'must be a non-empty JSON array when configured')
    return
  }

  const emails = new Set()
  for (const [index, user] of parsed.entries()) {
    const label = `SEED_USERS_JSON[${index}]`
    if (!user || typeof user !== 'object') {
      addLine(errors, label, 'must be an object')
      continue
    }

    const email = String(user.email || '').trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      addLine(errors, `${label}.email`, 'must be a valid email address')
    } else if (emails.has(email)) {
      addLine(errors, `${label}.email`, 'must be unique')
    } else {
      emails.add(email)
    }

    if (!String(user.firstName || '').trim()) addLine(errors, `${label}.firstName`, 'is required')
    if (!String(user.lastName || '').trim()) addLine(errors, `${label}.lastName`, 'is required')

    const role = String(user.role || '').trim().toUpperCase().replaceAll('-', '_')
    if (!['ADMIN', 'MANAGER', 'FRONT_DESK', 'HOUSEKEEPING', 'CASHIER', 'CAFE_STAFF'].includes(role)) {
      addLine(errors, `${label}.role`, 'must be a valid PMS role')
    }

    const passwordHash = String(user.passwordHash || '').trim()
    const password = String(user.password || '').trim()
    if (!passwordHash && !password) {
      addLine(errors, label, 'requires passwordHash or password')
    }
    if (passwordHash && !looksLikePasswordHash(passwordHash)) {
      addLine(errors, `${label}.passwordHash`, 'must be a supported PBKDF2 hash')
    }
    if (password) {
      addLine(warnings, `${label}.password`, 'plaintext seed passwords should be temporary; prefer passwordHash')
    }
  }
}

function parseOrigin(raw, label) {
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      addLine(errors, label, 'must be an http(s) URL')
      return null
    }
    if (url.protocol !== 'https:') {
      addLine(errors, label, 'must use https in production')
      return null
    }
    return url.origin
  } catch {
    addLine(errors, label, 'must be a valid URL')
    return null
  }
}

await loadOptionalEnv(resolve(process.cwd(), 'ops/production-credentials.local'))
await loadOptionalEnv(resolve(process.cwd(), '.env.production.local'))
await loadOptionalEnv(resolve(process.cwd(), '.env.local'))
await loadOptionalEnv(resolve(process.cwd(), '.env'))

const errors = []
const warnings = []

if (value('NODE_ENV') !== 'production') {
  addLine(errors, 'NODE_ENV', 'must be production')
}

if (value('VITE_PMS_API_MODE') !== 'server') {
  addLine(errors, 'VITE_PMS_API_MODE', 'must be server for deployed backend sessions')
}

let appOrigin = null
if (isPlaceholder(value('APP_URL'))) {
  addLine(errors, 'APP_URL', 'must be the public production app URL')
} else {
  appOrigin = parseOrigin(value('APP_URL'), 'APP_URL')
}

const allowedOriginValues = value('ALLOWED_ORIGINS')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

const allowedOrigins = new Set()
if (isPlaceholder(value('ALLOWED_ORIGINS')) || allowedOriginValues.length === 0) {
  addLine(errors, 'ALLOWED_ORIGINS', 'must include the public production app origin')
}

for (const [index, origin] of allowedOriginValues.entries()) {
  if (origin === '*') {
    addLine(errors, 'ALLOWED_ORIGINS', 'must not contain wildcard origins in production')
    continue
  }
  const parsed = parseOrigin(origin, `ALLOWED_ORIGINS[${index}]`)
  if (parsed) allowedOrigins.add(parsed)
}

if (appOrigin && allowedOrigins.size > 0 && !allowedOrigins.has(appOrigin)) {
  addLine(errors, 'ALLOWED_ORIGINS', 'must include APP_URL origin')
}

if (value('SEED_MODE') !== 'prod-safe') {
  addLine(errors, 'SEED_MODE', 'must be prod-safe')
}

if (isPlaceholder(value('DATABASE_URL'))) {
  addLine(errors, 'DATABASE_URL', 'must be a real production PostgreSQL URL or a Render database binding')
}

if (isPlaceholder(value('SESSION_SECRET')) || value('SESSION_SECRET').length < 32) {
  addLine(errors, 'SESSION_SECRET', 'must be a generated secret of at least 32 characters')
}

if (value('ALLOW_DB_E2E') === 'true') {
  addLine(errors, 'ALLOW_DB_E2E', 'must not be true in production')
}

if (value('E2E_DATABASE_URL') && value('E2E_DATABASE_URL') === value('DATABASE_URL')) {
  addLine(errors, 'E2E_DATABASE_URL', 'must not match DATABASE_URL')
}

validateSeedUsersJson()

const seedPasswordPresent = Boolean(
  value('SEED_ADMIN_PASSWORD_HASH') ||
  value('SEED_USER_PASSWORD_HASH') ||
  value('SEED_ADMIN_PASSWORD'),
)

if (seedPasswordPresent && !value('SEED_ADMIN_EMAIL')) {
  addLine(errors, 'SEED_ADMIN_EMAIL', 'is required when a bootstrap admin password/hash is configured')
}

if (value('SEED_ADMIN_EMAIL') && !seedPasswordPresent) {
  addLine(errors, 'SEED_ADMIN_PASSWORD_HASH', 'or SEED_USER_PASSWORD_HASH is required with SEED_ADMIN_EMAIL')
}

if (value('SEED_ADMIN_PASSWORD')) {
  addLine(warnings, 'SEED_ADMIN_PASSWORD', 'plaintext bootstrap passwords should be temporary; prefer SEED_ADMIN_PASSWORD_HASH')
}

const lineSecret = value('LINE_CHANNEL_SECRET')
const lineToken = value('LINE_CHANNEL_ACCESS_TOKEN')
if (Boolean(lineSecret) !== Boolean(lineToken)) {
  addLine(errors, 'LINE credentials', 'LINE_CHANNEL_SECRET and LINE_CHANNEL_ACCESS_TOKEN must be configured together')
} else if (!lineSecret && !lineToken) {
  addLine(warnings, 'LINE credentials', 'not configured; live LINE messaging remains disabled')
}

if (value('ALLOW_PROD_ROOM_ONBOARDING') === 'true') {
  addLine(warnings, 'ALLOW_PROD_ROOM_ONBOARDING', 'leave false except during the explicit production room import command')
}

if (warnings.length > 0) {
  console.log('Production preflight warnings:')
  for (const warning of warnings) console.log(`- ${warning}`)
}

if (errors.length > 0) {
  console.error('Production preflight failed:')
  for (const error of errors) console.error(`- ${error}`)
  process.exit(1)
}

console.log('Production preflight passed.')
