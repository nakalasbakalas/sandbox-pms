export const SHADOW_RETRY_SCOPE = 'shadow-ingestion'

const DEFAULT_RETRYABLE_STATUS_CODES = Object.freeze([
  408,
  425,
  429,
  500,
  502,
  503,
  504,
])

const DEFAULT_RETRYABLE_ERROR_CODES = Object.freeze([
  'ECONNRESET',
  'ECONNREFUSED',
  'EHOSTUNREACH',
  'ENETDOWN',
  'ENETUNREACH',
  'ENOTFOUND',
  'ETIMEDOUT',
])

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(Math.max(Math.round(parsed), minimum), maximum)
}

function uniqueBoundedStatusCodes(values) {
  if (!Array.isArray(values)) return [...DEFAULT_RETRYABLE_STATUS_CODES]
  return [...new Set(values
    .map(Number)
    .filter((value) => Number.isInteger(value) && value >= 400 && value <= 599))]
    .slice(0, 20)
}

function uniqueErrorCodes(values) {
  if (!Array.isArray(values)) return [...DEFAULT_RETRYABLE_ERROR_CODES]
  return [...new Set(values
    .map((value) => String(value || '').trim().toUpperCase())
    .filter((value) => /^[A-Z][A-Z0-9_]{1,39}$/.test(value)))]
    .slice(0, 20)
}

export function normalizeShadowRetryPolicy(input = {}) {
  const maxAttempts = boundedInteger(input.maxAttempts, 3, 1, 10)
  const baseDelayMs = boundedInteger(input.baseDelayMs, 1_000, 0, 60_000)
  const maxDelayMs = boundedInteger(input.maxDelayMs, 30_000, baseDelayMs, 300_000)

  return Object.freeze({
    scope: SHADOW_RETRY_SCOPE,
    maxAttempts,
    baseDelayMs,
    maxDelayMs,
    retryableStatusCodes: Object.freeze(uniqueBoundedStatusCodes(input.retryableStatusCodes)),
    retryableErrorCodes: Object.freeze(uniqueErrorCodes(input.retryableErrorCodes)),
  })
}

function statusCodeFrom(value) {
  const statusCode = Number(value?.statusCode ?? value?.status)
  return Number.isInteger(statusCode) && statusCode >= 100 && statusCode <= 599
    ? statusCode
    : null
}

function errorCodeFrom(value) {
  const code = String(value?.code || '').trim().toUpperCase()
  return /^[A-Z][A-Z0-9_]{1,39}$/.test(code) ? code : null
}

export function shadowRetryDelayMs(attempt, policyInput = {}) {
  const policy = normalizeShadowRetryPolicy(policyInput)
  const normalizedAttempt = boundedInteger(attempt, 1, 1, policy.maxAttempts)
  const exponential = policy.baseDelayMs * (2 ** (normalizedAttempt - 1))
  return Math.min(exponential, policy.maxDelayMs)
}

export function classifyShadowRetry(value, { attempt = 1, policy: policyInput = {} } = {}) {
  const policy = normalizeShadowRetryPolicy(policyInput)
  const normalizedAttempt = boundedInteger(attempt, 1, 1, policy.maxAttempts)
  const statusCode = statusCodeFrom(value)
  const errorCode = errorCodeFrom(value)
  const retryableByStatus = statusCode !== null && policy.retryableStatusCodes.includes(statusCode)
  const retryableByCode = errorCode !== null && policy.retryableErrorCodes.includes(errorCode)
  const retryable = retryableByStatus || retryableByCode
  const exhausted = retryable && normalizedAttempt >= policy.maxAttempts

  return Object.freeze({
    scope: SHADOW_RETRY_SCOPE,
    attempt: normalizedAttempt,
    maxAttempts: policy.maxAttempts,
    retryable,
    exhausted,
    shouldRetry: retryable && !exhausted,
    nextDelayMs: retryable && !exhausted
      ? shadowRetryDelayMs(normalizedAttempt, policy)
      : null,
    reason: retryableByStatus
      ? 'retryable_status'
      : retryableByCode
        ? 'retryable_network_error'
        : 'non_retryable',
    statusCode,
    errorCode,
  })
}
