import { randomUUID } from 'node:crypto'

const DEFAULT_HEARTBEAT_MS = 25_000
const DEFAULT_RETRY_MS = 5_000
const DEFAULT_MAX_CLIENTS = 250
const MAX_OPAQUE_ID_LENGTH = 160
const MAX_REASON_LENGTH = 80

export const REALTIME_EVENT_TYPES = Object.freeze([
  'sync-required',
  'booking-email.received',
  'booking-email.changed',
  'reservation.changed',
  'manual-channel-tasks.changed',
])

const REALTIME_EVENT_TYPE_SET = new Set(REALTIME_EVENT_TYPES)

export class RealtimeEventError extends Error {
  constructor(message, options = {}) {
    super(message)
    this.name = 'RealtimeEventError'
    this.code = options.code || 'REALTIME_EVENT_ERROR'
    this.statusCode = Number(options.statusCode || 500)
  }
}

function positiveInteger(value, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback
  return Math.min(parsed, maximum)
}

function nullableOpaqueId(value) {
  const normalized = String(value ?? '').trim()
  if (!normalized) return null
  if (normalized.length > MAX_OPAQUE_ID_LENGTH || !/^[A-Za-z0-9:_-]+$/.test(normalized)) {
    throw new RealtimeEventError('Realtime entity id is invalid.', {
      code: 'REALTIME_ENTITY_ID_INVALID',
      statusCode: 400,
    })
  }
  return normalized
}

function nullableReason(value) {
  const normalized = String(value ?? '').trim()
  if (!normalized) return null
  if (normalized.length > MAX_REASON_LENGTH || !/^[a-z0-9._:-]+$/i.test(normalized)) {
    throw new RealtimeEventError('Realtime reason code is invalid.', {
      code: 'REALTIME_REASON_INVALID',
      statusCode: 400,
    })
  }
  return normalized
}

function safeLogger(logger = console) {
  return {
    warn: typeof logger?.warn === 'function' ? logger.warn.bind(logger) : () => undefined,
    error: typeof logger?.error === 'function' ? logger.error.bind(logger) : () => undefined,
  }
}

function isoTimestamp(now) {
  const value = typeof now === 'function' ? now() : new Date()
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return new Date().toISOString()
  return date.toISOString()
}

function normalizeEventType(type) {
  const normalized = String(type || '').trim()
  if (!REALTIME_EVENT_TYPE_SET.has(normalized)) {
    throw new RealtimeEventError('Realtime event type is not allowed.', {
      code: 'REALTIME_EVENT_TYPE_INVALID',
      statusCode: 400,
    })
  }
  return normalized
}

/**
 * Realtime payloads intentionally contain no guest, email, payment, room, or
 * credential data. Clients use these signals only to refetch authorized APIs.
 */
export function sanitizeRealtimeEvent(type, input = {}, options = {}) {
  const eventType = normalizeEventType(type)
  const entityId = nullableOpaqueId(input.entityId)
  const reason = nullableReason(input.reason)
  return {
    type: eventType,
    occurredAt: isoTimestamp(options.now),
    ...(entityId ? { entityId } : {}),
    ...(reason ? { reason } : {}),
  }
}

function sseLineValue(value) {
  return String(value || '').replace(/[\r\n]+/g, '')
}

function serializeSseEvent(eventId, event) {
  return [
    `id: ${sseLineValue(eventId)}`,
    `event: ${sseLineValue(event.type)}`,
    `data: ${JSON.stringify(event)}`,
    '',
    '',
  ].join('\n')
}

function responseAvailable(response) {
  return Boolean(response && !response.destroyed && !response.writableEnded)
}

function defaultHeaders(response, options = {}) {
  return {
    ...(response?.corsHeaders || {}),
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-store, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
    ...options.headers,
  }
}

/**
 * Creates a bounded in-process SSE hub. It is appropriate for the current
 * single-instance Render service. Every connection receives sync-required on
 * arrival, so reconnects recover by refetching even though events are not
 * replayed. Call publish only after the corresponding DB transaction commits.
 */
export function createRealtimeEventHub(options = {}) {
  const heartbeatMs = positiveInteger(options.heartbeatMs, DEFAULT_HEARTBEAT_MS, 60_000)
  const retryMs = positiveInteger(options.retryMs, DEFAULT_RETRY_MS, 60_000)
  const maxClients = positiveInteger(options.maxClients, DEFAULT_MAX_CLIENTS, 5_000)
  const setIntervalFn = options.setIntervalFn || setInterval
  const clearIntervalFn = options.clearIntervalFn || clearInterval
  const now = options.now || (() => new Date())
  const logger = safeLogger(options.logger)
  const processId = String(options.processId || randomUUID()).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64)
  const clients = new Map()
  let sequence = 0
  let closed = false
  let heartbeat = null

  function nextEventId() {
    sequence += 1
    return `${processId}:${sequence}`
  }

  function removeClient(clientId) {
    const client = clients.get(clientId)
    if (!client) return false
    clients.delete(clientId)
    for (const [target, eventName, listener] of client.listeners) {
      target?.off?.(eventName, listener)
      target?.removeListener?.(eventName, listener)
    }
    return true
  }

  function writeToClient(clientId, contents) {
    const client = clients.get(clientId)
    if (!client || !responseAvailable(client.response)) {
      removeClient(clientId)
      return false
    }
    try {
      client.response.write(contents)
      client.lastWriteAt = isoTimestamp(now)
      return true
    } catch {
      removeClient(clientId)
      return false
    }
  }

  function startHeartbeat() {
    if (heartbeat || closed) return
    heartbeat = setIntervalFn(() => {
      const timestamp = isoTimestamp(now)
      for (const clientId of clients.keys()) {
        writeToClient(clientId, `: heartbeat ${timestamp}\n\n`)
      }
    }, heartbeatMs)
    heartbeat?.unref?.()
  }

  function stopHeartbeatWhenIdle() {
    if (clients.size !== 0 || !heartbeat) return
    clearIntervalFn(heartbeat)
    heartbeat = null
  }

  async function handle(request, response, handlerOptions = {}) {
    if (closed) {
      throw new RealtimeEventError('Realtime event hub is shutting down.', {
        code: 'REALTIME_HUB_CLOSED',
        statusCode: 503,
      })
    }
    if (clients.size >= maxClients) {
      throw new RealtimeEventError('Realtime connection capacity is temporarily unavailable.', {
        code: 'REALTIME_CAPACITY_EXCEEDED',
        statusCode: 503,
      })
    }
    if (typeof handlerOptions.requireUser !== 'function') {
      throw new RealtimeEventError('Realtime authentication handler is required.', {
        code: 'REALTIME_AUTH_HANDLER_REQUIRED',
        statusCode: 500,
      })
    }
    if (typeof handlerOptions.requirePermission !== 'function') {
      throw new RealtimeEventError('Realtime permission handler is required.', {
        code: 'REALTIME_PERMISSION_HANDLER_REQUIRED',
        statusCode: 500,
      })
    }

    const user = await handlerOptions.requireUser(request)
    handlerOptions.requirePermission(user, handlerOptions.permission || 'view:board')
    if (!responseAvailable(response)) return { connected: false, reason: 'response_closed' }

    response.writeHead(200, defaultHeaders(response, handlerOptions))
    response.flushHeaders?.()
    response.write(`retry: ${retryMs}\n\n`)

    const clientId = randomUUID()
    const client = {
      id: clientId,
      response,
      connectedAt: isoTimestamp(now),
      lastWriteAt: null,
      userId: nullableOpaqueId(user?.id) || 'authenticated-user',
      listeners: [],
    }
    clients.set(clientId, client)

    const cleanup = () => {
      removeClient(clientId)
      stopHeartbeatWhenIdle()
    }
    // IncomingMessage emits `close` once the request side is complete even
    // while the SSE response is intentionally still open. Treat only an
    // aborted/error request or a closed/error response as disconnection.
    for (const [target, eventNames] of [
      [request, ['aborted', 'error']],
      [response, ['close', 'error']],
    ]) {
      for (const eventName of eventNames) {
        if (typeof target?.once === 'function') {
          target.once(eventName, cleanup)
          client.listeners.push([target, eventName, cleanup])
        }
      }
    }

    startHeartbeat()
    const initial = sanitizeRealtimeEvent('sync-required', { reason: 'connected' }, { now })
    writeToClient(clientId, serializeSseEvent(nextEventId(), initial))
    return { connected: true, clientId, user }
  }

  function publish(type, input = {}) {
    if (closed) return { delivered: 0, disconnected: 0, eventId: null }
    const event = sanitizeRealtimeEvent(type, input, { now })
    const eventId = nextEventId()
    const serialized = serializeSseEvent(eventId, event)
    let delivered = 0
    const before = clients.size
    for (const clientId of [...clients.keys()]) {
      if (writeToClient(clientId, serialized)) delivered += 1
    }
    const disconnected = before - clients.size
    if (disconnected > 0) logger.warn('Removed disconnected realtime event clients:', disconnected)
    stopHeartbeatWhenIdle()
    return { delivered, disconnected, eventId, event }
  }

  function getStatus() {
    return {
      closed,
      clients: clients.size,
      maxClients,
      heartbeatMs,
      retryMs,
      sequence,
      replaySupported: false,
    }
  }

  function close() {
    if (closed) return getStatus()
    closed = true
    if (heartbeat) {
      clearIntervalFn(heartbeat)
      heartbeat = null
    }
    for (const [clientId, client] of [...clients.entries()]) {
      try {
        if (responseAvailable(client.response)) {
          client.response.write(': server shutdown\n\n')
          client.response.end()
        }
      } catch (error) {
        logger.error('Realtime event client shutdown failed:', String(error?.message || error).slice(0, 200))
      } finally {
        removeClient(clientId)
      }
    }
    return getStatus()
  }

  return Object.freeze({
    handle,
    publish,
    getStatus,
    close,
  })
}
