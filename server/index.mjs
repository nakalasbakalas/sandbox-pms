import { createServer } from 'node:http'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { dirname, extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEnvDefaults } from '../scripts/env-utils.mjs'
import { resolveApiRouteContract } from './api-routes.mjs'
import { loginThrottle, resolveClientIp } from './login-throttle.mjs'
import { createPrismaClient } from './prisma-client.mjs'
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
const CORS_ALLOW_HEADERS = `content-type, authorization, x-setup-token, ${OPS_WORKER_SIGNATURE_HEADER}, ${OPS_WORKER_TIMESTAMP_HEADER}, ${OPS_WORKER_NONCE_HEADER}`
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

function publicUser(user) {
  if (!user) return null
  return {
    id: user.id,
    email: user.email || null,
    username: user.username,
    role: user.role,
    displayName: `${user.firstName} ${user.lastName}`.trim(),
    active: user.active,
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
  } catch (error) {
    return {
      configured: true,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }
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
    sendJson(response, 200, {
      ok: true,
      configured: Boolean(process.env.LINE_CHANNEL_SECRET && process.env.LINE_CHANNEL_ACCESS_TOKEN),
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

  sendJson(response, 200, { ok: true, received: events.length })
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
    const reservation = await createWalkInCheckIn(db, await readJson(request), user)
    sendJson(response, 201, { ok: true, data: reservation, message: `Walk-in checked in to Room ${reservation.assignedRoom?.number}.` })
    return true
  }

  if (url.pathname === '/api/booking-email/status' && request.method === 'GET') {
    requirePermission(user, 'view:reservations')
    sendJson(response, 200, { ok: true, data: await getBookingEmailStatus(db) })
    return true
  }

  if (url.pathname === '/api/booking-email/sync' && request.method === 'POST') {
    requirePermission(user, 'edit:reservation')
    const result = await syncBookingEmail(db, await readJson(request), user)
    sendJson(response, 200, { ok: true, data: result.status, events: result.events, message: `Booking email sync processed ${result.events.length} event${result.events.length === 1 ? '' : 's'}.` })
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
      }),
    })
    return true
  }

  let params

  params = routeParam(url.pathname, /^\/api\/booking-email\/events\/(?<id>[^/]+)$/)
  if (params && request.method === 'GET') {
    requirePermission(user, 'view:reservations')
    sendJson(response, 200, { ok: true, data: await getBookingEmailEvent(db, params.id) })
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
    sendJson(response, 200, { ok: true, data: await listBookingEmailSources(db) })
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
    sendJson(response, 200, { ok: true, data: await listReservations(db) })
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
    const reservation = await updateReservation(db, params.id, await readJson(request), user)
    sendJson(response, 200, { ok: true, data: reservation, message: `Reservation ${reservation.confirmationCode} updated.` })
    return true
  }

  params = routeParam(url.pathname, /^\/api\/reservations\/(?<id>[^/]+)\/assign-room$/)
  if (params && request.method === 'POST') {
    requirePermission(user, 'edit:reservation')
    const body = await readJson(request)
    const reservation = await assignRoom(db, params.id, body.roomId, user)
    sendJson(response, 200, { ok: true, data: reservation, message: 'Room assigned successfully.' })
    return true
  }

  params = routeParam(url.pathname, /^\/api\/reservations\/(?<id>[^/]+)\/check-in$/)
  if (params && request.method === 'POST') {
    requirePermission(user, 'check-in:guest')
    const reservation = await checkInReservation(db, params.id, user, await readJson(request))
    sendJson(response, 200, { ok: true, data: reservation, message: 'Check-in complete. Room is now occupied.' })
    return true
  }

  params = routeParam(url.pathname, /^\/api\/reservations\/(?<id>[^/]+)\/check-out$/)
  if (params && request.method === 'POST') {
    requirePermission(user, 'check-out:guest')
    const body = await readJson(request)
    const reservation = await checkOutReservation(db, params.id, user, body)
    sendJson(response, 200, { ok: true, data: reservation, message: 'Check-out complete. Room has been sent to housekeeping.' })
    return true
  }

  params = routeParam(url.pathname, /^\/api\/reservations\/(?<id>[^/]+)\/cancel$/)
  if (params && request.method === 'POST') {
    requirePermission(user, 'cancel:reservation')
    const body = await readJson(request)
    const reservation = await cancelReservation(db, params.id, user, 'CANCELLED', body.reason || body.notes)
    sendJson(response, 200, { ok: true, data: reservation, message: 'Reservation cancelled.' })
    return true
  }

  params = routeParam(url.pathname, /^\/api\/reservations\/(?<id>[^/]+)\/no-show$/)
  if (params && request.method === 'POST') {
    requirePermission(user, 'cancel:reservation')
    const body = await readJson(request)
    const reservation = await cancelReservation(db, params.id, user, 'NO_SHOW', body.reason || body.notes)
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
    const payment = await createPayment(db, await readJson(request), user)
    sendJson(response, 201, { ok: true, data: payment, message: 'Payment recorded.' })
    return true
  }

  if (url.pathname === '/api/charges' && request.method === 'POST') {
    requirePermission(user, 'post:charges')
    const charge = await createCharge(db, await readJson(request), user)
    sendJson(response, 201, { ok: true, data: charge, message: 'Charge posted.' })
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

    if (request.method === 'GET' && (url.pathname === '/healthz' || url.pathname === '/api/health')) {
      await sendHealth(request, response)
      return
    }

    if (url.pathname === '/api/line/webhook') {
      await handleLineWebhook(request, response)
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
    server.close(async () => {
      await prisma?.$disconnect?.()
      process.exit(0)
    })
  })
}
