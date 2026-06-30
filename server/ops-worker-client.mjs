import { PmsValidationError } from './pms-domain.mjs'
import { opsWorkerBaseUrl, opsWorkerConfigured, signOpsWorkerRequest } from './ops-worker-auth.mjs'
import { executeSignedOtaWorkerTask } from './ota-adapters/index.mjs'

const WORKER_CALL_TIMEOUT_MS = 15_000
const LOCAL_SIGNED_WORKER_SECRET = 'local-signed-worker-fallback-secret'

function normalizeString(value) {
  const text = String(value || '').trim()
  return text || null
}

function isoDateOrNull(value) {
  if (!value) return null
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10)
}

function mockScenarioForTask(task) {
  const raw = String(task.rawMessage || '').toLowerCase()
  if (raw.includes('selector failure')) return 'selector_failure'
  if (raw.includes('2fa') || raw.includes('captcha')) return 'human_challenge'
  return null
}

export function buildOpsWorkerTaskPayload(task, options = {}) {
  const taskId = normalizeString(task?.id)
  const taskType = normalizeString(task?.taskType)?.toUpperCase()
  const platform = normalizeString(task?.platform)?.toLowerCase() || 'unknown'
  if (!taskId || !taskType) throw new PmsValidationError('Hotel Ops worker task payload is incomplete.', 400)

  const payload = {
    taskId,
    taskType,
    platform,
    hotelId: normalizeString(task.hotelId),
    roomType: normalizeString(task.roomType),
    dateStart: isoDateOrNull(task.dateStart),
    dateEnd: isoDateOrNull(task.dateEnd),
    dryRun: options.dryRun !== false,
  }

  if (task.rateAmount !== null && task.rateAmount !== undefined) {
    payload.rate = {
      amount: Number(task.rateAmount),
      currency: normalizeString(task.rateCurrency) || 'THB',
    }
  }

  const hasAvailability = task.availabilityStatus !== null && task.availabilityStatus !== undefined
    || task.availabilityRooms !== null && task.availabilityRooms !== undefined
  if (hasAvailability) {
    payload.availability = {
      rooms: task.availabilityRooms === null || task.availabilityRooms === undefined ? null : Number(task.availabilityRooms),
      status: normalizeString(task.availabilityStatus),
    }
  }

  const mockScenario = mockScenarioForTask(task)
  if (mockScenario) payload.mockScenario = mockScenario

  return payload
}

async function fetchWithTimeout(fetchImpl, url, request, timeoutMs) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetchImpl(url, {
      method: 'POST',
      headers: request.headers,
      body: request.body,
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeout)
  }
}

async function parseWorkerResponse(response) {
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    throw new PmsValidationError(payload?.error || `OTA worker request failed with HTTP ${response.status}.`, response.status || 502)
  }
  return payload?.data || payload
}

export async function executeOpsWorkerTask(task, options = {}) {
  const env = options.env || process.env
  const payload = buildOpsWorkerTaskPayload(task, options)
  const remoteWorkerConfigured = opsWorkerConfigured(env)
  const signedRequest = signOpsWorkerRequest(payload, remoteWorkerConfigured
    ? { env }
    : { secret: options.localWorkerSecret || LOCAL_SIGNED_WORKER_SECRET })
  const fetchImpl = options.fetchImpl || globalThis.fetch

  if (remoteWorkerConfigured && fetchImpl) {
    const response = await fetchWithTimeout(
      fetchImpl,
      opsWorkerBaseUrl(env),
      signedRequest,
      Number(options.timeoutMs || WORKER_CALL_TIMEOUT_MS),
    )
    const data = await parseWorkerResponse(response)
    return {
      ...data,
      workerMode: 'remote-signed-worker',
      signed: true,
    }
  }

  const data = await executeSignedOtaWorkerTask(JSON.parse(signedRequest.body), { env })
  return {
    ...data,
    workerMode: 'local-signed-worker',
    signed: true,
  }
}
