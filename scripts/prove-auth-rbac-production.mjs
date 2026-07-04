/* global Buffer, URL, console, fetch, process */
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_HOST = 'https://book.sandboxhotel.com'
const DEFAULT_FIRST_CHECK = { method: 'GET', path: '/api/auth/me', expectStatus: 200 }
const SAFE_DENIAL_METHODS = new Set(['GET', 'HEAD'])
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

function hasFlag(args, name) {
  return args.includes(name)
}

function argValue(args, name) {
  const index = args.indexOf(name)
  if (index < 0) return undefined
  return args[index + 1]
}

function fail(message) {
  throw new Error(message)
}

function nullableString(value) {
  if (value === undefined || value === null) return null
  const normalized = String(value).trim()
  return normalized ? normalized : null
}

export function normalizeProofHost(value = DEFAULT_HOST) {
  const raw = nullableString(value) || DEFAULT_HOST
  let parsed
  try {
    parsed = new URL(raw)
  } catch {
    fail('A valid https proof host is required.')
  }
  if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') {
    fail('Production auth proof host must use https.')
  }
  parsed.pathname = ''
  parsed.search = ''
  parsed.hash = ''
  return parsed.toString().replace(/\/$/, '')
}

export function maskLoginIdentifier(value) {
  const normalized = nullableString(value)
  if (!normalized) return '[missing]'
  const [local, domain] = normalized.split('@')
  if (domain) {
    const first = local.slice(0, 1) || '*'
    const domainParts = domain.split('.')
    const domainHead = domainParts[0] || ''
    const domainTail = domainParts.length > 1 ? `.${domainParts.slice(1).join('.')}` : ''
    return `${first}${'*'.repeat(Math.max(3, Math.min(8, local.length - 1 || 3)))}@${domainHead.slice(0, 1)}***${domainTail}`
  }
  return `${normalized.slice(0, 1)}${'*'.repeat(Math.max(3, Math.min(8, normalized.length - 1 || 3)))}`
}

function displayInitials(value) {
  const normalized = nullableString(value)
  if (!normalized) return null
  return normalized
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .map((part) => part.slice(0, 1).toUpperCase())
    .join('')
}

export function summarizePublicUserForProof(user = {}) {
  return {
    loginIdentifierMasked: maskLoginIdentifier(user.username || user.email),
    emailPresent: Boolean(nullableString(user.email)),
    displayInitials: displayInitials(user.displayName),
    role: nullableString(user.role) ? String(user.role).toUpperCase() : null,
    active: user.active === undefined ? null : Boolean(user.active),
  }
}

function normalizePath(path) {
  const normalized = nullableString(path)
  if (!normalized || !normalized.startsWith('/')) fail('Probe path must start with /.')
  if (/^\/\//.test(normalized)) fail('Probe path must be relative to the approved host.')
  return normalized
}

function normalizeMethod(value) {
  const method = String(value || 'GET').trim().toUpperCase()
  if (!/^[A-Z]+$/.test(method)) fail(`Invalid HTTP method: ${value}`)
  return method
}

function normalizeExpectedStatuses(value, fallback) {
  const values = Array.isArray(value) ? value : [value ?? fallback]
  return values.map((item) => Number(item)).filter((item) => Number.isInteger(item) && item >= 100 && item <= 599)
}

export function validateDenialProbe(probe = {}, { allowMutating = false } = {}) {
  const method = normalizeMethod(probe.method)
  if (!SAFE_DENIAL_METHODS.has(method) && (!allowMutating || !MUTATING_METHODS.has(method))) {
    fail(`Denial probe ${method} ${probe.path || ''} is not allowed. Use GET/HEAD, or pass --allow-mutating-denial-probes with an owner-approved no-op/invalid payload.`)
  }
  const expectStatuses = normalizeExpectedStatuses(probe.expectStatus ?? probe.expectStatuses, [401, 403])
  if (expectStatuses.length === 0 || expectStatuses.some((status) => ![401, 403].includes(status))) {
    fail('Denial probes must expect only 401 or 403.')
  }
  return {
    label: nullableString(probe.label) || `${method} ${probe.path}`,
    method,
    path: normalizePath(probe.path),
    expectStatuses,
    body: probe.body === undefined ? undefined : probe.body,
  }
}

function normalizeFirstCheck(check = DEFAULT_FIRST_CHECK) {
  return {
    label: nullableString(check.label) || 'first authenticated API check',
    method: normalizeMethod(check.method),
    path: normalizePath(check.path || DEFAULT_FIRST_CHECK.path),
    expectStatuses: normalizeExpectedStatuses(check.expectStatus ?? check.expectStatuses, DEFAULT_FIRST_CHECK.expectStatus),
  }
}

function parseSetCookie(headers) {
  if (typeof headers.getSetCookie === 'function') return headers.getSetCookie()
  const single = headers.get('set-cookie')
  return single ? [single] : []
}

function updateCookieJar(jar, headers) {
  for (const cookie of parseSetCookie(headers)) {
    const [pair] = String(cookie).split(';')
    const equals = pair.indexOf('=')
    if (equals < 0) continue
    const name = pair.slice(0, equals).trim()
    const value = pair.slice(equals + 1).trim()
    if (!name) continue
    if (!value) jar.delete(name)
    else jar.set(name, value)
  }
}

function cookieHeader(jar) {
  return [...jar.entries()].map(([key, value]) => `${key}=${value}`).join('; ')
}

function redactError(value) {
  return String(value || '')
    .replace(/\b(password|cookie|session|token|secret|authorization)\b\s*[:=]\s*[^&\s,;}"']+/gi, '$1=[redacted]')
    .replace(/\b(sandbox_hotel_session=)[^;\s]+/gi, '$1[redacted]')
}

async function readStdin() {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks).toString('utf8').trim()
}

async function loadProofInput(args) {
  const filePath = argValue(args, '--users-file')
  if (filePath) return JSON.parse(await readFile(resolve(filePath), 'utf8'))
  if (hasFlag(args, '--users-stdin')) return JSON.parse(await readStdin())
  fail('Auth proof users are required. Pass --users-file <ignored-json> or --users-stdin.')
}

async function requestJson({ host, path, method = 'GET', body, jar }) {
  const headers = { accept: 'application/json' }
  const cookie = jar ? cookieHeader(jar) : ''
  if (cookie) headers.cookie = cookie
  const options = { method, headers, redirect: 'manual' }
  if (body !== undefined) {
    headers['content-type'] = 'application/json'
    options.body = typeof body === 'string' ? body : JSON.stringify(body)
  }
  const response = await fetch(`${host}${path}`, options)
  if (jar) updateCookieJar(jar, response.headers)
  const payload = await response.json().catch(() => null)
  return { status: response.status, ok: response.ok, payload }
}

function expectStatus(result, expected, context) {
  if (!expected.includes(result.status)) {
    const providerError = result.payload?.error ? ` ${result.payload.error}` : ''
    fail(`${context} returned ${result.status}, expected ${expected.join('/')}.\n${redactError(providerError)}`.trim())
  }
}

async function runProbe({ host, jar, probe }) {
  const result = await requestJson({
    host,
    path: probe.path,
    method: probe.method,
    body: probe.body,
    jar,
  })
  expectStatus(result, probe.expectStatuses, probe.label)
  return {
    label: probe.label,
    method: probe.method,
    path: probe.path,
    status: result.status,
    expectedStatuses: probe.expectStatuses,
  }
}

async function proveUser({ host, userInput, allowMutatingDenialProbes }) {
  const identity = nullableString(userInput.identity || userInput.username || userInput.email)
  const password = nullableString(userInput.password)
  if (!identity || !password) fail('Each proof user requires identity and password supplied through the local proof input.')

  const jar = new Map()
  const login = await requestJson({
    host,
    path: '/api/auth/login',
    method: 'POST',
    body: { identity, password },
    jar,
  })
  expectStatus(login, [200], `login for ${maskLoginIdentifier(identity)}`)

  const me = await requestJson({ host, path: '/api/auth/me', method: 'GET', jar })
  expectStatus(me, [200], `authenticated /api/auth/me for ${maskLoginIdentifier(identity)}`)

  const firstCheck = await runProbe({
    host,
    jar,
    probe: normalizeFirstCheck(userInput.firstCheck || DEFAULT_FIRST_CHECK),
  })

  const denialProbes = (userInput.denialProbes || []).map((probe) => validateDenialProbe(probe, {
    allowMutating: allowMutatingDenialProbes,
  }))
  const denialResults = []
  for (const probe of denialProbes) {
    denialResults.push(await runProbe({ host, jar, probe }))
  }

  const logout = await requestJson({ host, path: '/api/auth/logout', method: 'POST', jar })
  expectStatus(logout, [200], `logout for ${maskLoginIdentifier(identity)}`)

  const afterLogout = await requestJson({ host, path: '/api/auth/me', method: 'GET', jar })
  expectStatus(afterLogout, [401], `post-logout /api/auth/me for ${maskLoginIdentifier(identity)}`)

  return {
    expectedRole: nullableString(userInput.role) ? String(userInput.role).toUpperCase() : null,
    approvedBy: nullableString(userInput.approvedBy) || null,
    approvedAt: nullableString(userInput.approvedAt) || null,
    user: summarizePublicUserForProof(me.payload?.user || login.payload?.user || {}),
    login: {
      status: login.status,
      cookieStoredInMemoryOnly: true,
    },
    firstAuthenticatedCheck: firstCheck,
    denialChecks: denialResults,
    logout: {
      status: logout.status,
      unauthenticatedMeStatus: afterLogout.status,
    },
  }
}

async function main(args = process.argv.slice(2), env = process.env) {
  const host = normalizeProofHost(argValue(args, '--host') || env.AUTH_RBAC_PROOF_HOST || DEFAULT_HOST)
  const input = await loadProofInput(args)
  const users = Array.isArray(input.users) ? input.users : []
  if (users.length === 0) fail('At least one proof user is required.')

  const output = {
    generatedAt: new Date().toISOString(),
    purpose: 'credentialed production auth/RBAC/logout proof helper',
    host,
    mode: 'live-session-proof',
    redaction: {
      passwords: 'never printed; read only from local proof input',
      cookies: 'kept in memory only and never printed',
      tokens: 'omitted',
      loginIdentifiers: 'masked',
      displayNames: 'initials only',
      responseBodies: 'omitted except bounded user role/status and probe statuses',
    },
    safety: {
      productionMutation: hasFlag(args, '--allow-mutating-denial-probes')
        ? 'mutating denial probes explicitly enabled; use only owner-approved no-op/invalid payloads'
        : 'mutating denial probes disabled',
      credentialsStored: false,
    },
    users: [],
  }

  for (const userInput of users) {
    output.users.push(await proveUser({
      host,
      userInput,
      allowMutatingDenialProbes: hasFlag(args, '--allow-mutating-denial-probes'),
    }))
  }

  console.log(JSON.stringify(output, null, 2))
  return output
}

if (resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1] || '')) {
  main().catch((error) => {
    console.error(redactError(error instanceof Error ? error.message : String(error)))
    process.exit(1)
  })
}

export { main as runAuthRbacProductionProof }
