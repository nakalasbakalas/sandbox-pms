import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { PmsValidationError } from './pms-domain.mjs'

export const OPS_WORKER_SIGNATURE_HEADER = 'x-ops-worker-signature'
export const OPS_WORKER_TIMESTAMP_HEADER = 'x-ops-worker-timestamp'
export const OPS_WORKER_NONCE_HEADER = 'x-ops-worker-nonce'

const DEFAULT_MAX_SKEW_MS = 5 * 60 * 1000
const ALLOWED_TASK_TYPES = new Set([
  'READ_RESERVATIONS',
  'READ_GUEST_MESSAGES',
  'READ_RATES',
  'UPDATE_RATE',
  'READ_AVAILABILITY',
  'UPDATE_AVAILABILITY',
  'CLOSE_ROOM',
  'OPEN_ROOM',
  'SCAN_BOOKINGS',
])
const ALLOWED_PLATFORMS = new Set(['booking', 'agoda', 'trip', 'expedia', 'all', 'unknown'])
const CREDENTIAL_FIELD_PATTERN = /(password|secret|token|credential|api[_-]?key|session)/i

function normalizeString(value) {
  const text = String(value || '').trim()
  return text || null
}

function bodyText(body) {
  if (Buffer.isBuffer(body)) return body.toString('utf8')
  if (typeof body === 'string') return body
  return JSON.stringify(body ?? {})
}

function headerValue(headers, name) {
  if (!headers) return null
  if (typeof headers.get === 'function') return normalizeString(headers.get(name))
  const lowerName = name.toLowerCase()
  const value = headers[lowerName] ?? headers[name]
  return Array.isArray(value) ? normalizeString(value[0]) : normalizeString(value)
}

function canonicalPayload(timestamp, nonce, body) {
  return `${timestamp}.${nonce}.${bodyText(body)}`
}

function workerSignature(secret, timestamp, nonce, body) {
  return createHmac('sha256', secret).update(canonicalPayload(timestamp, nonce, body)).digest('base64url')
}

export function opsWorkerBaseUrl(env = process.env) {
  return normalizeString(env.OTA_WORKER_BASE_URL || env.OTA_WORKER_URL)
}

export function opsWorkerSecret(env = process.env) {
  return normalizeString(env.OTA_WORKER_SHARED_SECRET || env.OTA_WORKER_SECRET)
}

export function opsWorkerConfigured(env = process.env) {
  return Boolean(opsWorkerBaseUrl(env) && opsWorkerSecret(env))
}

export function signOpsWorkerRequest(body, options = {}) {
  const secret = normalizeString(options.secret) || opsWorkerSecret(options.env)
  if (!secret) throw new PmsValidationError('OTA worker shared secret is not configured.', 503)

  const timestamp = String(options.timestamp || Date.now())
  const nonce = normalizeString(options.nonce) || randomUUID()
  const signature = workerSignature(secret, timestamp, nonce, body)

  return {
    body: bodyText(body),
    headers: {
      'content-type': 'application/json',
      [OPS_WORKER_SIGNATURE_HEADER]: signature,
      [OPS_WORKER_TIMESTAMP_HEADER]: timestamp,
      [OPS_WORKER_NONCE_HEADER]: nonce,
    },
    signature,
    timestamp,
    nonce,
  }
}

export function verifyOpsWorkerRequest({ body, headers, env = process.env, now = Date.now(), maxSkewMs = DEFAULT_MAX_SKEW_MS, secret } = {}) {
  const sharedSecret = normalizeString(secret) || opsWorkerSecret(env)
  if (!sharedSecret) {
    return { ok: false, statusCode: 503, error: 'OTA worker shared secret is not configured.' }
  }

  const signature = headerValue(headers, OPS_WORKER_SIGNATURE_HEADER)
  const timestampText = headerValue(headers, OPS_WORKER_TIMESTAMP_HEADER)
  const nonce = headerValue(headers, OPS_WORKER_NONCE_HEADER)
  if (!signature || !timestampText || !nonce) {
    return { ok: false, statusCode: 401, error: 'Signed OTA worker request is required.' }
  }

  const timestamp = Number(timestampText)
  if (!Number.isFinite(timestamp) || Math.abs(Number(now) - timestamp) > maxSkewMs) {
    return { ok: false, statusCode: 401, error: 'OTA worker request signature has expired.' }
  }

  const expected = workerSignature(sharedSecret, timestampText, nonce, body)
  const expectedBuffer = Buffer.from(expected)
  const actualBuffer = Buffer.from(signature)
  if (expectedBuffer.length !== actualBuffer.length || !timingSafeEqual(expectedBuffer, actualBuffer)) {
    return { ok: false, statusCode: 401, error: 'Invalid OTA worker request signature.' }
  }

  return { ok: true }
}

function assertNoCredentialFields(value, path = '') {
  if (!value || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value)) {
    const childPath = path ? `${path}.${key}` : key
    if (CREDENTIAL_FIELD_PATTERN.test(key)) {
      throw new PmsValidationError(`OTA worker payload must not include credential field ${childPath}.`, 400)
    }
    if (child && typeof child === 'object') assertNoCredentialFields(child, childPath)
  }
}

export function normalizeOpsWorkerTaskPayload(payload = {}) {
  assertNoCredentialFields(payload)

  const taskId = normalizeString(payload.taskId)
  const taskType = normalizeString(payload.taskType)?.toUpperCase()
  const platform = normalizeString(payload.platform)?.toLowerCase() || 'unknown'

  if (!taskId) throw new PmsValidationError('OTA worker taskId is required.', 400)
  if (!ALLOWED_TASK_TYPES.has(taskType)) throw new PmsValidationError('OTA worker task type is not allowed.', 400)
  if (!ALLOWED_PLATFORMS.has(platform)) throw new PmsValidationError('OTA worker platform is not allowed.', 400)

  return {
    taskId,
    taskType,
    platform,
    hotelId: normalizeString(payload.hotelId),
    roomType: normalizeString(payload.roomType),
    dateStart: normalizeString(payload.dateStart),
    dateEnd: normalizeString(payload.dateEnd),
    rate: payload.rate && typeof payload.rate === 'object' ? payload.rate : undefined,
    availability: payload.availability && typeof payload.availability === 'object' ? payload.availability : undefined,
    dryRun: payload.dryRun !== false,
    mockScenario: ['selector_failure', 'human_challenge'].includes(payload.mockScenario) ? payload.mockScenario : null,
  }
}

export function runSignedMockOtaWorkerTask(payload = {}) {
  const task = normalizeOpsWorkerTaskPayload(payload)
  const proof = (kind) => [{
    id: `${task.taskId}-${kind}`,
    kind,
    storageUrl: `mock://hotel-ops/${encodeURIComponent(task.taskId)}/${kind}`,
    capturedAt: new Date().toISOString(),
    redactionStatus: 'SAFE',
  }]

  if (task.mockScenario === 'selector_failure') {
    return {
      taskId: task.taskId,
      status: 'FAILED',
      summary: 'Signed mock worker could not find the expected selector.',
      proofScreenshots: proof('error'),
      errorCode: 'MOCK_SELECTOR_FAILURE',
      errorMessage: 'Selector not found in mock adapter.',
      data: {
        dryRun: task.dryRun,
        platform: task.platform,
        taskType: task.taskType,
      },
    }
  }

  if (task.mockScenario === 'human_challenge') {
    return {
      taskId: task.taskId,
      status: 'NEEDS_HUMAN',
      summary: 'Signed mock worker requires human 2FA/CAPTCHA completion. No bypass attempted.',
      proofScreenshots: proof('trace'),
      errorCode: 'NEEDS_HUMAN_CHALLENGE',
      errorMessage: '2FA/CAPTCHA requires authorized human action.',
      data: {
        dryRun: task.dryRun,
        platform: task.platform,
        taskType: task.taskType,
      },
    }
  }

  return {
    taskId: task.taskId,
    status: 'SUCCEEDED',
    summary: task.dryRun
      ? `Dry run: signed mock worker accepted ${task.taskType} for ${task.platform}.`
      : `Signed mock worker accepted ${task.taskType} for ${task.platform}.`,
    proofScreenshots: proof(['UPDATE_RATE', 'UPDATE_AVAILABILITY', 'CLOSE_ROOM', 'OPEN_ROOM'].includes(task.taskType) ? 'after' : 'trace'),
    data: {
      dryRun: task.dryRun,
      platform: task.platform,
      taskType: task.taskType,
    },
  }
}
