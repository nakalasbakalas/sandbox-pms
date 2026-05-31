import { createHmac, pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto'

const DEFAULT_SESSION_HOURS = 8
const PASSWORD_ITERATIONS = 310_000
const PASSWORD_KEY_LENGTH = 32
const PASSWORD_DIGEST = 'sha256'

function base64UrlEncode(value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(String(value))
  return buffer.toString('base64url')
}

function base64UrlDecode(value) {
  return Buffer.from(String(value), 'base64url').toString('utf8')
}

function getSessionSecret() {
  const secret = process.env.SESSION_SECRET
  if (!secret && process.env.NODE_ENV === 'production') {
    throw new Error('SESSION_SECRET is required in production.')
  }
  return secret || 'development-only-session-secret'
}

export function createPasswordHash(password) {
  if (!password || password.length < 12) {
    throw new Error('Seed passwords must be at least 12 characters.')
  }

  const salt = randomBytes(16).toString('hex')
  const hash = pbkdf2Sync(password, salt, PASSWORD_ITERATIONS, PASSWORD_KEY_LENGTH, PASSWORD_DIGEST).toString('hex')
  return `pbkdf2_${PASSWORD_DIGEST}$${PASSWORD_ITERATIONS}$${salt}$${hash}`
}

export function verifyPassword(password, storedHash) {
  if (!password || !storedHash) return false

  const [algorithm, iterationsText, salt, expectedHash] = String(storedHash).split('$')
  if (algorithm !== `pbkdf2_${PASSWORD_DIGEST}` || !iterationsText || !salt || !expectedHash) {
    return false
  }

  const iterations = Number(iterationsText)
  if (!Number.isInteger(iterations) || iterations < 100_000) return false

  const actual = pbkdf2Sync(password, salt, iterations, PASSWORD_KEY_LENGTH, PASSWORD_DIGEST)
  const expected = Buffer.from(expectedHash, 'hex')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

function signPayload(payload) {
  return createHmac('sha256', getSessionSecret()).update(payload).digest('base64url')
}

export function createSessionToken(user, options = {}) {
  const now = Math.floor(Date.now() / 1000)
  const expiresAt = now + Math.floor((options.hours ?? DEFAULT_SESSION_HOURS) * 60 * 60)
  const payload = base64UrlEncode(JSON.stringify({
    sub: user.id,
    email: user.email,
    role: user.role,
    name: `${user.firstName} ${user.lastName}`.trim(),
    iat: now,
    exp: expiresAt,
  }))
  const signature = signPayload(payload)
  return `${payload}.${signature}`
}

export function verifySessionToken(token) {
  if (!token || !token.includes('.')) return null
  const [payload, signature] = token.split('.')
  const expected = signPayload(payload)
  const expectedBuffer = Buffer.from(expected)
  const actualBuffer = Buffer.from(signature || '')

  if (expectedBuffer.length !== actualBuffer.length || !timingSafeEqual(expectedBuffer, actualBuffer)) {
    return null
  }

  const decoded = JSON.parse(base64UrlDecode(payload))
  if (!decoded.exp || decoded.exp < Math.floor(Date.now() / 1000)) {
    return null
  }
  return decoded
}

export function sessionCookie(token) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  return `pms_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${DEFAULT_SESSION_HOURS * 60 * 60}${secure}`
}

export function clearSessionCookie() {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  return `pms_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`
}

export function readSessionCookie(request) {
  const cookies = Object.fromEntries(
    String(request.headers.cookie || '')
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf('=')
        return index === -1 ? [part, ''] : [part.slice(0, index), decodeURIComponent(part.slice(index + 1))]
      }),
  )
  return cookies.pms_session
}
