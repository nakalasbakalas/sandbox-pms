import { createServer } from 'node:http'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { dirname, extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { canViewRoute, requirePermission } from './rbac.mjs'
import { clearSessionCookie, createSessionToken, readBearerOrCookie, sessionCookie, verifySessionToken } from './security.mjs'
import {
  assignRoom,
  authenticateUser,
  cancelReservation,
  checkInReservation,
  checkOutReservation,
  createGuest,
  createPayment,
  createReservation,
  getAuthenticatedUser,
  getFrontDeskBoard,
  getTodayData,
  listGuests,
  listReservations,
  listRooms,
  updateReservation,
  updateGuest,
  updateHousekeepingStatus,
} from './pms-service.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const distDir = resolve(__dirname, '..', 'dist')
const port = Number(process.env.PORT || 10000)
const host = process.env.HOST || '0.0.0.0'
const MAX_JSON_BODY_BYTES = 1_000_000

let prisma

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

async function getPrisma() {
  if (!process.env.DATABASE_URL) {
    const error = new Error('DATABASE_URL is not configured.')
    error.statusCode = 503
    throw error
  }

  if (!prisma) {
    const { PrismaClient } = await import('@prisma/client')
    prisma = new PrismaClient()
  }
  return prisma
}

function sendJson(response, statusCode, payload, headers = {}) {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...headers,
  })
  response.end(JSON.stringify(payload))
}

function sendNoContent(response, headers = {}) {
  response.writeHead(204, {
    'cache-control': 'no-store',
    ...headers,
  })
  response.end()
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

function publicUser(user) {
  if (!user) return null
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    displayName: `${user.firstName} ${user.lastName}`.trim(),
  }
}

async function requireUser(request) {
  const session = verifySessionToken(readBearerOrCookie(request))
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
    const { PrismaClient } = await import('@prisma/client')
    prisma = new PrismaClient()
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
    response.writeHead(200, {
      'content-type': contentType,
      'cache-control': filePath.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable',
    })

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

  sendJson(response, 501, {
    ok: false,
    error: 'LINE webhook processing is not implemented in this backend shell yet.',
  })
}

async function handleApi(request, response, url) {
  const db = await getPrisma()

  if (request.method === 'OPTIONS') {
    sendNoContent(response)
    return true
  }

  if (url.pathname === '/api/auth/login' && request.method === 'POST') {
    const body = await readJson(request)
    const user = await authenticateUser(db, body.email, body.password)
    if (!user) {
      sendJson(response, 401, { ok: false, error: 'Invalid email or password.' })
      return true
    }
    const token = createSessionToken(user)
    sendJson(response, 200, { ok: true, user: publicUser(user), token }, { 'set-cookie': sessionCookie(token) })
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

  const user = await requireUser(request)

  if (url.pathname === '/api/auth/can-view' && request.method === 'GET') {
    sendJson(response, 200, { ok: true, allowed: canViewRoute(user, url.searchParams.get('route')) })
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

  if (url.pathname === '/api/rooms' && request.method === 'GET') {
    requirePermission(user, 'view:board')
    sendJson(response, 200, { ok: true, data: await listRooms(db) })
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

  let params = routeParam(url.pathname, /^\/api\/reservations\/(?<id>[^/]+)$/)
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
    const reservation = await checkInReservation(db, params.id, user)
    sendJson(response, 200, { ok: true, data: reservation, message: 'Check-in complete. Room is now occupied.' })
    return true
  }

  params = routeParam(url.pathname, /^\/api\/reservations\/(?<id>[^/]+)\/check-out$/)
  if (params && request.method === 'POST') {
    requirePermission(user, 'check-out:guest')
    const body = await readJson(request)
    const reservation = await checkOutReservation(db, params.id, user, { allowUnpaidOverride: Boolean(body.allowUnpaidOverride) })
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

  if (url.pathname === '/api/payments' && request.method === 'POST') {
    requirePermission(user, 'process:payment')
    const payment = await createPayment(db, await readJson(request), user)
    sendJson(response, 201, { ok: true, data: payment, message: 'Payment recorded.' })
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

    if (request.method === 'GET' && (url.pathname === '/healthz' || url.pathname === '/api/health')) {
      await sendHealth(request, response)
      return
    }

    if (url.pathname === '/api/line/webhook') {
      await handleLineWebhook(request, response)
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
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(async () => {
      await prisma?.$disconnect?.()
      process.exit(0)
    })
  })
}
