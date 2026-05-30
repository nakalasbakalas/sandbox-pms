/* global process, URL */

export const productionMarkers = [
  'prod',
  'production',
  'live',
  'sandbox-hotel-pms-db-v43m',
  'sandbox_hotel_pms',
]

export const allowedDisposableMarkers = [
  'e2e',
  'test',
  'testing',
  'staging',
  'stage',
  'ci',
  'dev',
  'local',
  'disposable',
]

export function normalize(value) {
  return String(value || '').trim().toLowerCase()
}

export function parseDatabaseUrl(value, envName = 'DATABASE_URL') {
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') {
      throw new Error(`${envName} must be a PostgreSQL URL.`)
    }
    return parsed
  } catch (error) {
    if (error instanceof Error && error.message.includes('must be a PostgreSQL URL')) throw error
    throw new Error(`${envName} must be a valid PostgreSQL URL.`)
  }
}

export function databaseUrlContainsProductionMarker(value) {
  const parsed = parseDatabaseUrl(value)
  const target = normalize([
    parsed.hostname,
    parsed.pathname,
    parsed.search,
    parsed.username,
  ].join(' '))
  return productionMarkers.find((marker) => target.includes(marker)) || null
}

export function databaseUrlContainsDisposableMarker(value) {
  const parsed = parseDatabaseUrl(value)
  const target = normalize([
    parsed.hostname,
    parsed.pathname,
    parsed.search,
    parsed.username,
  ].join(' '))
  return allowedDisposableMarkers.find((marker) => target.includes(marker)) || null
}

export function redactDatabaseUrl(value) {
  if (!value) return ''
  try {
    const parsed = parseDatabaseUrl(value)
    if (parsed.password) parsed.password = '***'
    return parsed.toString()
  } catch {
    return String(value).replace(/:\/\/([^:\s]+):([^@\s]+)@/, '://$1:***@')
  }
}

export function summarizeDatabaseUrl(value, envName = 'DATABASE_URL') {
  if (!value) return null
  const parsed = parseDatabaseUrl(value, envName)
  return {
    protocol: parsed.protocol.replace(':', ''),
    host: parsed.hostname,
    port: parsed.port || '5432',
    database: parsed.pathname.replace(/^\//, '') || '(none)',
    schema: parsed.searchParams.get('schema') || 'public',
    user: parsed.username || '(none)',
    redacted: redactDatabaseUrl(value),
  }
}

export function assertSafeE2EDatabase(env = process.env) {
  const e2eDatabaseUrl = env.E2E_DATABASE_URL

  if (!e2eDatabaseUrl) {
    throw new Error('E2E_DATABASE_URL is required for database-mutating E2E.')
  }

  if (env.ALLOW_DB_E2E !== 'true') {
    throw new Error('ALLOW_DB_E2E=true is required for database-mutating E2E.')
  }

  parseDatabaseUrl(e2eDatabaseUrl, 'E2E_DATABASE_URL')
  const normalizedUrl = normalize(e2eDatabaseUrl)
  const normalizedRuntimeUrl = normalize(env.DATABASE_URL)

  if (normalizedRuntimeUrl && normalizedRuntimeUrl === normalizedUrl) {
    throw new Error('E2E_DATABASE_URL must not be the same value as DATABASE_URL.')
  }

  const productionMarker = databaseUrlContainsProductionMarker(e2eDatabaseUrl)
  if (productionMarker) {
    throw new Error(`Refusing database-mutating E2E because the URL contains production-like marker "${productionMarker}".`)
  }

  const disposableMarker = databaseUrlContainsDisposableMarker(e2eDatabaseUrl)
  if (!disposableMarker) {
    throw new Error('E2E_DATABASE_URL must clearly identify a disposable, dev, test, CI, or staging database.')
  }

  return e2eDatabaseUrl
}
