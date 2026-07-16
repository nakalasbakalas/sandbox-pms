import { createServer } from 'node:http'
import { createReadStream, readFileSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { dirname, extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEnvDefaults } from '../scripts/env-utils.mjs'
import { resolveApiRouteContract } from './api-routes.mjs'
import { loginThrottle, resolveClientIp } from './login-throttle.mjs'
import { createPrismaClient } from './prisma-client.mjs'
import {
  BOOKING_EMAIL_EVIDENCE_PERMISSION,
  BOOKING_EMAIL_REVIEW_PERMISSION,
  LITE_PAYMENT_RECONCILIATION_PERMISSION,
  canPerformAction,
  canViewRoute,
  requirePermission,
} from './rbac.mjs'
import { PmsValidationError, SANDBOX_RULES } from './pms-domain.mjs'
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
  bookingEmailPubSubConfig,
  decodeBookingEmailPubSubEnvelope,
  processPendingBookingEmailDeliveries,
  recordBookingEmailPushDelivery,
  redactBookingEmailSyncError,
  verifyBookingEmailPubSubRequest,
} from './booking-email-gmail-sync.mjs'
import {
  completeManualChannelTask,
  reconcileManualChannelTasks,
  reopenManualChannelTask,
  saveManualChannelConnection,
  saveManualChannelRoomMapping,
} from './manual-channel-service.mjs'
import {
  getLiteBoard,
  getLiteBookingDetail,
  getLiteChannelDesk,
  getLiteFrontDesk,
  getLiteHousekeeping,
  getLiteSettings,
  getLiteVersion,
  listLiteBookings,
} from './lite-service.mjs'
import { createRealtimeEventHub } from './realtime-events.mjs'
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
  bookingEmailGmailCredentialStatus,
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
  getBookingEmailEvidence,
  getBookingEmailStatus,
  getAuthenticatedUser,
  getFrontDeskBoard,
  getWalkInQuote,
  getRoomSetup,
  getSetupStatus,
  getTodayData,
  ingestBookingEmailEvents,
  listBookingEmailEvents,
  listBookingEmailSources,
  listGuests,
  listReservations,
  listRooms,
  listUsers,
  rejectBookingEmailEvent,
  reversePayment,
  reprocessBookingEmailEvent,
  resolveBookingEmailGmailAccessToken,
  syncBookingEmail,
  deactivateUser,
  deleteRoomType,
  deleteSetupRoom,
  updateBookingEmailSource,
  updateReservation,
  updateGuest,
  updateHousekeepingStatus,
  updateRoomOperationalStatus,
  updateRoomType,
  updateSetupRoom,
  updateUser,
  voidCharge,
} from './pms-service.mjs'

loadEnvDefaults()

const __dirname = dirname(fileURLToPath(import.meta.url))
const uiVariant = String(process.env.PMS_UI_VARIANT || 'legacy').trim().toLowerCase()
if (!['legacy', 'lite'].includes(uiVariant)) throw new Error('PMS_UI_VARIANT must be legacy or lite.')
const distDir = resolve(__dirname, '..', uiVariant === 'lite' ? 'dist-lite' : 'dist')
let builtReleaseMetadata = {}
try {
  builtReleaseMetadata = JSON.parse(readFileSync(join(distDir, 'release-meta.json'), 'utf8'))
} catch {
  builtReleaseMetadata = {}
}
const port = Number(process.env.PORT || 10000)
const host = process.env.HOST || '0.0.0.0'
const MAX_JSON_BODY_BYTES = 1_000_000
const CORS_ALLOW_METHODS = 'GET,POST,PUT,PATCH,DELETE,OPTIONS'
const CORS_ALLOW_HEADERS = `content-type, authorization, x-setup-token, ${OPS_WORKER_SIGNATURE_HEADER}, ${OPS_WORKER_TIMESTAMP_HEADER}, ${OPS_WORKER_NONCE_HEADER}`
const PRODUCTION = process.env.NODE_ENV === 'production'
const pmsWriteMode = String(process.env.PMS_WRITE_MODE || 'active').trim().toLowerCase()
if (!['active', 'read-only'].includes(pmsWriteMode)) throw new Error('PMS_WRITE_MODE must be active or read-only.')

let prisma
let opsScanScheduler
const realtimeHub = createRealtimeEventHub({ logger: console })

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
  response.end(JSON.stringify(payload))
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

function queryInput(searchParams) {
  const input = {}
  for (const [key, value] of searchParams.entries()) {
    if (input[key] === undefined) input[key] = value
    else input[key] = Array.isArray(input[key]) ? [...input[key], value] : [input[key], value]
  }
  return input
}

function readOnlyWriteAllowed(pathname) {
  return pathname === '/api/auth/login' || pathname === '/api/auth/logout'
}

function requestWouldWrite(request, pathname) {
  return !['GET', 'HEAD', 'OPTIONS'].includes(request.method || '') && !readOnlyWriteAllowed(pathname)
}

async function litePropertyId(db) {
  const property = await db.property.findUnique({
    where: { code: SANDBOX_RULES.propertyCode },
    select: { id: true },
  })
  if (!property) {
    const error = new Error('Property setup has not been completed yet.')
    error.statusCode = 503
    throw error
  }
  return property.id
}

async function ingestReviewOnlyBookingEmailEvents(db, input, actor) {
  const result = await ingestBookingEmailEvents(db, { ...input, reviewOnly: true }, actor)
  await processEmailOpsCommandEvents(db, result.opsCommandEvents || result.events, {
    env: process.env,
    submitCommand: submitOpsCommand,
  })
  return result
}

function bookingEmailRuntimeOptions() {
  return {
    env: process.env,
    logger: console,
    getAccessToken: ({ env }) => resolveBookingEmailGmailAccessToken({ env }),
    ingestEvents: ingestReviewOnlyBookingEmailEvents,
  }
}

let bookingEmailPushDrainScheduled = false
function scheduleBookingEmailPushDrain(db) {
  if (bookingEmailPushDrainScheduled) return
  bookingEmailPushDrainScheduled = true
  setImmediate(async () => {
    try {
      const result = await processPendingBookingEmailDeliveries(db, bookingEmailRuntimeOptions())
      if (result.eventsIngested > 0) {
        realtimeHub.publish('booking-email.received', { reason: 'gmail_push' })
      }
    } catch (error) {
      console.error('Booking email push drain failed:', redactBookingEmailSyncError(error))
    } finally {
      bookingEmailPushDrainScheduled = false
    }
  })
}

function publishReservationMutation(reservationId, reason) {
  realtimeHub.publish('reservation.changed', { entityId: reservationId, reason })
  realtimeHub.publish('manual-channel-tasks.changed', { reason: 'reservation_inventory_changed' })
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

function requireAnyPermission(user, permissions) {
  if (!permissions.some((permission) => canPerformAction(user, permission))) {
    requirePermission(user, permissions[0])
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
    console.error('Database health check failed.')
    return {
      configured: true,
      ok: false,
      error: 'Database health check failed.',
    }
  } finally {
    await prisma?.$disconnect?.()
  }
}

async function healthPayload(deep = false) {
  const database = await databaseStatus(deep)
  return {
    ok: deep ? database.configured === true && database.ok === true : true,
    service: 'sandbox-hotel-pms',
    uiVariant,
    timestamp: new Date().toISOString(),
    database,
  }
}

async function sendHealth(request, response) {
  const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`)
  const payload = await healthPayload(url.searchParams.get('deep') === '1')
  sendJson(response, payload.ok ? 200 : 503, payload)
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

  if (url.pathname === '/api/version' && request.method === 'GET') {
    sendJson(response, 200, {
      ok: true,
      data: getLiteVersion({
        env: {
          ...process.env,
          PMS_UI_VARIANT: uiVariant,
          LITE_BUILD_TIME: process.env.LITE_BUILD_TIME || builtReleaseMetadata.buildTime,
          LITE_ASSET_IDENTIFIER: process.env.LITE_ASSET_IDENTIFIER || builtReleaseMetadata.assetIdentifier,
          GIT_COMMIT_SHA: process.env.GIT_COMMIT_SHA || builtReleaseMetadata.commitSha,
        },
      }),
    })
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

  if (url.pathname === '/api/booking-email/gmail/push' && request.method === 'POST') {
    const config = bookingEmailPubSubConfig(process.env)
    await verifyBookingEmailPubSubRequest({
      config,
      authorization: firstHeaderValue(request.headers.authorization),
    })
    const delivery = decodeBookingEmailPubSubEnvelope(await readJson(request), { config })
    const recorded = await recordBookingEmailPushDelivery(db, delivery, { env: process.env, config })
    scheduleBookingEmailPushDrain(db)
    sendJson(response, 202, {
      ok: true,
      accepted: recorded.accepted,
      duplicate: recorded.duplicate,
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
    loginThrottle.recordSuccess(loginIdentity)
    const token = createSessionToken(user)
    sendJson(response, 200, { ok: true, user: publicUser(user) }, { 'set-cookie': sessionCookie(token) })
    return true
  }

  if (url.pathname === '/api/auth/logout' && request.method === 'POST') {
    const session = verifySessionToken(readSessionCookie(request))
    if (session?.sub && Number.isInteger(session.sessionVersion)) {
      await db.user.updateMany({
        where: { id: session.sub, sessionVersion: session.sessionVersion },
        data: { sessionVersion: { increment: 1 } },
      })
    }
    sendJson(response, 200, { ok: true }, { 'set-cookie': clearSessionCookie() })
    return true
  }

  if (url.pathname === '/api/auth/me' && request.method === 'GET') {
    const user = await requireUser(request)
    sendJson(response, 200, { ok: true, user: publicUser(user) })
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

  const user = await requireUser(request)

  if (url.pathname === '/api/realtime/events' && request.method === 'GET') {
    await realtimeHub.handle(request, response, {
      requireUser,
      requirePermission,
      permission: 'view:realtime',
    })
    return true
  }

  if (url.pathname === '/api/auth/can-view' && request.method === 'GET') {
    sendJson(response, 200, { ok: true, allowed: canViewRoute(user, url.searchParams.get('route')) })
    return true
  }

  if (url.pathname === '/api/lite/v1/front-desk' && request.method === 'GET') {
    requirePermission(user, 'view:board')
    sendJson(response, 200, { ok: true, data: await getLiteFrontDesk(db, queryInput(url.searchParams)) })
    return true
  }

  if (url.pathname === '/api/lite/v1/bookings' && request.method === 'GET') {
    requireAnyPermission(user, ['view:reservations', LITE_PAYMENT_RECONCILIATION_PERMISSION])
    sendJson(response, 200, {
      ok: true,
      data: await listLiteBookings(db, queryInput(url.searchParams), {
        paymentReconciliationOnly: canPerformAction(user, LITE_PAYMENT_RECONCILIATION_PERMISSION)
          && !canPerformAction(user, 'view:reservations'),
      }),
    })
    return true
  }

  let liteParams = routeParam(url.pathname, /^\/api\/lite\/v1\/bookings\/(?<id>[^/]+)$/)
  if (liteParams && request.method === 'GET') {
    requireAnyPermission(user, ['view:reservations', LITE_PAYMENT_RECONCILIATION_PERMISSION])
    sendJson(response, 200, {
      ok: true,
      data: await getLiteBookingDetail(db, liteParams.id, {
        includeIdentitySuffix: canPerformAction(user, 'check-in:guest'),
        paymentReconciliationOnly: canPerformAction(user, LITE_PAYMENT_RECONCILIATION_PERMISSION)
          && !canPerformAction(user, 'view:reservations'),
      }),
    })
    return true
  }

  if (url.pathname === '/api/lite/v1/board' && request.method === 'GET') {
    requirePermission(user, 'view:board')
    sendJson(response, 200, { ok: true, data: await getLiteBoard(db, queryInput(url.searchParams)) })
    return true
  }

  if (url.pathname === '/api/lite/v1/walk-in-quote' && request.method === 'GET') {
    requirePermission(user, 'create:reservation')
    requirePermission(user, 'check-in:guest')
    sendJson(response, 200, { ok: true, data: await getWalkInQuote(db, queryInput(url.searchParams)) })
    return true
  }

  if (url.pathname === '/api/lite/v1/housekeeping' && request.method === 'GET') {
    requirePermission(user, 'view:housekeeping')
    sendJson(response, 200, { ok: true, data: await getLiteHousekeeping(db, queryInput(url.searchParams)) })
    return true
  }

  if (url.pathname === '/api/lite/v1/channel-desk' && request.method === 'GET') {
    requirePermission(user, 'view:channels')
    sendJson(response, 200, {
      ok: true,
      data: await getLiteChannelDesk(db, {
        credentialStatus: bookingEmailGmailCredentialStatus(process.env),
        pubsubConfig: bookingEmailPubSubConfig(process.env),
      }),
    })
    return true
  }

  liteParams = routeParam(url.pathname, /^\/api\/lite\/v1\/channels\/connections\/(?<provider>[^/]+)$/)
  if (liteParams && request.method === 'PUT') {
    requirePermission(user, 'manage:channels')
    const body = await readJson(request)
    const connection = await saveManualChannelConnection(db, {
      ...body,
      propertyId: await litePropertyId(db),
      providerCode: liteParams.provider,
    }, user)
    realtimeHub.publish('manual-channel-tasks.changed', { entityId: connection.id, reason: 'connection_saved' })
    sendJson(response, 200, { ok: true, data: connection, message: 'Manual channel connection saved.' })
    return true
  }

  if (url.pathname === '/api/lite/v1/channels/mappings' && request.method === 'POST') {
    requirePermission(user, 'manage:channels')
    const mapping = await saveManualChannelRoomMapping(db, await readJson(request), user)
    realtimeHub.publish('manual-channel-tasks.changed', { entityId: mapping.id, reason: 'mapping_saved' })
    sendJson(response, 200, { ok: true, data: mapping, message: 'Manual channel room mapping saved.' })
    return true
  }

  if (url.pathname === '/api/lite/v1/channel-tasks/reconcile' && request.method === 'POST') {
    requirePermission(user, 'manage:channels')
    const result = await reconcileManualChannelTasks(db, {
      ...(await readJson(request)),
      propertyId: await litePropertyId(db),
    }, user)
    realtimeHub.publish('manual-channel-tasks.changed', { reason: 'manual_reconciliation' })
    sendJson(response, 200, { ok: true, data: result, message: 'Manual channel availability tasks reconciled.' })
    return true
  }

  liteParams = routeParam(url.pathname, /^\/api\/lite\/v1\/channel-tasks\/(?<id>[^/]+)\/complete$/)
  if (liteParams && request.method === 'POST') {
    requirePermission(user, 'view:channels')
    const task = await completeManualChannelTask(db, liteParams.id, await readJson(request), user)
    realtimeHub.publish('manual-channel-tasks.changed', { entityId: task.id, reason: 'task_completed' })
    sendJson(response, 200, { ok: true, data: task, message: 'Manual channel task completed.' })
    return true
  }

  liteParams = routeParam(url.pathname, /^\/api\/lite\/v1\/channel-tasks\/(?<id>[^/]+)\/reopen$/)
  if (liteParams && request.method === 'POST') {
    requirePermission(user, 'manage:channels')
    const task = await reopenManualChannelTask(db, liteParams.id, await readJson(request), user)
    realtimeHub.publish('manual-channel-tasks.changed', { entityId: task.id, reason: 'task_reopened' })
    sendJson(response, 200, { ok: true, data: task, message: 'Manual channel task reopened.' })
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
    sendJson(response, 200, { ok: true, data: await getTodayData(db) })
    return true
  }

  if (url.pathname === '/api/front-desk/board' && request.method === 'GET') {
    requirePermission(user, 'view:board')
    sendJson(response, 200, { ok: true, data: await getFrontDeskBoard(db) })
    return true
  }

  if (url.pathname === '/api/front-desk/walk-in' && request.method === 'POST') {
    requirePermission(user, 'create:reservation')
    requirePermission(user, 'check-in:guest')
    const input = await readJson(request)
    if (uiVariant === 'lite') {
      if (!Object.hasOwn(input, 'expectedTotalSatang')) {
        throw new PmsValidationError('PMS Lite walk-in check-in requires the current server quote total.')
      }
      if (Object.hasOwn(input, 'ratePerNight') || Object.hasOwn(input, 'ratePerNightSatang')) {
        throw new PmsValidationError('PMS Lite walk-in rates come from the server quote and cannot be supplied by the client.')
      }
    }
    const reservation = await createWalkInCheckIn(db, input, user)
    publishReservationMutation(reservation.id, 'walk_in_created')
    sendJson(response, 201, { ok: true, data: reservation, message: `Walk-in checked in to Room ${reservation.assignedRoom?.number}.` })
    return true
  }

  if (url.pathname === '/api/booking-email/status' && request.method === 'GET') {
    requirePermission(user, BOOKING_EMAIL_REVIEW_PERMISSION)
    sendJson(response, 200, { ok: true, data: await getBookingEmailStatus(db) })
    return true
  }

  if (url.pathname === '/api/booking-email/sync' && request.method === 'POST') {
    requirePermission(user, BOOKING_EMAIL_REVIEW_PERMISSION)
    const input = await readJson(request)
    const unsupportedFields = Object.keys(input).filter((field) => field !== 'limit')
    if (unsupportedFields.length > 0) {
      throw new PmsValidationError(`Booking-email sync does not accept: ${unsupportedFields.join(', ')}.`)
    }
    const result = await syncBookingEmail(db, { limit: input.limit }, user)
    const opsCommandResults = await processEmailOpsCommandEvents(db, result.opsCommandEvents || result.events, {
      env: process.env,
      submitCommand: submitOpsCommand,
    })
    if (result.events.length > 0) realtimeHub.publish('booking-email.received', { reason: 'manual_sync' })
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
    requirePermission(user, BOOKING_EMAIL_REVIEW_PERMISSION)
    sendJson(response, 200, {
      ok: true,
      data: await listBookingEmailEvents(db, {
        status: url.searchParams.get('status'),
        sourceId: url.searchParams.get('sourceId'),
        limit: url.searchParams.get('limit'),
      }),
    })
    return true
  }

  let params

  params = routeParam(url.pathname, /^\/api\/booking-email\/events\/(?<id>[^/]+)$/)
  if (params && request.method === 'GET') {
    requirePermission(user, BOOKING_EMAIL_REVIEW_PERMISSION)
    sendJson(response, 200, { ok: true, data: await getBookingEmailEvent(db, params.id) })
    return true
  }

  params = routeParam(url.pathname, /^\/api\/booking-email\/events\/(?<id>[^/]+)\/approve$/)
  if (params && request.method === 'POST') {
    requirePermission(user, BOOKING_EMAIL_REVIEW_PERMISSION)
    const event = await approveBookingEmailEvent(db, params.id, await readJson(request), user)
    realtimeHub.publish('booking-email.changed', { entityId: event.id, reason: 'approved' })
    if (event.reservationId) publishReservationMutation(event.reservationId, 'email_event_approved')
    sendJson(response, 200, { ok: true, data: event, message: 'Booking email event applied.' })
    return true
  }

  params = routeParam(url.pathname, /^\/api\/booking-email\/events\/(?<id>[^/]+)\/reject$/)
  if (params && request.method === 'POST') {
    requirePermission(user, BOOKING_EMAIL_REVIEW_PERMISSION)
    requirePermission(user, 'edit:reservation')
    const event = await rejectBookingEmailEvent(db, params.id, await readJson(request), user)
    realtimeHub.publish('booking-email.changed', { entityId: event.id, reason: 'rejected' })
    sendJson(response, 200, { ok: true, data: event, message: 'Booking email event ignored.' })
    return true
  }

  params = routeParam(url.pathname, /^\/api\/booking-email\/events\/(?<id>[^/]+)\/reprocess$/)
  if (params && request.method === 'POST') {
    requirePermission(user, BOOKING_EMAIL_REVIEW_PERMISSION)
    requirePermission(user, 'edit:reservation')
    const event = await reprocessBookingEmailEvent(db, params.id, user)
    realtimeHub.publish('booking-email.changed', { entityId: event.id, reason: 'reprocessed' })
    sendJson(response, 200, { ok: true, data: event, message: 'Booking email event reprocessed.' })
    return true
  }

  params = routeParam(url.pathname, /^\/api\/booking-email\/events\/(?<id>[^/]+)\/evidence$/)
  if (params && request.method === 'POST') {
    requirePermission(user, BOOKING_EMAIL_EVIDENCE_PERMISSION)
    const evidence = await getBookingEmailEvidence(db, params.id, await readJson(request), user)
    sendJson(response, 200, { ok: true, data: evidence })
    return true
  }

  if (url.pathname === '/api/lite/v1/settings' && request.method === 'GET') {
    requirePermission(user, 'view:settings')
    sendJson(response, 200, {
      ok: true,
      data: await getLiteSettings(db, {
        credentialStatus: bookingEmailGmailCredentialStatus(process.env),
        pubsubConfig: bookingEmailPubSubConfig(process.env),
      }),
    })
    return true
  }

  if (url.pathname === '/api/booking-email/sources' && request.method === 'GET') {
    requirePermission(user, BOOKING_EMAIL_REVIEW_PERMISSION)
    sendJson(response, 200, { ok: true, data: await listBookingEmailSources(db) })
    return true
  }

  if (url.pathname === '/api/booking-email/sources' && request.method === 'POST') {
    requirePermission(user, 'manage:channels')
    const source = await createBookingEmailSource(db, await readJson(request), user)
    sendJson(response, 201, { ok: true, data: source, message: 'Booking email source saved.' })
    return true
  }

  params = routeParam(url.pathname, /^\/api\/booking-email\/sources\/(?<id>[^/]+)$/)
  if (params && request.method === 'PATCH') {
    requirePermission(user, 'manage:channels')
    const source = await updateBookingEmailSource(db, params.id, await readJson(request), user)
    sendJson(response, 200, { ok: true, data: source, message: 'Booking email source updated.' })
    return true
  }

  if (url.pathname === '/api/rooms' && request.method === 'GET') {
    requirePermission(user, 'view:board')
    sendJson(response, 200, { ok: true, data: await listRooms(db) })
    return true
  }

  if (url.pathname === '/api/channels/ical' && request.method === 'GET') {
    requirePermission(user, 'view:channels')
    sendJson(response, 200, { ok: true, data: await listIcalFeedChannels(db, requestBaseOrigin(request)) })
    return true
  }

  params = routeParam(url.pathname, /^\/api\/channels\/ical\/(?<provider>[^/]+)$/)
  if (params && request.method === 'POST') {
    requirePermission(user, 'manage:channels')
    const feed = await configureIcalFeedChannel(
      db,
      { provider: params.provider, ...(await readJson(request)) },
      requestBaseOrigin(request),
    )
    sendJson(response, 200, { ok: true, data: feed, message: `${feed.name} iCal feed published.` })
    return true
  }

  if (params && request.method === 'DELETE') {
    requirePermission(user, 'manage:channels')
    const feed = await deactivateIcalFeedChannel(db, params.provider, requestBaseOrigin(request))
    sendJson(response, 200, { ok: true, data: feed, message: `${feed.name} iCal feed disabled.` })
    return true
  }

  if (url.pathname === '/api/settings/room-setup' && request.method === 'GET') {
    requirePermission(user, 'view:settings')
    sendJson(response, 200, { ok: true, data: await getRoomSetup(db) })
    return true
  }

  if (url.pathname === '/api/settings/room-types' && request.method === 'POST') {
    requirePermission(user, 'edit:settings')
    const roomType = await createRoomType(db, await readJson(request), user)
    realtimeHub.publish('sync-required', { entityId: roomType.id, reason: 'room_type_created' })
    sendJson(response, 201, { ok: true, data: roomType, message: `Room type ${roomType.name} created.` })
    return true
  }

  params = routeParam(url.pathname, /^\/api\/settings\/room-types\/(?<id>[^/]+)$/)
  if (params && request.method === 'PATCH') {
    requirePermission(user, 'edit:settings')
    const roomType = await updateRoomType(db, params.id, await readJson(request), user)
    realtimeHub.publish('sync-required', { entityId: roomType.id, reason: 'room_type_updated' })
    sendJson(response, 200, { ok: true, data: roomType, message: `Room type ${roomType.name} updated.` })
    return true
  }

  if (params && request.method === 'DELETE') {
    requirePermission(user, 'edit:settings')
    const roomType = await deleteRoomType(db, params.id, user)
    realtimeHub.publish('sync-required', { entityId: roomType.id, reason: 'room_type_deleted' })
    sendJson(response, 200, { ok: true, data: roomType, message: `Room type ${roomType.name} deleted.` })
    return true
  }

  if (url.pathname === '/api/settings/rooms' && request.method === 'POST') {
    requirePermission(user, 'edit:settings')
    const room = await createSetupRoom(db, await readJson(request), user)
    realtimeHub.publish('sync-required', { entityId: room.id, reason: 'room_created' })
    realtimeHub.publish('manual-channel-tasks.changed', { reason: 'room_inventory_changed' })
    sendJson(response, 201, { ok: true, data: room, message: `Room ${room.number} created.` })
    return true
  }

  params = routeParam(url.pathname, /^\/api\/settings\/rooms\/(?<id>[^/]+)$/)
  if (params && request.method === 'PATCH') {
    requirePermission(user, 'edit:settings')
    const room = await updateSetupRoom(db, params.id, await readJson(request), user)
    realtimeHub.publish('sync-required', { entityId: room.id, reason: 'room_updated' })
    realtimeHub.publish('manual-channel-tasks.changed', { reason: 'room_inventory_changed' })
    sendJson(response, 200, { ok: true, data: room, message: `Room ${room.number} updated.` })
    return true
  }

  if (params && request.method === 'DELETE') {
    requirePermission(user, 'edit:settings')
    const room = await deleteSetupRoom(db, params.id, user)
    realtimeHub.publish('sync-required', { entityId: room.id, reason: 'room_deleted' })
    realtimeHub.publish('manual-channel-tasks.changed', { reason: 'room_inventory_changed' })
    sendJson(response, 200, { ok: true, data: room, message: `Room ${room.number} deleted.` })
    return true
  }

  if (url.pathname === '/api/reservations' && request.method === 'GET') {
    requirePermission(user, 'view:reservations')
    sendJson(response, 200, { ok: true, data: await listReservations(db) })
    return true
  }

  if (url.pathname === '/api/reservations' && request.method === 'POST') {
    requirePermission(user, 'create:reservation')
    const reservation = await createReservation(db, await readJson(request), user)
    publishReservationMutation(reservation.id, 'reservation_created')
    sendJson(response, 201, { ok: true, data: reservation, message: `Reservation ${reservation.confirmationCode} created.` })
    return true
  }

  params = routeParam(url.pathname, /^\/api\/reservations\/(?<id>[^/]+)$/)
  if (params && request.method === 'PATCH') {
    requirePermission(user, 'edit:reservation')
    const reservation = await updateReservation(db, params.id, await readJson(request), user)
    publishReservationMutation(reservation.id, 'reservation_updated')
    sendJson(response, 200, { ok: true, data: reservation, message: `Reservation ${reservation.confirmationCode} updated.` })
    return true
  }

  params = routeParam(url.pathname, /^\/api\/reservations\/(?<id>[^/]+)\/assign-room$/)
  if (params && request.method === 'POST') {
    requirePermission(user, 'edit:reservation')
    const body = await readJson(request)
    const reservation = await assignRoom(db, params.id, body.roomId, user, {
      expectedUpdatedAt: body.expectedUpdatedAt,
    })
    publishReservationMutation(reservation.id, 'room_assigned')
    sendJson(response, 200, { ok: true, data: reservation, message: 'Room assigned successfully.' })
    return true
  }

  params = routeParam(url.pathname, /^\/api\/reservations\/(?<id>[^/]+)\/check-in$/)
  if (params && request.method === 'POST') {
    requirePermission(user, 'check-in:guest')
    const reservation = await checkInReservation(db, params.id, user, await readJson(request))
    publishReservationMutation(reservation.id, 'checked_in')
    sendJson(response, 200, { ok: true, data: reservation, message: 'Check-in complete. Room is now occupied.' })
    return true
  }

  params = routeParam(url.pathname, /^\/api\/reservations\/(?<id>[^/]+)\/check-out$/)
  if (params && request.method === 'POST') {
    requirePermission(user, 'check-out:guest')
    const body = await readJson(request)
    const reservation = await checkOutReservation(db, params.id, user, body)
    publishReservationMutation(reservation.id, 'checked_out')
    sendJson(response, 200, { ok: true, data: reservation, message: 'Check-out complete. Room has been sent to housekeeping.' })
    return true
  }

  params = routeParam(url.pathname, /^\/api\/reservations\/(?<id>[^/]+)\/cancel$/)
  if (params && request.method === 'POST') {
    requirePermission(user, 'cancel:reservation')
    const body = await readJson(request)
    const reservation = await cancelReservation(db, params.id, user, 'CANCELLED', body.reason || body.notes)
    publishReservationMutation(reservation.id, 'cancelled')
    sendJson(response, 200, { ok: true, data: reservation, message: 'Reservation cancelled.' })
    return true
  }

  params = routeParam(url.pathname, /^\/api\/reservations\/(?<id>[^/]+)\/no-show$/)
  if (params && request.method === 'POST') {
    requirePermission(user, 'cancel:reservation')
    const body = await readJson(request)
    const reservation = await cancelReservation(db, params.id, user, 'NO_SHOW', body.reason || body.notes)
    publishReservationMutation(reservation.id, 'no_show')
    sendJson(response, 200, { ok: true, data: reservation, message: 'Reservation marked as no-show.' })
    return true
  }

  params = routeParam(url.pathname, /^\/api\/housekeeping\/rooms\/(?<id>[^/]+)\/status$/)
  if (params && request.method === 'POST') {
    requirePermission(user, 'edit:room-status')
    const body = await readJson(request)
    const room = await updateHousekeepingStatus(db, params.id, body.status, user, body.notes)
    realtimeHub.publish('sync-required', { entityId: room.id, reason: 'housekeeping_changed' })
    sendJson(response, 200, { ok: true, data: room, message: `Room ${room.number} housekeeping status updated.` })
    return true
  }

  params = routeParam(url.pathname, /^\/api\/rooms\/(?<id>[^/]+)\/operational-status$/)
  if (params && request.method === 'POST') {
    requirePermission(user, 'edit:room-status')
    const body = await readJson(request)
    const room = await updateRoomOperationalStatus(db, params.id, body.operationalStatus, user, body.notes)
    realtimeHub.publish('sync-required', { entityId: room.id, reason: 'room_status_changed' })
    realtimeHub.publish('manual-channel-tasks.changed', { reason: 'room_inventory_changed' })
    sendJson(response, 200, { ok: true, data: room, message: `Room ${room.number} operational status updated.` })
    return true
  }

  if (url.pathname === '/api/payments' && request.method === 'POST') {
    requirePermission(user, 'process:payment')
    const payment = await createPayment(db, await readJson(request), user)
    realtimeHub.publish('reservation.changed', { reason: 'payment_recorded' })
    sendJson(response, payment.replayed ? 200 : 201, { ok: true, data: payment, message: payment.replayed ? 'Payment request replayed.' : 'Payment recorded.' })
    return true
  }

  if (url.pathname === '/api/charges' && request.method === 'POST') {
    requirePermission(user, 'post:charges')
    const charge = await createCharge(db, await readJson(request), user)
    realtimeHub.publish('reservation.changed', { reason: 'charge_posted' })
    sendJson(response, charge.replayed ? 200 : 201, { ok: true, data: charge, message: charge.replayed ? 'Charge request replayed.' : 'Charge posted.' })
    return true
  }

  params = routeParam(url.pathname, /^\/api\/payments\/(?<id>[^/]+)\/reversals$/)
  if (params && request.method === 'POST') {
    requirePermission(user, 'refund:payment')
    const result = await reversePayment(db, params.id, await readJson(request), user)
    realtimeHub.publish('reservation.changed', { reason: 'payment_reversed' })
    sendJson(response, result.replayed ? 200 : 201, { ok: true, data: result, message: result.replayed ? 'Payment reversal request replayed.' : 'Payment reversed.' })
    return true
  }

  params = routeParam(url.pathname, /^\/api\/charges\/(?<id>[^/]+)\/void$/)
  if (params && request.method === 'POST') {
    requirePermission(user, 'post:charges')
    const result = await voidCharge(db, params.id, await readJson(request), user)
    realtimeHub.publish('reservation.changed', { reason: 'charge_voided' })
    sendJson(response, 200, { ok: true, data: result, message: result.replayed ? 'Charge void request replayed.' : 'Charge voided.' })
    return true
  }

  if (url.pathname === '/api/guests' && request.method === 'GET') {
    requirePermission(user, 'view:guests')
    sendJson(response, 200, { ok: true, data: await listGuests(db) })
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

    if (pmsWriteMode === 'read-only' && requestWouldWrite(request, url.pathname)) {
      sendJson(response, 423, {
        ok: false,
        error: 'This PMS service is in read-only rollback mode. Use the active Lite service for operational changes.',
      })
      return
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
    sendJson(response, statusCode, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
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
    realtimeHub.close()
    server.close(async () => {
      await prisma?.$disconnect?.()
      process.exit(0)
    })
  })
}
