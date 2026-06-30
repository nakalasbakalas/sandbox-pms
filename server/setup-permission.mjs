import { timingSafeEqual } from 'node:crypto'

export function envEnabled(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase())
}

function firstHeaderValue(value) {
  return Array.isArray(value) ? value[0] : value
}

function compareTokens(actual, expected) {
  const actualBuffer = Buffer.from(String(actual || ''), 'utf8')
  const expectedBuffer = Buffer.from(String(expected || ''), 'utf8')
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)
}

export function requestSetupToken(request) {
  const explicitHeader = firstHeaderValue(request.headers?.['x-setup-token'])
  if (explicitHeader) return String(explicitHeader).trim()

  const authHeader = String(firstHeaderValue(request.headers?.authorization) || '').trim()
  const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i)
  return bearerMatch ? bearerMatch[1].trim() : ''
}

export function setupTokenRequired(env = process.env) {
  return Boolean(String(env.INITIAL_SETUP_TOKEN || '').trim())
}

export function requireSetupPermission(request, env = process.env) {
  const configuredToken = String(env.INITIAL_SETUP_TOKEN || '').trim()
  if (configuredToken) {
    if (compareTokens(requestSetupToken(request), configuredToken)) return
    const error = new Error('A valid setup token is required.')
    error.statusCode = 403
    throw error
  }

  if (env.NODE_ENV === 'production' && !envEnabled(env.ALLOW_PUBLIC_SETUP)) {
    const error = new Error('Public first-run setup is disabled in production. Seed an admin user or configure INITIAL_SETUP_TOKEN.')
    error.statusCode = 403
    throw error
  }
}
