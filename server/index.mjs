import { createServer } from 'node:http'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { dirname, extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEnvDefaults } from '../scripts/env-utils.mjs'
import { resolveApiRouteContract } from './api-routes.mjs'
import { getSystemCapabilities } from './capability-service.mjs'
import { loginThrottle, resolveClientIp } from './login-throttle.mjs'
import { createPrismaClient } from './prisma-client.mjs'
import { databaseHealthFailure } from './health-response.mjs'
import { createOpenApiDocument } from './openapi.mjs'
import { listDomainEvents } from './domain-events.mjs'
import { PmsValidationError } from './pms-domain.mjs'
import {
  createMessageDraft,
  createMessageTemplate,
  listMessages,
  listMessageTemplates,
} from './messaging-service.mjs'
import {
  createChannelMapping,
  deleteChannelMapping,
  listChannelMappings,
  updateChannelMapping,
} from './channel-mapping-service.mjs'
import { requestIdFromHeaders, resolveRequestContext } from './request-context.mjs'
import {
  buildRateRecommendation,
  createRateRule,
  getEffectiveRate,
  listRateCalendar,
  listRateRules,
  updateRateRule,
  upsertRateCalendarEntry,
} from './rate-service.mjs'
import {
  getPropertySettings,
  getPropertyStatus,
  updatePropertySettings,
  updatePropertyTaxSettings,
} from './settings-service.mjs'
import {
  assignHousekeepingTask,
  createHousekeepingIssue,
  createHousekeepingTask,
  listHousekeepingIssues,
  listHousekeepingTasks,
  transitionHousekeepingIssue,
  transitionHousekeepingTask,
} from './housekeeping-service.mjs'
import { closeNightAuditBusinessDate, listNightAuditRuns } from './night-audit-service.mjs'
import {
  closeCashShift,
  createAccountingFolio,
  createHouseAccount,
  getAccountingFolioBalance,
  getTrialBalance,
  openCashShift,
  postAccountingCharge,
  postJournalEntry,
  recordAccountingPayment,
  recordAccountsReceivableEntry,
  recordCashMovement,
  reverseAccountingCharge,
  reverseAccountingPayment,
} from './accounting-service.mjs'
import { canViewRoute, requirePermission } from './rbac.mjs'
import { clearSessionCookie, createSessionToken, readSessionCookie, sessionCookie, verifySessionToken } from './security.mjs'
import { envEnabled, requireSetupPermission, setupTokenRequired } from './setup-permission.mjs'
import {
  OPS_WORKER_NONCE_HEADER,
  OPS_WORKER_SIGNATURE_HEADER,
  OPS_WORKER_TIMESTAMP_HEADER,
  verifyOpsWorkerRequest,
} from './ops-worker-auth.mjs'
import { executeSignedOtaWorkerTask } from './ota-adapters/index.mjs'
import { createHotelOpsScanScheduler } from './ops-scheduler.mjs'
import { runDeterministicOpsAnalyzers } from './ops-analyzers.mjs'
import {
  convertPublicHold,
  createPublicHold,
  createPublicQuote,
  getPublicAvailability,
} from './direct-booking-service.mjs'
import {
  emailOpsCommandIntakeStatus,
  processEmailOpsCommandEvents,
} from './email-ops-intake.mjs'
import {
  lineOpsCommandIntakeStatus,
  processLineOpsCommandEvents,
} from './line-ops-intake.mjs'
import {
  extractWhatsAppWebhookMessages,
  processWhatsAppOpsCommandEvents,
  verifyWhatsAppWebhookSignature,
  whatsAppOpsCommandIntakeStatus,
  whatsAppWebhookStatus,
} from './whatsapp-ops-intake.mjs'
import {
  configureIcalFeedChannel,
  deactivateIcalFeedChannel,
  getIcalFeedByToken,
  listIcalFeedChannels,
} from './ical-feed.mjs'
import {
  acknowledgeOpsTrendAlert,
  approveOpsAlertRecommendation,
  approveOpsTask,
  cancelOpsTask,
  denyOpsTask,
  dismissOpsNotification,
  getEmergencyStop,
  getOpsTask,
  getOtaStatus,
  getOpsPolicy,
  listOpsScanSnapshots,
  listOpsNotifications,
  listOpsApprovals,
  listOpsTasks,
  listOpsTrendAlerts,
  readOpsNotification,
  resolveOpsHumanAction,
  resolveOpsTrendAlert,
  runQueuedOpsTask,
  runOpsScan,
  setEmergencyStop,
  submitOpsCommand,
} from './ops-service.mjs'
import {
  assignRoom,
  authenticateUser,
  approveBookingEmailEvent,
  cancelReservation,
  checkInReservation,
  checkOutReservation,
  completeInitialSetup,
  createBookingEmailSource,
  createUser,
  createRoomType,
  createSetupRoom,
  createGuest,
  createCharge,
  createPayment,
  createReservation,
  createWalkInCheckIn,
  getBookingEmailEvent,
  getBookingEmailStatus,
  getAuthenticatedUser,
  getFrontDeskBoard,
  getRoomSetup,
  getSetupStatus,
  getTodayData,
  listBookingEmailEvents,
  listBookingEmailSources,
  listGuests,
  listReservations,
  listRooms,
  listUsers,
  rejectBookingEmailEvent,
  reprocessBookingEmailEvent,
  syncBookingEmail,
  deactivateUser,
  deleteRoomType,
  deleteSetupRoom,
  updateBookingEmailSource,
  updateReservation,
  updateReservationGuest,
  updateGuest,
  updateHousekeepingStatus,
  updateRoomOperationalStatus,
  updateRoomType,
  updateSetupRoom,
  updateUser,
} from './pms-service.mjs'

loadEnvDefaults()

const __dirname = dirname(fileURLToPath(import.meta.url))
const distDir = resolve(__dirname, '..', 'dist')
const port = Number(process.env.PORT || 10000)
const host = process.env.HOST || '0.0.0.0'
const MAX_JSON_BODY_BYTES = 1_000_000
const CORS_ALLOW_METHODS = 'GET,POST,PUT,PATCH,DELETE,OPTIONS'
const CORS_ALLOW_HEADERS = `content-type, authorization, x-setup-token, x-request-id, x-idempotency-key, x-reservation-expected-updated-at, x-reservation-expected-version, x-guest-expected-updated-at, x-guest-expected-version, ${OPS_WORKER_SIGNATURE_HEADER}, ${OPS_WORKER_TIMESTAMP_HEADER}, ${OPS_WORKER_NONCE_HEADER}`
const PRODUCTION = process.env.NODE_ENV === 'production'

let prisma
let opsScanScheduler

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

function firstHeaderValue(value) {
  return Array.isArray(value) ? value[0] : value
}

function normalizeOrigin(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''

  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return ''
    return url.origin
  } catch {
    return ''
  }
}

function configuredAllowedOrigins() {
  const origins = new Set()
  const values = [
    process.env.APP_URL,
    process.env.RENDER_EXTERNAL_URL,
    ...String(process.env.ALLOWED_ORIGINS || '').split(','),
  ]

  for (const value of values) {
    const origin = normalizeOrigin(value)
    if (origin) origins.add(origin)
  }
  return origins
}

const allowedOrigins = configuredAllowedOrigins()

function trustProxyHeaders() {
  return envEnabled(process.env.TRUST_PROXY_HEADERS)
}

function requestOrigin(request) {
  return normalizeOrigin(firstHeaderValue(request.headers.origin))
}

function requestBaseOrigin(request) {
  const configured = normalizeOrigin(process.env.APP_URL || process.env.RENDER_EXTERNAL_URL)
  if (PRODUCTION && configured) return configured

  const forwardedHost = trustProxyHeaders() ? firstHeaderValue(request.headers['x-forwarded-host']) : ''
  const requestHost = forwardedHost || firstHeaderValue(request.headers.host)
  if (!requestHost) return ''

  const forwardedProto = trustProxyHeaders() ? firstHeaderValue(request.headers['x-forwarded-proto']) : ''
  const proto = String(forwardedProto || (process.env.NODE_ENV === 'production' ? 'https' : 'http'))
    .split(',')[0]
    .trim()
  return normalizeOrigin(`${proto}://${requestHost}`)
}

function isLocalDevelopmentOrigin(origin) {
  if (process.env.NODE_ENV === 'production') return false
  try {
    const { hostname } = new URL(origin)
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]'
  } catch {
    return false
  }
}

function corsHeaders(origin) {
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-credentials': 'true',
    vary: 'Origin',
  }
}

function resolveApiOrigin(request) {
  const origin = requestOrigin(request)
  if (!origin) return { ok: true, headers: {} }

  if (origin === requestBaseOrigin(request) || allowedOrigins.has(origin) || isLocalDevelopmentOrigin(origin)) {
    return { ok: true, headers: corsHeaders(origin) }
  }

  return {
    ok: false,
    headers: { vary: 'Origin' },
    statusCode: 403,
    error: 'Origin is not allowed.',
  }
}

function mergeResponseHeaders(response, headers = {}) {
  const cors = response.corsHeaders || {}
  const merged = {
    ...(response.requestId ? { 'x-request-id': response.requestId } : {}),
    ...cors,
    ...headers,
  }

  if (cors.vary && headers.vary && cors.vary !== headers.vary) {
    merged.vary = `${cors.vary}, ${headers.vary}`
  }
  return merged
}

function securityHeaders(headers = {}) {
  return {
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    'content-security-policy': "base-uri 'self'; object-src 'none'; frame-ancestors 'none'",
    ...(PRODUCTION ? { 'strict-transport-security': 'max-age=31536000; includeSubDomains' } : {}),
    ...headers,
  }
}

async function getPrisma() {
  if (!process.env.DATABASE_URL) {
    const error = new Error('DATABASE_URL is not configured.')
    error.statusCode = 503
    throw error
  }

  if (!prisma) {
    prisma = createPrismaClient()
  }
  return prisma
}

function sendJson(response, statusCode, payload, headers = {}) {
  response.writeHead(statusCode, securityHeaders({
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...mergeResponseHeaders(response, headers),
  }))
  response.end(JSON.stringify(payload, (_key, value) => typeof value === 'bigint' ? value.toString() : value))
}

function sendNoContent(response, headers = {}) {
  response.writeHead(204, securityHeaders({
    'cache-control': 'no-store',
    ...mergeResponseHeaders(response, headers),
  }))
  response.end()
}

function sendCalendar(response, contents, fileName) {
  response.writeHead(200, securityHeaders({
    'content-type': 'text/calendar; charset=utf-8',
    'content-disposition': `inline; filename="${String(fileName || 'sandbox-hotel-blocks.ics').replace(/"/g, '')}"`,
    'cache-control': 'no-store',
  }))
  response.end(contents)
}

function startDomainEventStream(request, response, db, context, url) {
  const rawAfter = firstHeaderValue(request.headers['last-event-id']) || url.searchParams.get('after') || '0'
  let after
  try {
    after = BigInt(String(rawAfter))
    if (after < 0n) throw new Error('negative')
  } catch {
    const error = new Error('Last-Event-ID must be a non-negative integer.')
    error.statusCode = 400
    throw error
  }

  response.writeHead(200, securityHeaders({
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-store',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
    ...mergeResponseHeaders(response),
  }))
  response.write(': connected\n\n')

  let closed = false
  let polling = false
  let pollTimer
  let heartbeatTimer
  const cleanup = () => {
    closed = true
    if (pollTimer) clearInterval(pollTimer)
    if (heartbeatTimer) clearInterval(heartbeatTimer)
  }
  request.once('close', cleanup)
  response.once('close', cleanup)

  const poll = async () => {
    if (closed || polling) return
    polling = true
    try {
      const events = await listDomainEvents(db, { propertyId: context.propertyId, after, limit: 100 })
      for (const event of events) {
        after = BigInt(event.id)
        response.write(`id: ${event.id}\n`)
        response.write(`event: ${event.type}\n`)
        response.write(`data: ${JSON.stringify(event)}\n\n`)
      }
    } catch {
      if (!closed) response.write('event: stream_error\ndata: {"retry":true}\n\n')
    } finally {
      polling = false
    }
  }

  pollTimer = setInterval(() => void poll(), 2_000)
  heartbeatTimer = setInterval(() => {
    if (!closed) response.write(': heartbeat\n\n')
  }, 15_000)
  void poll()
}

async function readJson(request) {
  if (!['POST', 'PUT', 'PATCH'].includes(request.method || '')) return {}

  let size = 0
  const chunks = []
  for await (const chunk of request) {
    size += chunk.length
    if (size > MAX_JSON_BODY_BYTES) {
      const error = new Error('Request body is too large.')
      error.statusCode = 413
      throw error
    }
    chunks.push(chunk)
  }

  if (chunks.length === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    const error = new Error('Request body must be valid JSON.')
    error.statusCode = 400
    throw error
  }
}

async function readRawBody(request) {
  let size = 0
  const chunks = []
  for await (const chunk of request) {
    size += chunk.length
    if (size > MAX_JSON_BODY_BYTES) {
      const error = new Error('Request body is too large.')
      error.statusCode = 413
      throw error
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

function publicUser(user) {
  if (!user) return null
  return {
    id: user.id,
    email: user.email || null,
    username: user.username,
    role: user.role,
    displayName: `${user.firstName} ${user.lastName}`.trim(),
    active: user.active,
    lockedAt: user.lockedAt?.toISOString?.() || null,
    createdAt: user.createdAt?.toISOString?.() || null,
  }
}

async function requireUser(request) {
  const session = verifySessionToken(readSessionCookie(request))
  if (!session) {
    const error = new Error('Authentication is required.')
    error.statusCode = 401
    throw error
  }

  const user = await getAuthenticatedUser(await getPrisma(), session)
  if (!user) {
    const error = new Error('Authentication is required.')
    error.statusCode = 401
    throw error
  }
  return user
}

function routeParam(pathname, pattern) {
  const match = pathname.match(pattern)
  return match?.groups || null
}

async function databaseStatus(deep) {
  if (!process.env.DATABASE_URL) {
    return { configured: false, ok: null }
  }

  if (!deep) {
    return { configured: true, ok: null }
  }

  let prisma
  try {
    prisma = createPrismaClient()
    await prisma.$queryRaw`SELECT 1`
    return { configured: true, ok: true }
  } catch {
    return databaseHealthFailure()
  } finally {
    await prisma?.$disconnect?.()
  }
}

async function healthPayload(deep = false) {
  return {
    ok: true,
    service: 'sandbox-hotel-pms',
    environment: process.env.NODE_ENV || 'development',
    timestamp: new Date().toISOString(),
    database: await databaseStatus(deep),
    integrations: {
      lineWebhookConfigured: Boolean(process.env.LINE_CHANNEL_SECRET && process.env.LINE_CHANNEL_ACCESS_TOKEN),
      whatsappWebhookConfigured: whatsAppWebhookStatus(process.env).appSecretConfigured,
      hotelOpsEmailCommandIntake: emailOpsCommandIntakeStatus(process.env),
      hotelOpsWhatsAppCommandIntake: whatsAppOpsCommandIntakeStatus(process.env),
    },
  }
}

async function sendHealth(request, response) {
  const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`)
  sendJson(response, 200, await healthPayload(url.searchParams.get('deep') === '1'))
}

function forbiddenPath(pathname) {
  return pathname.includes('\0') || pathname.split(/[\\/]/).includes('..')
}

async function serveStatic(request, response) {
  const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`)
  const pathname = decodeURIComponent(url.pathname)

  if (forbiddenPath(pathname)) {
    sendJson(response, 403, { ok: false, error: 'Forbidden path' })
    return
  }

  const cleanedPath = normalize(pathname).replace(/^[/\\]+/, '')
  let filePath = resolve(join(distDir, cleanedPath || 'index.html'))

  if (!filePath.startsWith(distDir)) {
    sendJson(response, 403, { ok: false, error: 'Forbidden path' })
    return
  }

  try {
    const fileStat = await stat(filePath)
    if (fileStat.isDirectory()) {
      filePath = join(filePath, 'index.html')
    }
  } catch {
    if (request.method === 'GET' && request.headers.accept?.includes('text/html')) {
      filePath = join(distDir, 'index.html')
    } else {
      sendJson(response, 404, { ok: false, error: 'Not found' })
      return
    }
  }

  try {
    const contentType = mimeTypes[extname(filePath)] || 'application/octet-stream'
    response.writeHead(200, securityHeaders({
      'content-type': contentType,
      'cache-control': filePath.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable',
    }))

    if (request.method === 'HEAD') {
      response.end()
      return
    }

    createReadStream(filePath).pipe(response)
  } catch (error) {
    sendJson(response, 500, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

async function handleLineWebhook(request, response) {
  if (request.method === 'GET') {
    const opsCommandIntake = lineOpsCommandIntakeStatus(process.env)
    sendJson(response, 200, {
      ok: true,
      configured: Boolean(process.env.LINE_CHANNEL_SECRET && process.env.LINE_CHANNEL_ACCESS_TOKEN),
      hotelOpsCommandIntake: {
        enabled: opsCommandIntake.enabled,
        prefix: opsCommandIntake.prefix,
        userMapConfigured: opsCommandIntake.userMapConfigured,
        userMapError: opsCommandIntake.userMapError,
      },
    })
    return
  }

  if (request.method !== 'POST') {
    sendJson(response, 405, { ok: false, error: 'Method not allowed' })
    return
  }

  if (!process.env.LINE_CHANNEL_SECRET) {
    sendJson(response, 503, { ok: false, error: 'LINE_CHANNEL_SECRET is not configured.' })
    return
  }

  const rawBody = await readRawBody(request)
  const providedSignature = String(request.headers['x-line-signature'] || '')
  const expectedSignature = createHmac('sha256', process.env.LINE_CHANNEL_SECRET).update(rawBody).digest('base64')
  const provided = Buffer.from(providedSignature)
  const expected = Buffer.from(expectedSignature)

  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    sendJson(response, 401, { ok: false, error: 'Invalid LINE webhook signature.' })
    return
  }

  let payload
  try {
    payload = JSON.parse(rawBody.toString('utf8'))
  } catch {
    sendJson(response, 400, { ok: false, error: 'Webhook body must be valid JSON.' })
    return
  }

  const events = Array.isArray(payload.events) ? payload.events : []
  const db = await getPrisma()
  const property = await db.property.findUnique({ where: { code: 'SANDBOX' } })
  if (!property) {
    sendJson(response, 503, { ok: false, error: 'Property setup has not been completed yet.' })
    return
  }

  if (events.length > 0) {
    await db.message.createMany({
      data: events.map((event) => ({
        propertyId: property.id,
        recipientId: event.source?.userId || event.source?.groupId || event.source?.roomId || null,
        recipientType: event.source?.type || 'LINE_WEBHOOK',
        channel: 'LINE',
        body: event.message?.text || event.type || 'LINE webhook event',
        status: 'DELIVERED',
        deliveredAt: event.timestamp ? new Date(event.timestamp) : new Date(),
        metadata: event,
      })),
    })
  }

  const opsCommandResults = await processLineOpsCommandEvents(db, events, {
    env: process.env,
    submitCommand: submitOpsCommand,
  })
  const opsAccepted = opsCommandResults.filter((result) => result.status === 'accepted').length

  sendJson(response, 200, {
    ok: true,
    received: events.length,
    hotelOpsCommands: {
      enabled: lineOpsCommandIntakeStatus(process.env).enabled,
      accepted: opsAccepted,
      skipped: opsCommandResults.filter((result) => result.status === 'skipped').length,
    },
  })
}

function sendPlainText(response, statusCode, body) {
  response.writeHead(statusCode, securityHeaders({
    'content-type': 'text/plain; charset=utf-8',
  }))
  response.end(String(body ?? ''))
}

function whatsAppMessageDeliveredAt(event = {}) {
  const timestamp = Number(event.timestamp)
  if (!Number.isFinite(timestamp)) return new Date()
  const milliseconds = timestamp < 10_000_000_000 ? timestamp * 1000 : timestamp
  const date = new Date(milliseconds)
  return Number.isNaN(date.getTime()) ? new Date() : date
}

async function handleWhatsAppWebhook(request, response, url) {
  if (request.method === 'GET') {
    const mode = url.searchParams.get('hub.mode')
    const token = url.searchParams.get('hub.verify_token')
    const challenge = url.searchParams.get('hub.challenge')
    if (mode === 'subscribe') {
      const expectedToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || process.env.WHATSAPP_VERIFY_TOKEN
      if (!expectedToken) {
        sendJson(response, 503, { ok: false, error: 'WHATSAPP_WEBHOOK_VERIFY_TOKEN is not configured.' })
        return
      }
      if (token !== expectedToken) {
        sendJson(response, 403, { ok: false, error: 'Invalid WhatsApp webhook verify token.' })
        return
      }
      sendPlainText(response, 200, challenge || '')
      return
    }

    const webhook = whatsAppWebhookStatus(process.env)
    const opsCommandIntake = whatsAppOpsCommandIntakeStatus(process.env)
    sendJson(response, 200, {
      ok: true,
      configured: webhook.appSecretConfigured && webhook.verifyTokenConfigured,
      webhook,
      hotelOpsCommandIntake: {
        enabled: opsCommandIntake.enabled,
        prefix: opsCommandIntake.prefix,
        userMapConfigured: opsCommandIntake.userMapConfigured,
        userMapError: opsCommandIntake.userMapError,
      },
    })
    return
  }

  if (request.method !== 'POST') {
    sendJson(response, 405, { ok: false, error: 'Method not allowed' })
    return
  }

  const rawBody = await readRawBody(request)
  const signatureCheck = verifyWhatsAppWebhookSignature(rawBody, request.headers['x-hub-signature-256'], process.env)
  if (!signatureCheck.ok) {
    sendJson(response, signatureCheck.statusCode || 401, { ok: false, error: signatureCheck.error || 'Invalid WhatsApp webhook signature.' })
    return
  }

  let payload
  try {
    payload = JSON.parse(rawBody.toString('utf8'))
  } catch {
    sendJson(response, 400, { ok: false, error: 'Webhook body must be valid JSON.' })
    return
  }

  const events = extractWhatsAppWebhookMessages(payload)
  const db = await getPrisma()
  const property = await db.property.findUnique({ where: { code: 'SANDBOX' } })
  if (!property) {
    sendJson(response, 503, { ok: false, error: 'Property setup has not been completed yet.' })
    return
  }

  if (events.length > 0) {
    await db.message.createMany({
      data: events.map((event) => ({
        propertyId: property.id,
        recipientId: event.senderId,
        recipientType: 'WHATSAPP_WEBHOOK',
        channel: 'WHATSAPP',
        body: event.text || event.type || 'WhatsApp webhook event',
        status: 'DELIVERED',
        deliveredAt: whatsAppMessageDeliveredAt(event),
        metadata: {
          provider: event.provider,
          messageId: event.messageId,
          senderId: event.senderId,
          contactName: event.contactName,
          metadataPhoneNumberId: event.metadataPhoneNumberId,
          raw: event.raw,
        },
      })),
    })
  }

  const opsCommandResults = await processWhatsAppOpsCommandEvents(db, events, {
    env: process.env,
    submitCommand: submitOpsCommand,
  })
  const opsAccepted = opsCommandResults.filter((result) => result.status === 'accepted').length

  sendJson(response, 200, {
    ok: true,
    received: events.length,
    hotelOpsCommands: {
      enabled: whatsAppOpsCommandIntakeStatus(process.env).enabled,
      accepted: opsAccepted,
      skipped: opsCommandResults.filter((result) => result.status === 'skipped').length,
      errors: opsCommandResults.filter((result) => result.status === 'error').length,
    },
  })
}

async function handleApi(request, response, url) {
  const routeContract = resolveApiRouteContract(url.pathname)
  if (!routeContract) return false

  if (!routeContract.methods.includes(request.method || '')) {
    sendJson(response, 405, { ok: false, error: 'Method not allowed' }, { allow: routeContract.allow })
    return true
  }

  if (request.method === 'OPTIONS') {
    sendNoContent(response)
    return true
  }

  if (url.pathname === '/api/internal/ops/worker/tasks' && request.method === 'POST') {
    const rawBody = await readRawBody(request)
    const workerAuth = verifyOpsWorkerRequest({ body: rawBody, headers: request.headers })
    if (!workerAuth.ok) {
      sendJson(response, workerAuth.statusCode || 401, { ok: false, error: workerAuth.error || 'Signed OTA worker request is required.' })
      return true
    }

    let payload
    try {
      payload = JSON.parse(rawBody.toString('utf8'))
    } catch {
      sendJson(response, 400, { ok: false, error: 'Worker request body must be valid JSON.' })
      return true
    }

    sendJson(response, 200, {
      ok: true,
      data: await executeSignedOtaWorkerTask(payload),
      message: 'Signed Hotel Ops worker request accepted in dry-run worker mode.',
    })
    return true
  }

  const db = await getPrisma()

  if (url.pathname === '/api/public/v1/availability' && request.method === 'GET') {
    const propertyCode = url.searchParams.get('propertyCode') || 'SANDBOX'
    sendJson(response, 200, {
      ok: true,
      data: await getPublicAvailability(db, {
        propertyCode,
        checkIn: url.searchParams.get('checkIn'),
        checkOut: url.searchParams.get('checkOut'),
        adults: url.searchParams.has('adults') ? Number(url.searchParams.get('adults')) : 1,
        children: url.searchParams.has('children') ? Number(url.searchParams.get('children')) : 0,
        ...(url.searchParams.get('roomTypeCode') ? { roomTypeCode: url.searchParams.get('roomTypeCode') } : {}),
      }),
    })
    return true
  }

  if (url.pathname === '/api/public/v1/quotes' && request.method === 'POST') {
    sendJson(response, 201, {
      ok: true,
      data: await createPublicQuote(db, await readJson(request), {
        idempotencyKey: request.headers['x-idempotency-key'],
      }),
      message: 'Immutable booking quote created.',
    })
    return true
  }

  if (url.pathname === '/api/public/v1/holds' && request.method === 'POST') {
    sendJson(response, 201, {
      ok: true,
      data: await createPublicHold(db, await readJson(request), {
        idempotencyKey: request.headers['x-idempotency-key'],
      }),
      message: 'Inventory hold created for 15 minutes.',
    })
    return true
  }

  if (url.pathname === '/api/public/v1/bookings' && request.method === 'POST') {
    sendJson(response, 201, {
      ok: true,
      data: await convertPublicHold(db, await readJson(request), {
        idempotencyKey: request.headers['x-idempotency-key'],
      }),
      message: 'Direct booking created.',
    })
    return true
  }

  if (url.pathname === '/api/auth/login' && request.method === 'POST') {
    const body = await readJson(request)
    const identity = body.identity || body.username || body.email
    const loginIdentity = {
      email: identity,
      ip: resolveClientIp(request),
    }
    const throttleCheck = loginThrottle.check(loginIdentity)
    if (!throttleCheck.allowed) {
      sendJson(
        response,
        429,
        { ok: false, error: 'Too many login attempts. Try again later.' },
        { 'retry-after': String(throttleCheck.retryAfterSeconds) },
      )
      return true
    }

    const user = await authenticateUser(db, identity, body.password)
    if (!user) {
      const failure = loginThrottle.recordFailure(loginIdentity)
      if (!failure.allowed) {
        sendJson(
          response,
          429,
          { ok: false, error: 'Too many login attempts. Try again later.' },
          { 'retry-after': String(failure.retryAfterSeconds) },
        )
        return true
      }
      sendJson(response, 401, { ok: false, error: 'Invalid username/email or password.' })
      return true
    }
    const propertyContext = await resolveRequestContext(db, user, request)
    loginThrottle.recordSuccess(loginIdentity)
    const token = createSessionToken(propertyContext.actor)
    sendJson(response, 200, { ok: true, user: publicUser(propertyContext.actor) }, { 'set-cookie': sessionCookie(token) })
    return true
  }

  if (url.pathname === '/api/auth/logout' && request.method === 'POST') {
    sendJson(response, 200, { ok: true }, { 'set-cookie': clearSessionCookie() })
    return true
  }

  if (url.pathname === '/api/auth/me' && request.method === 'GET') {
    const user = await requireUser(request)
    const propertyContext = await resolveRequestContext(db, user, request)
    sendJson(response, 200, { ok: true, user: publicUser(propertyContext.actor) })
    return true
  }

  if (url.pathname === '/api/setup/status' && request.method === 'GET') {
    sendJson(response, 200, {
      ok: true,
      data: {
        ...(await getSetupStatus(db)),
        setupTokenRequired: setupTokenRequired(),
      },
    })
    return true
  }

  if (url.pathname === '/api/setup/complete' && request.method === 'POST') {
    requireSetupPermission(request)
    const result = await completeInitialSetup(db, await readJson(request))
    sendJson(response, 201, {
      ok: true,
      data: {
        propertyId: result.property.id,
        propertyName: result.property.name,
        adminEmail: result.admin.email,
      },
    })
    return true
  }

  const authenticatedUser = await requireUser(request)
  const context = await resolveRequestContext(db, authenticatedUser, request)
  const user = context.actor
  request.pmsContext = context

  if (url.pathname === '/api/openapi.json' && request.method === 'GET') {
    sendJson(response, 200, createOpenApiDocument({ serverUrl: requestBaseOrigin(request) }))
    return true
  }

  if (url.pathname === '/api/system/capabilities' && request.method === 'GET') {
    requirePermission(user, 'view:board')
    sendJson(response, 200, { ok: true, data: getSystemCapabilities(process.env) })
    return true
  }

  if (url.pathname === '/api/messages' && request.method === 'GET') {
    requirePermission(user, 'view:messaging')
    sendJson(response, 200, { ok: true, data: await listMessages(db, context) })
    return true
  }

  if (url.pathname === '/api/messages' && request.method === 'POST') {
    requirePermission(user, 'send:guest-messages')
    sendJson(response, 201, {
      ok: true,
      data: await createMessageDraft(db, context, await readJson(request)),
      message: 'Message draft saved. No provider delivery was attempted.',
    })
    return true
  }

  if (url.pathname === '/api/message-templates' && request.method === 'GET') {
    requirePermission(user, 'view:messaging')
    sendJson(response, 200, { ok: true, data: await listMessageTemplates(db, context) })
    return true
  }

  if (url.pathname === '/api/message-templates' && request.method === 'POST') {
    requirePermission(user, 'send:guest-messages')
    sendJson(response, 201, { ok: true, data: await createMessageTemplate(db, context, await readJson(request)), message: 'Message template saved.' })
    return true
  }

  if (url.pathname === '/api/channels/mappings' && request.method === 'GET') {
    requirePermission(user, 'view:channels')
    sendJson(response, 200, { ok: true, data: await listChannelMappings(db, context) })
    return true
  }

  if (url.pathname === '/api/channels/mappings' && request.method === 'POST') {
    requirePermission(user, 'manage:channels')
    sendJson(response, 201, { ok: true, data: await createChannelMapping(db, context, await readJson(request)), message: 'Channel mapping saved.' })
    return true
  }

  let channelMappingParams = routeParam(url.pathname, /^\/api\/channels\/mappings\/(?<id>[^/]+)$/)
  if (channelMappingParams && request.method === 'PATCH') {
    requirePermission(user, 'manage:channels')
    sendJson(response, 200, { ok: true, data: await updateChannelMapping(db, context, channelMappingParams.id, await readJson(request)), message: 'Channel mapping updated.' })
    return true
  }

  if (channelMappingParams && request.method === 'DELETE') {
    requirePermission(user, 'manage:channels')
    sendJson(response, 200, {
      ok: true,
      data: await deleteChannelMapping(db, context, channelMappingParams.id, { reason: url.searchParams.get('reason') }),
      message: 'Channel mapping deleted.',
    })
    return true
  }

  if (url.pathname === '/api/events' && request.method === 'GET') {
    requirePermission(user, 'view:board')
    if (String(process.env.SSE_ENABLED ?? 'true').toLowerCase() === 'false') {
      const error = new Error('Operational event streaming is disabled.')
      error.statusCode = 503
      throw error
    }
    startDomainEventStream(request, response, db, context, url)
    return true
  }

  if (url.pathname === '/api/rates/rules' && request.method === 'GET') {
    requirePermission(user, 'view:rates')
    const active = url.searchParams.get('active')
    sendJson(response, 200, {
      ok: true,
      data: await listRateRules(db, context, {
        ...(url.searchParams.get('roomTypeId') ? { roomTypeId: url.searchParams.get('roomTypeId') } : {}),
        ...(url.searchParams.get('date') ? { date: url.searchParams.get('date') } : {}),
        ...(active === 'true' || active === 'false' ? { active: active === 'true' } : {}),
      }),
    })
    return true
  }

  if (url.pathname === '/api/rates/rules' && request.method === 'POST') {
    requirePermission(user, 'edit:rates')
    sendJson(response, 201, { ok: true, data: await createRateRule(db, context, await readJson(request)), message: 'Rate rule created.' })
    return true
  }

  let rateParams = routeParam(url.pathname, /^\/api\/rates\/rules\/(?<id>[^/]+)$/)
  if (rateParams && request.method === 'PATCH') {
    requirePermission(user, 'edit:rates')
    sendJson(response, 200, { ok: true, data: await updateRateRule(db, context, { ...(await readJson(request)), ruleId: rateParams.id }), message: 'Rate rule updated.' })
    return true
  }

  if (url.pathname === '/api/rates/calendar' && request.method === 'GET') {
    requirePermission(user, 'view:rates')
    sendJson(response, 200, {
      ok: true,
      data: await listRateCalendar(db, context, {
        ...(url.searchParams.get('roomTypeId') ? { roomTypeId: url.searchParams.get('roomTypeId') } : {}),
        startDate: url.searchParams.get('startDate'),
        endDate: url.searchParams.get('endDate'),
      }),
    })
    return true
  }

  if (url.pathname === '/api/rates/calendar' && request.method === 'PUT') {
    requirePermission(user, 'edit:rates')
    sendJson(response, 200, { ok: true, data: await upsertRateCalendarEntry(db, context, await readJson(request)), message: 'Rate calendar entry saved.' })
    return true
  }

  if (url.pathname === '/api/rates/effective' && request.method === 'GET') {
    requirePermission(user, 'view:rates')
    sendJson(response, 200, {
      ok: true,
      data: await getEffectiveRate(db, context, {
        roomTypeId: url.searchParams.get('roomTypeId'),
        date: url.searchParams.get('date'),
        ...(url.searchParams.get('stayLength') ? { stayLength: Number(url.searchParams.get('stayLength')) } : {}),
        isArrivalDate: url.searchParams.get('isArrivalDate') === 'true',
        isDepartureDate: url.searchParams.get('isDepartureDate') === 'true',
      }),
    })
    return true
  }

  if (url.pathname === '/api/rates/recommendations' && request.method === 'POST') {
    requirePermission(user, 'view:rates')
    sendJson(response, 200, { ok: true, data: await buildRateRecommendation(db, context, await readJson(request)), message: 'Suggest-only rate recommendation generated.' })
    return true
  }

  if (url.pathname === '/api/settings/property' && request.method === 'GET') {
    requirePermission(user, 'view:settings')
    sendJson(response, 200, { ok: true, data: await getPropertySettings(db, context) })
    return true
  }

  if (url.pathname === '/api/settings/property' && request.method === 'PATCH') {
    requirePermission(user, 'edit:settings')
    sendJson(response, 200, { ok: true, data: await updatePropertySettings(db, context, await readJson(request)), message: 'Property settings updated.' })
    return true
  }

  if (url.pathname === '/api/settings/tax' && request.method === 'PUT') {
    requirePermission(user, 'edit:settings')
    sendJson(response, 200, { ok: true, data: await updatePropertyTaxSettings(db, context, await readJson(request)), message: 'Tax settings updated.' })
    return true
  }

  if (url.pathname === '/api/settings/status' && request.method === 'GET') {
    requirePermission(user, 'view:settings')
    sendJson(response, 200, { ok: true, data: await getPropertyStatus(db, context, process.env) })
    return true
  }

  if (url.pathname === '/api/housekeeping/tasks' && request.method === 'GET') {
    requirePermission(user, 'view:housekeeping')
    sendJson(response, 200, {
      ok: true,
      data: await listHousekeepingTasks(db, context, {
        ...(url.searchParams.get('status') ? { status: url.searchParams.get('status') } : {}),
        ...(url.searchParams.get('roomId') ? { roomId: url.searchParams.get('roomId') } : {}),
        ...(url.searchParams.get('assignedToUserId') ? { assignedToUserId: url.searchParams.get('assignedToUserId') } : {}),
        ...(url.searchParams.get('scheduledFor') ? { scheduledFor: url.searchParams.get('scheduledFor') } : {}),
        ...(url.searchParams.get('limit') ? { limit: Number(url.searchParams.get('limit')) } : {}),
      }),
    })
    return true
  }

  if (url.pathname === '/api/housekeeping/tasks' && request.method === 'POST') {
    requirePermission(user, 'view:housekeeping')
    sendJson(response, 201, { ok: true, data: await createHousekeepingTask(db, context, await readJson(request)), message: 'Housekeeping task created.' })
    return true
  }

  let housekeepingParams = routeParam(url.pathname, /^\/api\/housekeeping\/tasks\/(?<id>[^/]+)\/assign$/)
  if (housekeepingParams && request.method === 'POST') {
    requirePermission(user, 'view:housekeeping')
    sendJson(response, 200, { ok: true, data: await assignHousekeepingTask(db, context, { ...(await readJson(request)), taskId: housekeepingParams.id }), message: 'Housekeeping assignment updated.' })
    return true
  }

  housekeepingParams = routeParam(url.pathname, /^\/api\/housekeeping\/tasks\/(?<id>[^/]+)\/status$/)
  if (housekeepingParams && request.method === 'POST') {
    requirePermission(user, 'view:housekeeping')
    sendJson(response, 200, { ok: true, data: await transitionHousekeepingTask(db, context, { ...(await readJson(request)), taskId: housekeepingParams.id }), message: 'Housekeeping task status updated.' })
    return true
  }

  if (url.pathname === '/api/housekeeping/issues' && request.method === 'GET') {
    requirePermission(user, 'view:housekeeping')
    sendJson(response, 200, {
      ok: true,
      data: await listHousekeepingIssues(db, context, {
        ...(url.searchParams.get('status') ? { status: url.searchParams.get('status') } : {}),
        ...(url.searchParams.get('severity') ? { severity: url.searchParams.get('severity') } : {}),
        ...(url.searchParams.get('roomId') ? { roomId: url.searchParams.get('roomId') } : {}),
        ...(url.searchParams.get('limit') ? { limit: Number(url.searchParams.get('limit')) } : {}),
      }),
    })
    return true
  }

  if (url.pathname === '/api/housekeeping/issues' && request.method === 'POST') {
    requirePermission(user, 'view:housekeeping')
    sendJson(response, 201, { ok: true, data: await createHousekeepingIssue(db, context, await readJson(request)), message: 'Housekeeping issue created.' })
    return true
  }

  housekeepingParams = routeParam(url.pathname, /^\/api\/housekeeping\/issues\/(?<id>[^/]+)\/status$/)
  if (housekeepingParams && request.method === 'POST') {
    requirePermission(user, 'view:housekeeping')
    sendJson(response, 200, { ok: true, data: await transitionHousekeepingIssue(db, context, { ...(await readJson(request)), issueId: housekeepingParams.id }), message: 'Housekeeping issue status updated.' })
    return true
  }

  if (url.pathname === '/api/night-audit/runs' && request.method === 'GET') {
    requirePermission(user, 'view:night-audit')
    sendJson(response, 200, { ok: true, data: await listNightAuditRuns(db, context, { ...(url.searchParams.get('limit') ? { limit: Number(url.searchParams.get('limit')) } : {}) }) })
    return true
  }

  if (url.pathname === '/api/night-audit/close' && request.method === 'POST') {
    requirePermission(user, 'run:night-audit')
    sendJson(response, 200, { ok: true, data: await closeNightAuditBusinessDate(db, context, await readJson(request)), message: 'Night audit attempt recorded.' })
    return true
  }

  if (url.pathname === '/api/accounting/v2/folios' && request.method === 'POST') {
    requirePermission(user, 'post:charges')
    sendJson(response, 201, { ok: true, data: await createAccountingFolio(db, await readJson(request), context), message: 'Accounting folio created.' })
    return true
  }

  let accountingParams = routeParam(url.pathname, /^\/api\/accounting\/v2\/folios\/(?<id>[^/]+)\/balance$/)
  if (accountingParams && request.method === 'GET') {
    requirePermission(user, 'view:cashier')
    sendJson(response, 200, { ok: true, data: await getAccountingFolioBalance(db, accountingParams.id, context) })
    return true
  }

  if (url.pathname === '/api/accounting/v2/charges' && request.method === 'POST') {
    requirePermission(user, 'post:charges')
    sendJson(response, 201, { ok: true, data: await postAccountingCharge(db, await readJson(request), context), message: 'Accounting charge posted.' })
    return true
  }

  accountingParams = routeParam(url.pathname, /^\/api\/accounting\/v2\/charges\/(?<id>[^/]+)\/reverse$/)
  if (accountingParams && request.method === 'POST') {
    requirePermission(user, 'post:charges')
    sendJson(response, 201, { ok: true, data: await reverseAccountingCharge(db, { ...(await readJson(request)), chargeId: accountingParams.id }, context), message: 'Accounting charge reversed with an append-only entry.' })
    return true
  }

  if (url.pathname === '/api/accounting/v2/payments' && request.method === 'POST') {
    requirePermission(user, 'process:payment')
    sendJson(response, 201, { ok: true, data: await recordAccountingPayment(db, await readJson(request), context), message: 'Accounting payment recorded.' })
    return true
  }

  accountingParams = routeParam(url.pathname, /^\/api\/accounting\/v2\/payments\/(?<id>[^/]+)\/reverse$/)
  if (accountingParams && request.method === 'POST') {
    requirePermission(user, 'refund:payment')
    sendJson(response, 201, { ok: true, data: await reverseAccountingPayment(db, { ...(await readJson(request)), paymentId: accountingParams.id }, context), message: 'Payment refund or reversal recorded append-only.' })
    return true
  }

  if (url.pathname === '/api/accounting/v2/cash-shifts' && request.method === 'POST') {
    requirePermission(user, 'process:payment')
    sendJson(response, 201, { ok: true, data: await openCashShift(db, await readJson(request), context), message: 'Cash shift opened.' })
    return true
  }

  accountingParams = routeParam(url.pathname, /^\/api\/accounting\/v2\/cash-shifts\/(?<id>[^/]+)\/movements$/)
  if (accountingParams && request.method === 'POST') {
    requirePermission(user, 'process:payment')
    sendJson(response, 201, { ok: true, data: await recordCashMovement(db, { ...(await readJson(request)), cashShiftId: accountingParams.id }, context), message: 'Cash movement recorded.' })
    return true
  }

  accountingParams = routeParam(url.pathname, /^\/api\/accounting\/v2\/cash-shifts\/(?<id>[^/]+)\/close$/)
  if (accountingParams && request.method === 'POST') {
    requirePermission(user, 'process:payment')
    sendJson(response, 200, { ok: true, data: await closeCashShift(db, { ...(await readJson(request)), cashShiftId: accountingParams.id }, context), message: 'Cash shift closed and reconciled.' })
    return true
  }

  if (url.pathname === '/api/accounting/v2/house-accounts' && request.method === 'POST') {
    requirePermission(user, 'view:financial-reports')
    sendJson(response, 201, { ok: true, data: await createHouseAccount(db, await readJson(request), context), message: 'House account created.' })
    return true
  }

  if (url.pathname === '/api/accounting/v2/receivables' && request.method === 'POST') {
    requirePermission(user, 'view:financial-reports')
    sendJson(response, 201, { ok: true, data: await recordAccountsReceivableEntry(db, await readJson(request), context), message: 'Accounts receivable entry recorded.' })
    return true
  }

  if (url.pathname === '/api/accounting/v2/journals' && request.method === 'POST') {
    requirePermission(user, 'view:financial-reports')
    sendJson(response, 201, { ok: true, data: await postJournalEntry(db, await readJson(request), context), message: 'Balanced journal entry posted.' })
    return true
  }

  if (url.pathname === '/api/accounting/v2/trial-balance' && request.method === 'GET') {
    requirePermission(user, 'view:financial-reports')
    sendJson(response, 200, { ok: true, data: await getTrialBalance(db, { from: url.searchParams.get('from'), to: url.searchParams.get('to') }, context) })
    return true
  }

  if (url.pathname === '/api/auth/can-view' && request.method === 'GET') {
    sendJson(response, 200, { ok: true, allowed: canViewRoute(user, url.searchParams.get('route')) })
    return true
  }

  if (url.pathname === '/api/ops/commands' && request.method === 'POST') {
    requirePermission(user, 'create:ops-task')
    const result = await submitOpsCommand(db, await readJson(request), user)
    sendJson(response, result.duplicate ? 200 : 201, { ok: true, data: result, message: result.duplicate ? 'Duplicate command returned existing Hotel Ops task.' : 'Hotel Ops command accepted.' })
    return true
  }

  if (url.pathname === '/api/ops/tasks' && request.method === 'GET') {
    requirePermission(user, 'view:ops')
    sendJson(response, 200, {
      ok: true,
      data: await listOpsTasks(db, {
        status: url.searchParams.get('status'),
        limit: url.searchParams.get('limit'),
      }),
    })
    return true
  }

  let opsParams = routeParam(url.pathname, /^\/api\/ops\/tasks\/(?<id>[^/]+)$/)
  if (opsParams && request.method === 'GET') {
    requirePermission(user, 'view:ops')
    sendJson(response, 200, { ok: true, data: await getOpsTask(db, opsParams.id) })
    return true
  }

  opsParams = routeParam(url.pathname, /^\/api\/ops\/tasks\/(?<id>[^/]+)\/approve$/)
  if (opsParams && request.method === 'POST') {
    requirePermission(user, 'approve:ops-task')
    sendJson(response, 200, { ok: true, data: await approveOpsTask(db, opsParams.id, await readJson(request), user), message: 'Hotel Ops task approved.' })
    return true
  }

  opsParams = routeParam(url.pathname, /^\/api\/ops\/tasks\/(?<id>[^/]+)\/deny$/)
  if (opsParams && request.method === 'POST') {
    requirePermission(user, 'approve:ops-task')
    sendJson(response, 200, { ok: true, data: await denyOpsTask(db, opsParams.id, await readJson(request), user), message: 'Hotel Ops task denied.' })
    return true
  }

  opsParams = routeParam(url.pathname, /^\/api\/ops\/tasks\/(?<id>[^/]+)\/cancel$/)
  if (opsParams && request.method === 'POST') {
    requirePermission(user, 'create:ops-task')
    sendJson(response, 200, { ok: true, data: await cancelOpsTask(db, opsParams.id, await readJson(request), user), message: 'Hotel Ops task cancelled.' })
    return true
  }

  opsParams = routeParam(url.pathname, /^\/api\/ops\/tasks\/(?<id>[^/]+)\/run$/)
  if (opsParams && request.method === 'POST') {
    requirePermission(user, 'create:ops-task')
    await readJson(request)
    sendJson(response, 200, { ok: true, data: await runQueuedOpsTask(db, opsParams.id, user), message: 'Hotel Ops queued task ran through the signed worker.' })
    return true
  }

  opsParams = routeParam(url.pathname, /^\/api\/ops\/tasks\/(?<id>[^/]+)\/resolve-human$/)
  if (opsParams && request.method === 'POST') {
    requirePermission(user, 'create:ops-task')
    sendJson(response, 200, { ok: true, data: await resolveOpsHumanAction(db, opsParams.id, await readJson(request), user), message: 'Human action recorded and Hotel Ops task requeued.' })
    return true
  }

  if (url.pathname === '/api/ops/approvals' && request.method === 'GET') {
    requirePermission(user, 'approve:ops-task')
    sendJson(response, 200, { ok: true, data: await listOpsApprovals(db) })
    return true
  }

  if (url.pathname === '/api/ops/notifications' && request.method === 'GET') {
    requirePermission(user, 'view:ops')
    sendJson(response, 200, {
      ok: true,
      data: await listOpsNotifications(db, {
        status: url.searchParams.get('status'),
        channel: url.searchParams.get('channel'),
        dismissed: url.searchParams.get('dismissed'),
        limit: url.searchParams.get('limit'),
      }),
    })
    return true
  }

  opsParams = routeParam(url.pathname, /^\/api\/ops\/notifications\/(?<id>[^/]+)\/read$/)
  if (opsParams && request.method === 'POST') {
    requirePermission(user, 'view:ops')
    sendJson(response, 200, { ok: true, data: await readOpsNotification(db, opsParams.id, user), message: 'Hotel Ops notification marked read.' })
    return true
  }

  opsParams = routeParam(url.pathname, /^\/api\/ops\/notifications\/(?<id>[^/]+)\/dismiss$/)
  if (opsParams && request.method === 'POST') {
    requirePermission(user, 'view:ops')
    sendJson(response, 200, { ok: true, data: await dismissOpsNotification(db, opsParams.id, user), message: 'Hotel Ops notification dismissed.' })
    return true
  }

  if (url.pathname === '/api/ops/intelligence/alerts' && request.method === 'GET') {
    requirePermission(user, 'view:ops')
    sendJson(response, 200, {
      ok: true,
      data: await listOpsTrendAlerts(db, {
        status: url.searchParams.get('status'),
        limit: url.searchParams.get('limit'),
      }),
    })
    return true
  }

  if (url.pathname === '/api/ops/intelligence/scans' && request.method === 'GET') {
    requirePermission(user, 'view:ops')
    sendJson(response, 200, {
      ok: true,
      data: await listOpsScanSnapshots(db, {
        sourceChannel: url.searchParams.get('sourceChannel'),
        force: url.searchParams.get('force'),
        limit: url.searchParams.get('limit'),
      }),
    })
    return true
  }

  opsParams = routeParam(url.pathname, /^\/api\/ops\/intelligence\/alerts\/(?<id>[^/]+)\/approve-recommendation$/)
  if (opsParams && request.method === 'POST') {
    requirePermission(user, 'approve:ops-task')
    sendJson(response, 201, { ok: true, data: await approveOpsAlertRecommendation(db, opsParams.id, await readJson(request), user), message: 'Recommendation converted into an approval-gated task.' })
    return true
  }

  opsParams = routeParam(url.pathname, /^\/api\/ops\/intelligence\/alerts\/(?<id>[^/]+)\/acknowledge$/)
  if (opsParams && request.method === 'POST') {
    requirePermission(user, 'create:ops-task')
    sendJson(response, 200, { ok: true, data: await acknowledgeOpsTrendAlert(db, opsParams.id, await readJson(request), user), message: 'Hotel Ops alert acknowledged.' })
    return true
  }

  opsParams = routeParam(url.pathname, /^\/api\/ops\/intelligence\/alerts\/(?<id>[^/]+)\/resolve$/)
  if (opsParams && request.method === 'POST') {
    requirePermission(user, 'create:ops-task')
    sendJson(response, 200, { ok: true, data: await resolveOpsTrendAlert(db, opsParams.id, await readJson(request), user), message: 'Hotel Ops alert resolved.' })
    return true
  }

  if (url.pathname === '/api/ops/emergency-stop' && request.method === 'GET') {
    requirePermission(user, 'view:ops')
    sendJson(response, 200, { ok: true, data: await getEmergencyStop(db) })
    return true
  }

  if (url.pathname === '/api/ops/emergency-stop' && request.method === 'POST') {
    requirePermission(user, 'manage:ops-settings')
    sendJson(response, 200, { ok: true, data: await setEmergencyStop(db, await readJson(request), user), message: 'Hotel Ops emergency stop updated.' })
    return true
  }

  if (url.pathname === '/api/ops/ota/status' && request.method === 'GET') {
    requirePermission(user, 'view:ops')
    sendJson(response, 200, { ok: true, data: await getOtaStatus(db, { schedulerStatus: opsScanScheduler?.getStatus() }) })
    return true
  }

  if (url.pathname === '/api/ops/policy' && request.method === 'GET') {
    requirePermission(user, 'view:ops')
    sendJson(response, 200, { ok: true, data: getOpsPolicy() })
    return true
  }

  if (url.pathname === '/api/ops/scan/run' && request.method === 'POST') {
    requirePermission(user, 'create:ops-task')
    sendJson(response, 201, { ok: true, data: await runOpsScan(db, await readJson(request), user), message: 'Hotel Ops scan completed.' })
    return true
  }

  if (url.pathname === '/api/users' && request.method === 'GET') {
    requirePermission(user, 'manage:users')
    sendJson(response, 200, { ok: true, data: (await listUsers(db)).map(publicUser) })
    return true
  }

  if (url.pathname === '/api/users' && request.method === 'POST') {
    requirePermission(user, 'manage:users')
    const createdUser = await createUser(db, await readJson(request), user)
    sendJson(response, 201, { ok: true, data: publicUser(createdUser), message: `User ${createdUser.username} created.` })
    return true
  }

  let userParams = routeParam(url.pathname, /^\/api\/users\/(?<id>[^/]+)$/)
  if (userParams && request.method === 'PATCH') {
    requirePermission(user, 'manage:users')
    const updatedUser = await updateUser(db, userParams.id, await readJson(request), user)
    sendJson(response, 200, { ok: true, data: publicUser(updatedUser), message: `User ${updatedUser.username} updated.` })
    return true
  }

  if (userParams && request.method === 'DELETE') {
    requirePermission(user, 'manage:users')
    const deactivatedUser = await deactivateUser(db, userParams.id, user)
    sendJson(response, 200, { ok: true, data: publicUser(deactivatedUser), message: `User ${deactivatedUser.username} deactivated.` })
    return true
  }

  if (url.pathname === '/api/today' && request.method === 'GET') {
    requirePermission(user, 'view:board')
    sendJson(response, 200, { ok: true, data: await getTodayData(db, user) })
    return true
  }

  if (url.pathname === '/api/front-desk/board' && request.method === 'GET') {
    requirePermission(user, 'view:board')
    sendJson(response, 200, {
      ok: true,
      data: await getFrontDeskBoard(db, user, {
        from: url.searchParams.get('from'),
        to: url.searchParams.get('to'),
      }),
    })
    return true
  }

  if (url.pathname === '/api/front-desk/walk-in' && request.method === 'POST') {
    requirePermission(user, 'create:reservation')
    requirePermission(user, 'check-in:guest')
    const body = await readJson(request)
    const reservation = await createWalkInCheckIn(db, body.payment ? {
      ...body,
      payment: {
        ...body.payment,
        idempotencyKey: body.payment.idempotencyKey || context.idempotencyKey,
      },
    } : body, user)
    sendJson(response, 201, { ok: true, data: reservation, message: `Walk-in checked in to Room ${reservation.assignedRoom?.number}.` })
    return true
  }

  if (url.pathname === '/api/booking-email/status' && request.method === 'GET') {
    requirePermission(user, 'view:reservations')
    sendJson(response, 200, { ok: true, data: await getBookingEmailStatus(db, user) })
    return true
  }

  if (url.pathname === '/api/booking-email/sync' && request.method === 'POST') {
    requirePermission(user, 'edit:reservation')
    const result = await syncBookingEmail(db, await readJson(request), user)
    const opsCommandResults = await processEmailOpsCommandEvents(db, result.opsCommandEvents || result.events, {
      env: process.env,
      submitCommand: submitOpsCommand,
    })
    sendJson(response, 200, {
      ok: true,
      data: result.status,
      events: result.events,
      hotelOpsCommands: {
        enabled: emailOpsCommandIntakeStatus(process.env).enabled,
        accepted: opsCommandResults.filter((item) => item.status === 'accepted').length,
        skipped: opsCommandResults.filter((item) => item.status === 'skipped').length,
        errors: opsCommandResults.filter((item) => item.status === 'error').length,
      },
      message: `Booking email sync processed ${result.events.length} event${result.events.length === 1 ? '' : 's'}.`,
    })
    return true
  }

  if (url.pathname === '/api/booking-email/events' && request.method === 'GET') {
    requirePermission(user, 'view:reservations')
    sendJson(response, 200, {
      ok: true,
      data: await listBookingEmailEvents(db, {
        status: url.searchParams.get('status'),
        sourceId: url.searchParams.get('sourceId'),
        limit: url.searchParams.get('limit'),
      }, user),
    })
    return true
  }

  let params

  params = routeParam(url.pathname, /^\/api\/booking-email\/events\/(?<id>[^/]+)$/)
  if (params && request.method === 'GET') {
    requirePermission(user, 'view:reservations')
    sendJson(response, 200, { ok: true, data: await getBookingEmailEvent(db, params.id, user) })
    return true
  }

  params = routeParam(url.pathname, /^\/api\/booking-email\/events\/(?<id>[^/]+)\/approve$/)
  if (params && request.method === 'POST') {
    requirePermission(user, 'edit:reservation')
    const event = await approveBookingEmailEvent(db, params.id, await readJson(request), user)
    sendJson(response, 200, { ok: true, data: event, message: 'Booking email event applied.' })
    return true
  }

  params = routeParam(url.pathname, /^\/api\/booking-email\/events\/(?<id>[^/]+)\/reject$/)
  if (params && request.method === 'POST') {
    requirePermission(user, 'edit:reservation')
    const event = await rejectBookingEmailEvent(db, params.id, await readJson(request), user)
    sendJson(response, 200, { ok: true, data: event, message: 'Booking email event ignored.' })
    return true
  }

  params = routeParam(url.pathname, /^\/api\/booking-email\/events\/(?<id>[^/]+)\/reprocess$/)
  if (params && request.method === 'POST') {
    requirePermission(user, 'edit:reservation')
    const event = await reprocessBookingEmailEvent(db, params.id, user)
    sendJson(response, 200, { ok: true, data: event, message: 'Booking email event reprocessed.' })
    return true
  }

  if (url.pathname === '/api/booking-email/sources' && request.method === 'GET') {
    requirePermission(user, 'view:reservations')
    sendJson(response, 200, { ok: true, data: await listBookingEmailSources(db, user) })
    return true
  }

  if (url.pathname === '/api/booking-email/sources' && request.method === 'POST') {
    requirePermission(user, 'edit:reservation')
    const source = await createBookingEmailSource(db, await readJson(request), user)
    sendJson(response, 201, { ok: true, data: source, message: 'Booking email source saved.' })
    return true
  }

  params = routeParam(url.pathname, /^\/api\/booking-email\/sources\/(?<id>[^/]+)$/)
  if (params && request.method === 'PATCH') {
    requirePermission(user, 'edit:reservation')
    const source = await updateBookingEmailSource(db, params.id, await readJson(request), user)
    sendJson(response, 200, { ok: true, data: source, message: 'Booking email source updated.' })
    return true
  }

  if (url.pathname === '/api/rooms' && request.method === 'GET') {
    requirePermission(user, 'view:board')
    sendJson(response, 200, { ok: true, data: await listRooms(db, user) })
    return true
  }

  if (url.pathname === '/api/channels/ical' && request.method === 'GET') {
    requirePermission(user, 'view:channels')
    sendJson(response, 200, { ok: true, data: await listIcalFeedChannels(db, context, requestBaseOrigin(request)) })
    return true
  }

  params = routeParam(url.pathname, /^\/api\/channels\/ical\/(?<provider>[^/]+)$/)
  if (params && request.method === 'POST') {
    requirePermission(user, 'manage:channels')
    const feed = await configureIcalFeedChannel(
      db,
      context,
      { provider: params.provider, ...(await readJson(request)) },
      requestBaseOrigin(request),
    )
    sendJson(response, 200, { ok: true, data: feed, message: `${feed.name} iCal feed published.` })
    return true
  }

  if (params && request.method === 'DELETE') {
    requirePermission(user, 'manage:channels')
    const feed = await deactivateIcalFeedChannel(db, context, params.provider, requestBaseOrigin(request))
    sendJson(response, 200, { ok: true, data: feed, message: `${feed.name} iCal feed disabled.` })
    return true
  }

  if (url.pathname === '/api/settings/room-setup' && request.method === 'GET') {
    requirePermission(user, 'view:settings')
    sendJson(response, 200, { ok: true, data: await getRoomSetup(db, user) })
    return true
  }

  if (url.pathname === '/api/settings/room-types' && request.method === 'POST') {
    requirePermission(user, 'edit:settings')
    const roomType = await createRoomType(db, await readJson(request), user)
    sendJson(response, 201, { ok: true, data: roomType, message: `Room type ${roomType.name} created.` })
    return true
  }

  params = routeParam(url.pathname, /^\/api\/settings\/room-types\/(?<id>[^/]+)$/)
  if (params && request.method === 'PATCH') {
    requirePermission(user, 'edit:settings')
    const roomType = await updateRoomType(db, params.id, await readJson(request), user)
    sendJson(response, 200, { ok: true, data: roomType, message: `Room type ${roomType.name} updated.` })
    return true
  }

  if (params && request.method === 'DELETE') {
    requirePermission(user, 'edit:settings')
    const roomType = await deleteRoomType(db, params.id, user)
    sendJson(response, 200, { ok: true, data: roomType, message: `Room type ${roomType.name} deleted.` })
    return true
  }

  if (url.pathname === '/api/settings/rooms' && request.method === 'POST') {
    requirePermission(user, 'edit:settings')
    const room = await createSetupRoom(db, await readJson(request), user)
    sendJson(response, 201, { ok: true, data: room, message: `Room ${room.number} created.` })
    return true
  }

  params = routeParam(url.pathname, /^\/api\/settings\/rooms\/(?<id>[^/]+)$/)
  if (params && request.method === 'PATCH') {
    requirePermission(user, 'edit:settings')
    const room = await updateSetupRoom(db, params.id, await readJson(request), user)
    sendJson(response, 200, { ok: true, data: room, message: `Room ${room.number} updated.` })
    return true
  }

  if (params && request.method === 'DELETE') {
    requirePermission(user, 'edit:settings')
    const room = await deleteSetupRoom(db, params.id, user)
    sendJson(response, 200, { ok: true, data: room, message: `Room ${room.number} deleted.` })
    return true
  }

  if (url.pathname === '/api/reservations' && request.method === 'GET') {
    requirePermission(user, 'view:reservations')
    sendJson(response, 200, { ok: true, data: await listReservations(db, user) })
    return true
  }

  if (url.pathname === '/api/reservations' && request.method === 'POST') {
    requirePermission(user, 'create:reservation')
    const reservation = await createReservation(db, await readJson(request), user)
    sendJson(response, 201, { ok: true, data: reservation, message: `Reservation ${reservation.confirmationCode} created.` })
    return true
  }

  params = routeParam(url.pathname, /^\/api\/reservations\/(?<id>[^/]+)$/)
  if (params && request.method === 'PATCH') {
    requirePermission(user, 'edit:reservation')
    const body = await readJson(request)
    const expectedTokens = [
      body.expectedUpdatedAt,
      firstHeaderValue(request.headers['x-reservation-expected-updated-at']),
      firstHeaderValue(request.headers['x-reservation-expected-version']),
    ].filter((value) => value !== undefined && value !== null && value !== '')
    if (new Set(expectedTokens.map(String)).size > 1) {
      throw new PmsValidationError('Reservation update tokens do not match.')
    }
    const reservation = await updateReservation(db, params.id, {
      ...body,
      ...(expectedTokens.length ? { expectedUpdatedAt: String(expectedTokens[0]) } : {}),
    }, user, {
      idempotencyKey: context.idempotencyKey,
    })
    sendJson(response, 200, { ok: true, data: reservation, message: `Reservation ${reservation.confirmationCode} updated.` })
    return true
  }

  params = routeParam(url.pathname, /^\/api\/reservations\/(?<id>[^/]+)\/guest$/)
  if (params && request.method === 'PATCH') {
    requirePermission(user, 'edit:reservation')
    requirePermission(user, 'view:guests')
    const body = await readJson(request)
    const expectedTokens = [
      body.expectedGuestUpdatedAt,
      firstHeaderValue(request.headers['x-guest-expected-updated-at']),
      firstHeaderValue(request.headers['x-guest-expected-version']),
    ].filter((value) => value !== undefined && value !== null && value !== '')
    if (new Set(expectedTokens.map(String)).size > 1) {
      throw new PmsValidationError('Guest update tokens do not match.')
    }
    const reservation = await updateReservationGuest(db, params.id, {
      ...body,
      ...(expectedTokens.length ? { expectedGuestUpdatedAt: String(expectedTokens[0]) } : {}),
    }, user, { idempotencyKey: context.idempotencyKey })
    sendJson(response, 200, { ok: true, data: reservation, message: 'Guest profile updated.' })
    return true
  }

  params = routeParam(url.pathname, /^\/api\/reservations\/(?<id>[^/]+)\/assign-room$/)
  if (params && request.method === 'POST') {
    requirePermission(user, 'edit:reservation')
    const body = await readJson(request)
    const expectedTokens = [
      body.expectedUpdatedAt,
      firstHeaderValue(request.headers['x-reservation-expected-updated-at']),
      firstHeaderValue(request.headers['x-reservation-expected-version']),
    ].filter((value) => value !== undefined && value !== null && value !== '')
    if (new Set(expectedTokens.map(String)).size > 1) {
      throw new PmsValidationError('Reservation update tokens do not match.')
    }
    const reservation = await assignRoom(db, params.id, body.roomId, user, {
      idempotencyKey: context.idempotencyKey,
      ...(expectedTokens.length ? { expectedUpdatedAt: String(expectedTokens[0]) } : {}),
    })
    sendJson(response, 200, { ok: true, data: reservation, message: 'Room assigned successfully.' })
    return true
  }

  params = routeParam(url.pathname, /^\/api\/reservations\/(?<id>[^/]+)\/check-in$/)
  if (params && request.method === 'POST') {
    requirePermission(user, 'check-in:guest')
    const body = await readJson(request)
    const expectedTokens = [
      body.expectedUpdatedAt,
      firstHeaderValue(request.headers['x-reservation-expected-updated-at']),
      firstHeaderValue(request.headers['x-reservation-expected-version']),
    ].filter((value) => value !== undefined && value !== null && value !== '')
    if (new Set(expectedTokens.map(String)).size > 1) {
      throw new PmsValidationError('Reservation update tokens do not match.')
    }
    const reservation = await checkInReservation(db, params.id, user, body.payment ? {
      ...body,
      idempotencyKey: context.idempotencyKey,
      ...(expectedTokens.length ? { expectedUpdatedAt: String(expectedTokens[0]) } : {}),
      payment: {
        ...body.payment,
        idempotencyKey: body.payment.idempotencyKey || context.idempotencyKey,
      },
    } : {
      ...body,
      idempotencyKey: context.idempotencyKey,
      ...(expectedTokens.length ? { expectedUpdatedAt: String(expectedTokens[0]) } : {}),
    })
    sendJson(response, 200, { ok: true, data: reservation, message: 'Check-in complete. Room is now occupied.' })
    return true
  }

  params = routeParam(url.pathname, /^\/api\/reservations\/(?<id>[^/]+)\/check-out$/)
  if (params && request.method === 'POST') {
    requirePermission(user, 'check-out:guest')
    const body = await readJson(request)
    const expectedTokens = [
      body.expectedUpdatedAt,
      firstHeaderValue(request.headers['x-reservation-expected-updated-at']),
      firstHeaderValue(request.headers['x-reservation-expected-version']),
    ].filter((value) => value !== undefined && value !== null && value !== '')
    if (new Set(expectedTokens.map(String)).size > 1) {
      throw new PmsValidationError('Reservation update tokens do not match.')
    }
    const reservation = await checkOutReservation(db, params.id, user, body.payment ? {
      ...body,
      idempotencyKey: context.idempotencyKey,
      ...(expectedTokens.length ? { expectedUpdatedAt: String(expectedTokens[0]) } : {}),
      payment: {
        ...body.payment,
        idempotencyKey: body.payment.idempotencyKey || context.idempotencyKey,
      },
    } : {
      ...body,
      idempotencyKey: context.idempotencyKey,
      ...(expectedTokens.length ? { expectedUpdatedAt: String(expectedTokens[0]) } : {}),
    })
    sendJson(response, 200, { ok: true, data: reservation, message: 'Check-out complete. Room has been sent to housekeeping.' })
    return true
  }

  params = routeParam(url.pathname, /^\/api\/reservations\/(?<id>[^/]+)\/cancel$/)
  if (params && request.method === 'POST') {
    requirePermission(user, 'cancel:reservation')
    const body = await readJson(request)
    const expectedTokens = [
      body.expectedUpdatedAt,
      firstHeaderValue(request.headers['x-reservation-expected-updated-at']),
      firstHeaderValue(request.headers['x-reservation-expected-version']),
    ].filter((value) => value !== undefined && value !== null && value !== '')
    if (new Set(expectedTokens.map(String)).size > 1) {
      throw new PmsValidationError('Reservation update tokens do not match.')
    }
    const reservation = await cancelReservation(db, params.id, user, 'CANCELLED', body.reason || body.notes, {
      idempotencyKey: context.idempotencyKey,
      ...(expectedTokens.length ? { expectedUpdatedAt: String(expectedTokens[0]) } : {}),
    })
    sendJson(response, 200, { ok: true, data: reservation, message: 'Reservation cancelled.' })
    return true
  }

  params = routeParam(url.pathname, /^\/api\/reservations\/(?<id>[^/]+)\/no-show$/)
  if (params && request.method === 'POST') {
    requirePermission(user, 'cancel:reservation')
    const body = await readJson(request)
    const expectedTokens = [
      body.expectedUpdatedAt,
      firstHeaderValue(request.headers['x-reservation-expected-updated-at']),
      firstHeaderValue(request.headers['x-reservation-expected-version']),
    ].filter((value) => value !== undefined && value !== null && value !== '')
    if (new Set(expectedTokens.map(String)).size > 1) {
      throw new PmsValidationError('Reservation update tokens do not match.')
    }
    const reservation = await cancelReservation(db, params.id, user, 'NO_SHOW', body.reason || body.notes, {
      idempotencyKey: context.idempotencyKey,
      ...(expectedTokens.length ? { expectedUpdatedAt: String(expectedTokens[0]) } : {}),
    })
    sendJson(response, 200, { ok: true, data: reservation, message: 'Reservation marked as no-show.' })
    return true
  }

  params = routeParam(url.pathname, /^\/api\/housekeeping\/rooms\/(?<id>[^/]+)\/status$/)
  if (params && request.method === 'POST') {
    requirePermission(user, 'edit:room-status')
    const body = await readJson(request)
    const room = await updateHousekeepingStatus(db, params.id, body.status, user, body.notes)
    sendJson(response, 200, { ok: true, data: room, message: `Room ${room.number} housekeeping status updated.` })
    return true
  }

  params = routeParam(url.pathname, /^\/api\/rooms\/(?<id>[^/]+)\/operational-status$/)
  if (params && request.method === 'POST') {
    requirePermission(user, 'edit:room-status')
    const body = await readJson(request)
    const room = await updateRoomOperationalStatus(db, params.id, body.operationalStatus, user, body.notes)
    sendJson(response, 200, { ok: true, data: room, message: `Room ${room.number} operational status updated.` })
    return true
  }

  if (url.pathname === '/api/payments' && request.method === 'POST') {
    requirePermission(user, 'process:payment')
    const body = await readJson(request)
    const payment = await createPayment(db, {
      ...body,
      idempotencyKey: body.idempotencyKey || context.idempotencyKey,
    }, user)
    sendJson(response, payment.idempotentReplay ? 200 : 201, {
      ok: true,
      data: payment,
      message: payment.idempotentReplay ? 'Existing payment returned for this idempotency key.' : 'Payment recorded.',
    })
    return true
  }

  if (url.pathname === '/api/ops/analyzers' && request.method === 'POST') {
    requirePermission(user, 'view:ops')
    sendJson(response, 200, {
      ok: true,
      data: runDeterministicOpsAnalyzers(await readJson(request)),
      message: 'Suggest-only operational analysis completed. No PMS state was changed.',
    })
    return true
  }

  if (url.pathname === '/api/charges' && request.method === 'POST') {
    requirePermission(user, 'post:charges')
    const body = await readJson(request)
    const charge = await createCharge(db, {
      ...body,
      idempotencyKey: body.idempotencyKey || context.idempotencyKey,
    }, user)
    sendJson(response, charge.idempotentReplay ? 200 : 201, {
      ok: true,
      data: charge,
      message: charge.idempotentReplay ? 'Existing charge returned for this idempotency key.' : 'Charge posted.',
    })
    return true
  }

  if (url.pathname === '/api/guests' && request.method === 'GET') {
    requirePermission(user, 'view:guests')
    sendJson(response, 200, { ok: true, data: await listGuests(db, user) })
    return true
  }

  if (url.pathname === '/api/guests' && request.method === 'POST') {
    requirePermission(user, 'edit:reservation')
    const guest = await createGuest(db, await readJson(request), user)
    sendJson(response, 201, { ok: true, data: guest, message: 'Guest profile created.' })
    return true
  }

  params = routeParam(url.pathname, /^\/api\/guests\/(?<id>[^/]+)$/)
  if (params && request.method === 'PATCH') {
    requirePermission(user, 'edit:reservation')
    const guest = await updateGuest(db, params.id, await readJson(request), user)
    sendJson(response, 200, { ok: true, data: guest, message: 'Guest profile updated.' })
    return true
  }

  return false
}

const server = createServer(async (request, response) => {
  try {
    request.requestId = requestIdFromHeaders(request.headers)
    response.requestId = request.requestId
    const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`)

    if (url.pathname.startsWith('/api/')) {
      const originCheck = resolveApiOrigin(request)
      response.corsHeaders = originCheck.headers

      if (!originCheck.ok) {
        sendJson(response, originCheck.statusCode, { ok: false, error: originCheck.error })
        return
      }

      if (request.method === 'OPTIONS') {
        sendNoContent(response, {
          'access-control-allow-methods': CORS_ALLOW_METHODS,
          'access-control-allow-headers': CORS_ALLOW_HEADERS,
          'access-control-max-age': '600',
        })
        return
      }
    }

    if (request.method === 'GET' && (url.pathname === '/healthz' || url.pathname === '/api/health')) {
      await sendHealth(request, response)
      return
    }

    if (url.pathname === '/api/line/webhook') {
      await handleLineWebhook(request, response)
      return
    }

    if (url.pathname === '/api/whatsapp/webhook') {
      await handleWhatsAppWebhook(request, response, url)
      return
    }

    const icalParams = routeParam(url.pathname, /^\/ical\/(?<token>[a-zA-Z0-9_-]+)\.ics$/)
    if (icalParams && request.method === 'GET') {
      const feed = await getIcalFeedByToken(await getPrisma(), icalParams.token)
      sendCalendar(response, feed.contents, feed.fileName)
      return
    }

    if (url.pathname.startsWith('/api/')) {
      if (await handleApi(request, response, url)) return
      sendJson(response, 404, { ok: false, error: 'API route not found.' })
      return
    }

    if (request.method === 'GET' || request.method === 'HEAD') {
      await serveStatic(request, response)
      return
    }

    sendJson(response, 405, { ok: false, error: 'Method not allowed' })
  } catch (error) {
    const statusCode = Number(error?.statusCode || 500)
    if (statusCode >= 500) {
      console.error('Unhandled PMS API error.', {
        requestId: request.requestId || response.requestId || null,
        name: error instanceof Error ? error.name : 'UnknownError',
        code: typeof error?.code === 'string' ? error.code : null,
      })
    }
    sendJson(response, statusCode, {
      ok: false,
      error: statusCode >= 500
        ? 'The server could not complete this request.'
        : error instanceof Error ? error.message : String(error),
      ...(statusCode >= 500 ? { requestId: request.requestId || response.requestId || null } : {}),
    })
  }
})

server.listen(port, host, () => {
  console.log(`sandbox-hotel-pms listening on http://${host}:${port}`)
  opsScanScheduler = createHotelOpsScanScheduler({ getPrisma, env: process.env, logger: console })
  const schedulerStart = opsScanScheduler.start()
  if (schedulerStart.started) {
    console.log(`Hotel Ops scan scheduler active every ${schedulerStart.status.intervalMinutes} minute${schedulerStart.status.intervalMinutes === 1 ? '' : 's'}.`)
  }
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    opsScanScheduler?.stop()
    server.close(async () => {
      await prisma?.$disconnect?.()
      process.exit(0)
    })
  })
}
