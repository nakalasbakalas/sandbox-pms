/* global Buffer, URL, console, fetch, process */
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_HOST = 'https://book.sandboxhotel.com'
const DEFAULT_FIRST_CHECK = { method: 'GET', path: '/api/auth/me', expectStatus: 200 }
const SAFE_DENIAL_METHODS = new Set(['GET', 'HEAD'])
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const PROOF_ROLES = new Set(['ADMIN', 'MANAGER', 'FRONT_DESK', 'HOUSEKEEPING', 'CASHIER', 'CAFE_STAFF'])
const FINISH_MATRIX_ROLES = ['ADMIN', 'MANAGER', 'FRONT_DESK', 'HOUSEKEEPING', 'CASHIER']

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

export function normalizeExpectedRole(value) {
  const role = nullableString(value)?.toUpperCase().replace(/[\s-]+/g, '_') || null
  if (!role) fail('Each proof user requires an expected role.')
  if (!PROOF_ROLES.has(role)) fail(`Unsupported proof role: ${role}.`)
  return role
}

export function validateFinishRoleMatrix(users = []) {
  if (!Array.isArray(users)) fail('Finish role matrix users must be an array.')
  const roles = users.map((user) => normalizeExpectedRole(user?.role))
  const counts = new Map()
  for (const role of roles) counts.set(role, (counts.get(role) || 0) + 1)
  const missing = FINISH_MATRIX_ROLES.filter((role) => !counts.has(role))
  const duplicate = FINISH_MATRIX_ROLES.filter((role) => (counts.get(role) || 0) > 1)
  const unexpected = [...new Set(roles.filter((role) => !FINISH_MATRIX_ROLES.includes(role)))]
  if (roles.length !== FINISH_MATRIX_ROLES.length || missing.length || duplicate.length || unexpected.length) {
    const details = [
      missing.length ? `missing ${missing.join(', ')}` : null,
      duplicate.length ? `duplicate ${duplicate.join(', ')}` : null,
      unexpected.length ? `unexpected ${unexpected.join(', ')}` : null,
    ].filter(Boolean).join('; ')
    fail(`Finish role matrix must contain exactly one of each required role: ${FINISH_MATRIX_ROLES.join(', ')}.${details ? ` ${details}.` : ''}`)
  }
  return [...FINISH_MATRIX_ROLES]
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
    role: nullableString(user.role) ? String(user.role).toUpperCase().replace(/[\s-]+/g, '_') : null,
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
  const statuses = values.map((item) => Number(item)).filter((item) => Number.isInteger(item) && item >= 100 && item <= 599)
  if (statuses.length === 0) fail('At least one valid expected HTTP status is required.')
  return statuses
}

export function normalizeForbiddenResponseFields(value) {
  if (value === undefined || value === null) return []
  const values = Array.isArray(value) ? value : [value]
  if (values.some((field) => !nullableString(field))) fail('Forbidden response fields must be non-empty field names.')
  const fields = [...new Set(values.map((field) => nullableString(field)?.toLowerCase()).filter(Boolean))]
  return fields
}

export function findForbiddenResponseFields(payload, forbiddenFields = []) {
  const forbidden = new Set(normalizeForbiddenResponseFields(forbiddenFields))
  const found = new Set()
  function visit(value) {
    if (!value || typeof value !== 'object') return
    if (Array.isArray(value)) {
      for (const item of value) visit(item)
      return
    }
    for (const [key, child] of Object.entries(value)) {
      const normalizedKey = key.toLowerCase()
      if (forbidden.has(normalizedKey)) found.add(normalizedKey)
      visit(child)
    }
  }
  visit(payload)
  return [...found].sort()
}

function normalizeProbeFields(probe) {
  return normalizeForbiddenResponseFields(probe.forbiddenResponseFields ?? probe.forbidResponseFields)
}

export function normalizeAccessProbe(probe = {}, { defaultLabel = null } = {}) {
  const method = normalizeMethod(probe.method)
  if (!SAFE_DENIAL_METHODS.has(method)) {
    fail(`Authenticated access probe ${method} ${probe.path || ''} is not allowed. Access probes must use GET or HEAD.`)
  }
  return {
    label: nullableString(probe.label) || defaultLabel || `${method} ${probe.path}`,
    method,
    path: normalizePath(probe.path),
    expectStatuses: normalizeExpectedStatuses(probe.expectStatus ?? probe.expectStatuses, 200),
    forbiddenResponseFields: normalizeProbeFields(probe),
  }
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
    forbiddenResponseFields: normalizeProbeFields(probe),
  }
}

function normalizeFirstCheck(check = DEFAULT_FIRST_CHECK) {
  return normalizeAccessProbe({ ...check, path: check.path || DEFAULT_FIRST_CHECK.path }, {
    defaultLabel: 'first authenticated API check',
  })
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
    fail(`${context} returned ${result.status}, expected ${expected.join('/')}.`)
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
  const forbiddenFields = findForbiddenResponseFields(result.payload, probe.forbiddenResponseFields)
  if (forbiddenFields.length > 0) {
    fail(`${probe.label} response contained forbidden field names: ${forbiddenFields.join(', ')}.`)
  }
  return {
    label: probe.label,
    method: probe.method,
    path: probe.path,
    status: result.status,
    expectedStatuses: probe.expectStatuses,
    forbiddenResponseFieldsChecked: probe.forbiddenResponseFields,
  }
}

async function proveUser({ host, userInput, allowMutatingDenialProbes }) {
  const identity = nullableString(userInput.identity || userInput.username || userInput.email)
  const password = nullableString(userInput.password)
  if (!identity || !password) fail('Each proof user requires identity and password supplied through the local proof input.')
  const expectedRole = normalizeExpectedRole(userInput.role)

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
  const actualRole = nullableString(me.payload?.user?.role)
    ? String(me.payload.user.role).toUpperCase().replace(/[\s-]+/g, '_')
    : null
  if (actualRole !== expectedRole) {
    fail(`Authenticated /api/auth/me role mismatch for ${maskLoginIdentifier(identity)}: expected ${expectedRole}, received ${actualRole || '[missing]'}.`)
  }

  const firstCheck = await runProbe({
    host,
    jar,
    probe: normalizeFirstCheck(userInput.firstCheck || DEFAULT_FIRST_CHECK),
  })

  const accessProbes = Array.isArray(userInput.accessProbes) ? userInput.accessProbes : []
  const accessResults = []
  for (const probe of accessProbes.map((item) => normalizeAccessProbe(item))) {
    accessResults.push(await runProbe({ host, jar, probe }))
  }

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
    expectedRole,
    approvedBy: nullableString(userInput.approvedBy) || null,
    approvedAt: nullableString(userInput.approvedAt) || null,
    user: summarizePublicUserForProof(me.payload?.user || login.payload?.user || {}),
    login: {
      status: login.status,
      cookieStoredInMemoryOnly: true,
    },
    firstAuthenticatedCheck: firstCheck,
    authenticatedAccessChecks: accessResults,
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
  for (const user of users) normalizeExpectedRole(user?.role)
  if (hasFlag(args, '--require-finish-matrix')) validateFinishRoleMatrix(users)

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
      responseBodies: 'first/access/denial probe bodies omitted; only bounded /api/auth/me user summary and statuses retained',
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
