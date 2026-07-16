/* global console, process */
import { chmod, mkdir, writeFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createPasswordHash, verifyPassword } from '../server/security.mjs'

const DEFAULT_OUT_PATH = '.codex/lite-staging-bootstrap.local'
const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SAFE_OUTPUT_DIRECTORY = resolve(REPOSITORY_ROOT, '.codex')

function argValue(name) {
  const index = process.argv.indexOf(name)
  if (index < 0) return undefined
  return process.argv[index + 1]
}

function fail(message) {
  throw new Error(`Lite staging credential generation refused: ${message}`)
}

function requiredIdentityValue(name, value, pattern) {
  const normalized = String(value || '').trim()
  if (!normalized) fail(`${name} is required.`)
  if (!pattern.test(normalized)) fail(`${name} has an invalid format.`)
  return normalized
}

export function createLiteStagingBootstrapBundle({
  username,
  firstName,
  lastName,
  email = null,
  password = randomBytes(32).toString('base64url'),
} = {}) {
  const normalizedUsername = requiredIdentityValue(
    'username',
    username,
    /^[a-z0-9][a-z0-9._-]{1,62}$/i,
  ).toLowerCase()
  const normalizedFirstName = requiredIdentityValue('firstName', firstName, /^[^\r\n]{1,80}$/)
  const normalizedLastName = requiredIdentityValue('lastName', lastName, /^[^\r\n]{1,80}$/)
  const normalizedEmail = String(email || '').trim().toLowerCase() || null
  if (normalizedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    fail('email has an invalid format.')
  }
  if (String(password).length < 24) fail('generated password is unexpectedly short.')

  const passwordHash = createPasswordHash(String(password))
  if (!verifyPassword(String(password), passwordHash)) fail('password hash self-check failed.')

  const seedUsers = [{
    username: normalizedUsername,
    email: normalizedEmail,
    firstName: normalizedFirstName,
    lastName: normalizedLastName,
    role: 'ADMIN',
    passwordHash,
  }]

  return {
    login: normalizedUsername,
    password: String(password),
    seedUsersJson: JSON.stringify(seedUsers),
  }
}

export function serializeLiteStagingBootstrapBundle(bundle) {
  return [
    '# LOCAL SECRET. Never commit, paste into issues, or send in chat.',
    '# Use SEED_USERS_JSON only in the Render Blueprint secret field.',
    '# Use the login/password only for the first staging login, then rotate the password.',
    `LITE_STAGING_LOGIN=${bundle.login}`,
    `LITE_STAGING_TEMP_PASSWORD=${bundle.password}`,
    `SEED_USERS_JSON=${bundle.seedUsersJson}`,
    '',
  ].join('\n')
}

export function resolveLiteStagingBootstrapOutputPath(value = DEFAULT_OUT_PATH) {
  const outputPath = resolve(REPOSITORY_ROOT, String(value || DEFAULT_OUT_PATH))
  const relativeToSafeDirectory = relative(SAFE_OUTPUT_DIRECTORY, outputPath)
  if (!relativeToSafeDirectory || relativeToSafeDirectory.startsWith('..') || isAbsolute(relativeToSafeDirectory)) {
    fail('output must be a file inside the repository .codex directory, which is git-ignored.')
  }
  return outputPath
}

function usage() {
  return `Usage:
  npm.cmd run staging:credentials:lite -- --username <login> --first-name <name> --last-name <label>

Optional:
  --email <email>       Add a verified staging email. Email defaults to null.
  --out <path>          Local ignored output file. Default: ${DEFAULT_OUT_PATH}

The generated password, hash, and SEED_USERS_JSON are written only to the local
ignored file. They are never printed to stdout. Existing files are not overwritten.`
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(usage())
    return
  }

  const bundle = createLiteStagingBootstrapBundle({
    username: argValue('--username'),
    firstName: argValue('--first-name'),
    lastName: argValue('--last-name'),
    email: argValue('--email') || null,
  })
  const outPath = resolveLiteStagingBootstrapOutputPath(argValue('--out'))
  await mkdir(dirname(outPath), { recursive: true })
  await writeFile(outPath, serializeLiteStagingBootstrapBundle(bundle), {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  })
  try {
    await chmod(outPath, 0o600)
  } catch {
    // Windows may inherit the current user's ACL instead of applying POSIX mode bits.
  }

  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    ready: true,
    purpose: 'one-time Lite staging ADMIN bootstrap',
    outputPath: outPath,
    login: 'omitted',
    temporaryPassword: 'omitted',
    passwordHash: 'omitted',
    seedUsersJson: 'omitted',
    nextStep: 'Enter only SEED_USERS_JSON in the Render Blueprint secret form, verify first login, rotate the password, then remove SEED_USERS_JSON from Render.',
  }, null, 2))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
