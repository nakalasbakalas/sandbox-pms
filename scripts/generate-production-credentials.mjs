/* global console, process */
import { randomBytes } from 'node:crypto'
import { mkdir, stat, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { createPasswordHash } from '../server/security.mjs'

function getArg(name) {
  const index = process.argv.indexOf(name)
  if (index === -1) return ''
  return process.argv[index + 1] || ''
}

function hasFlag(name) {
  return process.argv.includes(name)
}

function randomSecret(bytes = 48) {
  return randomBytes(bytes).toString('base64url')
}

async function exists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

const outPath = resolve(process.cwd(), getArg('--out') || 'ops/production-credentials.local')
const adminEmail = getArg('--admin-email').trim()
const appUrl = getArg('--app-url').trim() || 'https://sandbox-hotel-pms.onrender.com'
const allowedOrigins = getArg('--allowed-origins').trim() || appUrl
const force = hasFlag('--force')
const withTempAdmin = hasFlag('--with-temp-admin')

if ((await exists(outPath)) && !force) {
  console.error(`Refusing to overwrite existing credential file: ${outPath}`)
  console.error('Pass --force to rotate and replace it.')
  process.exit(1)
}

const sessionSecret = randomSecret(48)
const temporaryPassword = withTempAdmin ? randomSecret(24) : ''
const passwordHash = temporaryPassword ? createPasswordHash(temporaryPassword) : ''
const generatedAt = new Date().toISOString()

const lines = [
  '# Production credential bundle for Hotel PMS.',
  '# This file is intentionally ignored by git via the *.local rule.',
  '# Do not commit these values or paste them into issues, PRs, or chat logs.',
  `# Generated at: ${generatedAt}`,
  '',
  'NODE_ENV=production',
  'VITE_PMS_API_MODE=server',
  `APP_URL=${appUrl}`,
  `ALLOWED_ORIGINS=${allowedOrigins}`,
  'SEED_MODE=prod-safe',
  'ALLOW_DB_E2E=false',
  'ALLOW_PROD_ROOM_ONBOARDING=false',
  '',
  '# Render should inject DATABASE_URL from the managed PostgreSQL binding.',
  'DATABASE_URL=',
  'E2E_DATABASE_URL=',
  '',
  '# Render Blueprint can generate SESSION_SECRET automatically with generateValue.',
  '# Use this value only for a platform that cannot generate a secret for you.',
  `SESSION_SECRET=${sessionSecret}`,
  '',
  '# Preferred real user setup: set approved users in Render with passwordHash values.',
  '# Example shape: [{"email":"owner@example.com","firstName":"Owner","lastName":"Admin","role":"ADMIN","passwordHash":"..."}]',
  'SEED_USERS_JSON=',
  '',
  withTempAdmin
    ? '# Legacy temporary admin bootstrap generated because --with-temp-admin was passed.'
    : '# Legacy temporary admin bootstrap disabled by default.',
  `SEED_ADMIN_EMAIL=${withTempAdmin ? adminEmail : ''}`,
  `SEED_ADMIN_TEMP_PASSWORD=${temporaryPassword}`,
  `SEED_ADMIN_PASSWORD_HASH=${passwordHash}`,
  'SEED_ADMIN_PASSWORD=',
  'SEED_USER_PASSWORD_HASH=',
  '',
  '# Fill these only after the live LINE Official Account channel exists.',
  'LINE_CHANNEL_SECRET=',
  'LINE_CHANNEL_ACCESS_TOKEN=',
  '',
]

await mkdir(dirname(outPath), { recursive: true })
await writeFile(outPath, lines.join('\n'), 'utf8')

console.log(`Wrote production credential bundle: ${outPath}`)
if (withTempAdmin && !adminEmail) {
  console.log('SEED_ADMIN_EMAIL is blank; set the approved production admin email before using the bootstrap hash.')
} else if (!withTempAdmin) {
  console.log('No temporary admin password was generated. Set SEED_USERS_JSON with approved hash-only users.')
}
