const DEFAULT_WINDOW_MS = 15 * 60 * 1000
const DEFAULT_LOCKOUT_MS = 15 * 60 * 1000
const DEFAULT_ACCOUNT_ATTEMPTS = 5
const DEFAULT_IP_ATTEMPTS = 20

function positiveInteger(value, fallback) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase()
}

function keyPart(value, fallback) {
  const normalized = String(value || '').trim().toLowerCase()
  return normalized || fallback
}

function retryAfterSeconds(until, now) {
  return Math.max(1, Math.ceil((until - now) / 1000))
}

export function resolveClientIp(request) {
  const forwardedFor = String(request.headers['x-forwarded-for'] || '')
    .split(',')[0]
    .trim()
  return forwardedFor || request.socket?.remoteAddress || 'unknown'
}

export function createLoginThrottle(options = {}) {
  const windowMs = positiveInteger(options.windowMs, DEFAULT_WINDOW_MS)
  const lockoutMs = positiveInteger(options.lockoutMs, DEFAULT_LOCKOUT_MS)
  const accountMaxAttempts = positiveInteger(options.accountMaxAttempts, DEFAULT_ACCOUNT_ATTEMPTS)
  const ipMaxAttempts = positiveInteger(options.ipMaxAttempts, DEFAULT_IP_ATTEMPTS)
  const attempts = new Map()

  const keysFor = ({ email, ip }) => [
    { key: `ip:${keyPart(ip, 'unknown')}`, maxAttempts: ipMaxAttempts, scope: 'ip' },
    { key: `account:${keyPart(normalizeEmail(email), 'unknown')}`, maxAttempts: accountMaxAttempts, scope: 'account' },
  ]

  function freshState(now) {
    return {
      count: 0,
      windowStartedAt: now,
      lockedUntil: 0,
    }
  }

  function stateFor(key, now) {
    const existing = attempts.get(key)
    if (!existing || now - existing.windowStartedAt >= windowMs) {
      const next = freshState(now)
      attempts.set(key, next)
      return next
    }
    return existing
  }

  function prune(now) {
    for (const [key, state] of attempts.entries()) {
      const windowExpired = now - state.windowStartedAt >= windowMs
      const lockExpired = !state.lockedUntil || state.lockedUntil <= now
      if (windowExpired && lockExpired) attempts.delete(key)
    }
  }

  function check(identity, now = Date.now()) {
    prune(now)
    for (const item of keysFor(identity)) {
      const state = attempts.get(item.key)
      if (state?.lockedUntil > now) {
        return {
          allowed: false,
          scope: item.scope,
          retryAfterSeconds: retryAfterSeconds(state.lockedUntil, now),
        }
      }
    }
    return { allowed: true }
  }

  function recordFailure(identity, now = Date.now()) {
    prune(now)
    let lockout = null

    for (const item of keysFor(identity)) {
      const state = stateFor(item.key, now)
      state.count += 1

      if (state.count >= item.maxAttempts) {
        state.lockedUntil = now + lockoutMs
        lockout = {
          allowed: false,
          scope: item.scope,
          retryAfterSeconds: retryAfterSeconds(state.lockedUntil, now),
        }
      }
    }

    return lockout || { allowed: true }
  }

  function recordSuccess(identity) {
    for (const item of keysFor(identity)) {
      attempts.delete(item.key)
    }
  }

  function reset() {
    attempts.clear()
  }

  return {
    check,
    recordFailure,
    recordSuccess,
    reset,
  }
}

export const loginThrottle = createLoginThrottle({
  windowMs: positiveInteger(process.env.LOGIN_THROTTLE_WINDOW_MS, DEFAULT_WINDOW_MS),
  lockoutMs: positiveInteger(process.env.LOGIN_LOCKOUT_MS, DEFAULT_LOCKOUT_MS),
  accountMaxAttempts: positiveInteger(process.env.LOGIN_ACCOUNT_MAX_ATTEMPTS, DEFAULT_ACCOUNT_ATTEMPTS),
  ipMaxAttempts: positiveInteger(process.env.LOGIN_IP_MAX_ATTEMPTS, DEFAULT_IP_ATTEMPTS),
})
