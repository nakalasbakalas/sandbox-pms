/* global AbortController, clearTimeout, console, document, fetch, process, setTimeout, TextDecoder, window */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { access } from 'node:fs/promises'
import { createServer as createNetServer } from 'node:net'
import { resolve } from 'node:path'
import { chromium } from 'playwright'
import { assertSafeE2EDatabase, redactDatabaseUrl } from './db-safety.mjs'
import { createPasswordHash } from '../server/security.mjs'
import { recordDomainEvent } from '../server/domain-events.mjs'

const repoRoot = process.cwd()
const e2eDatabaseUrl = assertSafeE2EDatabase()
process.env.DATABASE_URL = e2eDatabaseUrl
const { createPrismaClient } = await import('../server/prisma-client.mjs')
const prisma = createPrismaClient()
const runId = randomUUID().replaceAll('-', '').slice(0, 12)
const username = `server-browser-${runId}`
const password = `Server-Browser-${runId}-Pass!`
const taskTitle = `Server reload task ${runId}`
const ruleName = `Server reload rate ${runId}`
const boardRoomNumber = `B-${runId.slice(0, 8)}`
const boardMoveRoomNumber = `M-${runId.slice(0, 8)}`
const boardGuestOne = `Board Alpha ${runId}`
const boardGuestTwo = `Board Bravo ${runId}`
const boardGuestThree = `Board Charlie ${runId}`
const fakeBoardRoomNumber = `LOCAL-${runId}`
const fakeBoardGuest = `Browser Shadow ${runId}`

function dateKeyWithOffset(offset) {
  const date = new Date()
  date.setUTCHours(12, 0, 0, 0)
  date.setUTCDate(date.getUTCDate() + offset)
  return date.toISOString().slice(0, 10)
}

function availablePort() {
  return new Promise((resolvePort, reject) => {
    const server = createNetServer()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => resolvePort(address.port))
    })
  })
}

function startServer(port) {
  const child = spawn(process.execPath, ['server/index.mjs'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      DATABASE_URL: e2eDatabaseUrl,
      HOST: '127.0.0.1',
      PORT: String(port),
      NODE_ENV: 'test',
      SESSION_SECRET: `server-browser-session-${runId}-01234567890123456789`,
      VITE_PMS_API_MODE: 'server',
      SSE_ENABLED: 'true',
      ACCOUNTING_V2_ENABLED: 'true',
      DIRECT_BOOKING_ENABLED: 'false',
      OTA_LIVE_WRITES_ENABLED: 'false',
      BOOKING_EMAIL_NEAR_LIVE_ENABLED: 'false',
      HOTEL_OPS_SCAN_INTERVAL_MINUTES: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  const collect = (chunk) => {
    output += chunk.toString()
    if (output.length > 20_000) output = output.slice(-20_000)
  }
  child.stdout.on('data', collect)
  child.stderr.on('data', collect)
  return { child, output: () => output }
}

function stopProcessTree(child) {
  if (!child?.pid) return Promise.resolve()
  if (process.platform !== 'win32') {
    child.kill('SIGTERM')
    return Promise.resolve()
  }
  return new Promise((resolveStop) => {
    const killer = spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' })
    killer.on('exit', () => resolveStop())
    killer.on('error', () => resolveStop())
  })
}

function boundedSignal(signal, label, timeoutMs = 15_000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`${label} timed out. Confirm the frontend was built with VITE_PMS_API_MODE=server.`)),
      timeoutMs,
    )
    signal.then(
      (value) => {
        clearTimeout(timeout)
        resolve(value)
      },
      (error) => {
        clearTimeout(timeout)
        reject(error)
      },
    )
  })
}

async function waitForHttp(url, server) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (server.child.exitCode !== null) throw new Error(`PMS server exited early.\n${server.output()}`)
    try {
      const response = await fetch(`${url}/healthz`)
      if (response.ok) return
    } catch {
      // Continue until the local test server is accepting requests.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 200))
  }
  throw new Error(`PMS server did not become ready.\n${server.output()}`)
}

async function apiJson(request, method, path, data) {
  const response = await request.fetch(path, {
    method,
    ...(data === undefined ? {} : { data }),
    headers: data === undefined ? undefined : { 'content-type': 'application/json' },
  })
  const payload = await response.json().catch(() => ({}))
  assert.equal(response.ok(), true, `${method} ${path} failed (${response.status()}): ${payload.error || JSON.stringify(payload)}`)
  return payload
}

async function readNextSseEvent({ url, cookie, lastEventId, trigger }) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15_000)
  try {
    const response = await fetch(`${url}/api/events`, {
      headers: {
        cookie,
        'last-event-id': String(lastEventId),
      },
      signal: controller.signal,
    })
    assert.equal(response.status, 200, 'authenticated SSE connection succeeds')
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    await trigger()
    while (true) {
      const { done, value } = await reader.read()
      if (done) throw new Error('SSE stream closed before an operational event arrived.')
      buffer += decoder.decode(value, { stream: true })
      const frames = buffer.split('\n\n')
      buffer = frames.pop() || ''
      for (const frame of frames) {
        if (!frame.includes('\ndata: ')) continue
        const id = frame.match(/(?:^|\n)id: ([^\n]+)/)?.[1]
        const data = frame.match(/(?:^|\n)data: (.+)$/m)?.[1]
        if (id && data) return { id, data: JSON.parse(data), raw: frame }
      }
    }
  } finally {
    clearTimeout(timeout)
    controller.abort()
  }
}

console.log(`Server-mode browser DB target: ${redactDatabaseUrl(e2eDatabaseUrl)}`)
await access(resolve(repoRoot, 'dist', 'index.html')).catch(() => {
  throw new Error('Server-mode browser tests require a server-mode build. Run VITE_PMS_API_MODE=server npm run build first.')
})

const property = await prisma.property.findUnique({ where: { code: 'SANDBOX' } })
assert.ok(property, 'the guarded E2E seed must provide the SANDBOX property')
const roomType = await prisma.roomType.findFirst({ where: { propertyId: property.id }, orderBy: { code: 'asc' } })
const room = await prisma.room.findFirst({ where: { propertyId: property.id }, orderBy: { number: 'asc' } })
assert.ok(roomType && room, 'the guarded E2E seed must provide room inventory')
const boardRoom = await prisma.room.create({
  data: {
    propertyId: property.id,
    roomTypeId: roomType.id,
    number: boardRoomNumber,
    floor: 99,
    operationalStatus: 'AVAILABLE',
    currentStatus: 'VACANT_CLEAN',
  },
})
const boardMoveRoom = await prisma.room.create({
  data: {
    propertyId: property.id,
    roomTypeId: roomType.id,
    number: boardMoveRoomNumber,
    floor: 99,
    operationalStatus: 'AVAILABLE',
    currentStatus: 'VACANT_CLEAN',
  },
})

await prisma.user.create({
  data: {
    username,
    email: `${username}@example.test`,
    passwordHash: await createPasswordHash(password),
    firstName: 'Server',
    lastName: 'Browser',
    role: 'ADMIN',
    propertyMemberships: { create: { propertyId: property.id, role: 'ADMIN', active: true } },
  },
})

const foreignProperty = await prisma.property.create({
  data: {
    code: `SSE_B_${runId}`,
    name: 'SSE foreign property',
    taxRate: 0,
    taxRateBasisPoints: 0,
    extraGuestFee: 200,
    extraGuestFeeSatang: 20_000n,
    childFee: 100,
    childFeeSatang: 10_000n,
  },
})

const port = await availablePort()
const baseUrl = `http://127.0.0.1:${port}`
const server = startServer(port)
let browser

try {
  await waitForHttp(baseUrl, server)
  const unauthenticatedSse = await fetch(`${baseUrl}/api/events`)
  assert.equal(unauthenticatedSse.status, 401, 'SSE requires an authenticated session')

  browser = await chromium.launch({ headless: true })

  const authRaceContext = await browser.newContext({ baseURL: baseUrl, viewport: { width: 1280, height: 800 } })
  const authRacePage = await authRaceContext.newPage()
  let releaseStaleBootstrap
  let resolveBootstrapIntercepted
  let resolveBootstrapCompleted
  const staleBootstrapRelease = new Promise((resolveRelease) => {
    releaseStaleBootstrap = resolveRelease
  })
  const bootstrapIntercepted = new Promise((resolveIntercepted) => {
    resolveBootstrapIntercepted = resolveIntercepted
  })
  const bootstrapCompleted = new Promise((resolveCompleted) => {
    resolveBootstrapCompleted = resolveCompleted
  })
  await authRacePage.route('**/api/auth/me', async (route) => {
    resolveBootstrapIntercepted()
    await staleBootstrapRelease
    await route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Delayed stale bootstrap response' }),
    })
    resolveBootstrapCompleted()
  })
  await authRacePage.goto('/board', { waitUntil: 'domcontentloaded' })
  await boundedSignal(bootstrapIntercepted, 'Server-auth bootstrap interception')
  await authRacePage.locator('[data-slot="card-title"]', { hasText: 'Sign In' }).waitFor({ state: 'visible' })
  await authRacePage.getByLabel('Username or email').fill(username)
  await authRacePage.getByLabel('Password').fill(password)
  const interactiveLogin = authRacePage.waitForResponse((response) =>
    response.url().endsWith('/api/auth/login') && response.request().method() === 'POST',
  )
  await authRacePage.getByRole('button', { name: 'Sign In', exact: true }).click()
  assert.equal((await interactiveLogin).status(), 200, 'interactive server login succeeds while the bootstrap request is pending')
  releaseStaleBootstrap()
  await boundedSignal(bootstrapCompleted, 'Delayed server-auth bootstrap completion')
  await authRacePage.waitForTimeout(100)
  await authRacePage.getByText('Booking Board', { exact: true }).waitFor({ state: 'visible' })
  assert.equal(
    await authRacePage.locator('[data-slot="card-title"]', { hasText: 'Sign In' }).count(),
    0,
    'a delayed failed bootstrap response cannot clear a newer interactive login',
  )
  assert.equal(
    await authRacePage.evaluate(() => window.localStorage.getItem('auth:current-user')),
    null,
    'interactive server login keeps identity out of browser storage',
  )
  await authRaceContext.close()

  const context = await browser.newContext({ baseURL: baseUrl, viewport: { width: 1440, height: 1000 } })
  await context.addInitScript(({ fakeRoomNumber, fakeGuestName }) => {
    window.localStorage.clear()
    const requestedFixturePath = window.sessionStorage.getItem('inject-local-operational-fixture')
    const isBoardFixture = window.location.pathname === '/board'
    if (!isBoardFixture && window.location.pathname !== requestedFixturePath) return
    if (isBoardFixture && window.sessionStorage.getItem('board-local-fixture-injected') === 'true') return
    if (isBoardFixture) window.sessionStorage.setItem('board-local-fixture-injected', 'true')
    window.localStorage.setItem('pms-rooms', JSON.stringify([{
      id: 'browser-shadow-room',
      number: fakeRoomNumber,
      floor: 88,
      type: 'DOUBLE',
      roomTypeCode: 'DOUBLE',
      status: 'OCCUPIED_CLEAN',
      cleanStatus: 'CLEAN',
    }]))
    window.localStorage.setItem('reservations', JSON.stringify([{
      id: 'browser-shadow-reservation',
      confirmationCode: 'LOCAL-SHADOW',
      guestName: fakeGuestName,
      roomId: 'browser-shadow-room',
      roomNumber: fakeRoomNumber,
      checkIn: '2020-01-01',
      checkOut: '2099-12-31',
      status: 'CONFIRMED',
    }]))
    window.localStorage.setItem('reservations-data', JSON.stringify([{
      id: 'browser-shadow-reservation',
      guestName: fakeGuestName,
      roomNumber: fakeRoomNumber,
    }]))
    window.localStorage.setItem('unassigned-reservations', JSON.stringify([{
      id: 'browser-shadow-unassigned',
      guestName: fakeGuestName,
    }]))
    window.localStorage.setItem('guests', JSON.stringify([{
      id: 'browser-shadow-guest',
      firstName: 'Browser',
      lastName: 'Shadow',
      fullName: fakeGuestName,
    }]))
  }, { fakeRoomNumber: fakeBoardRoomNumber, fakeGuestName: fakeBoardGuest })
  const login = await context.request.post('/api/auth/login', { data: { identity: username, password } })
  assert.equal(login.status(), 200, `server login failed: ${await login.text()}`)

  const credentialContext = await browser.newContext({ baseURL: baseUrl, viewport: { width: 1280, height: 800 } })
  await credentialContext.addInitScript(() => {
    const credentialFixture = {
      completed: false,
      currentStep: 5,
      data: {
        adminUser: {
          name: 'Legacy Admin',
          email: 'legacy-admin@example.test',
          password: 'BrowserStorageMustBeRemoved!',
          confirmPassword: 'BrowserStorageMustBeRemoved!',
        },
      },
    }
    window.localStorage.setItem('onboarding:state', JSON.stringify(credentialFixture))
    window.localStorage.setItem('onboarding:server-state', JSON.stringify(credentialFixture))
    window.localStorage.setItem('onboarding:admin-user', JSON.stringify(credentialFixture.data.adminUser))
    window.localStorage.setItem('onboarding-admin-user', JSON.stringify(credentialFixture.data.adminUser))
    window.localStorage.setItem('auth:current-user', JSON.stringify({
      id: 'browser-stored-user',
      email: 'browser-user@example.test',
      role: 'admin',
    }))
  })
  const credentialLogin = await credentialContext.request.post('/api/auth/login', { data: { identity: username, password } })
  assert.equal(credentialLogin.status(), 200, `credential-cleanup login failed: ${await credentialLogin.text()}`)
  const credentialPage = await credentialContext.newPage()
  await credentialPage.goto('/board', { waitUntil: 'domcontentloaded' })
  await credentialPage.getByText('Loading PMS workspace...', { exact: true }).waitFor({ state: 'hidden' })
  const removedCredentialKeys = await credentialPage.evaluate(() => Object.fromEntries(
    ['onboarding:state', 'onboarding:admin-user', 'onboarding-admin-user', 'auth:current-user']
      .map((key) => [key, window.localStorage.getItem(key)]),
  ))
  assert.deepEqual(removedCredentialKeys, {
    'onboarding:state': null,
    'onboarding:admin-user': null,
    'onboarding-admin-user': null,
    'auth:current-user': null,
  }, 'server mode removes legacy onboarding credentials and browser-stored auth identity')
  const sanitizedServerDraft = await credentialPage.evaluate(() => {
    const raw = window.localStorage.getItem('onboarding:server-state')
    return raw ? JSON.parse(raw) : null
  })
  assert.equal(sanitizedServerDraft?.data?.adminUser?.password, '', 'server onboarding draft removes the password field value')
  assert.equal(sanitizedServerDraft?.data?.adminUser?.confirmPassword, '', 'server onboarding draft removes the confirmation field value')
  await credentialContext.close()

  const boardReservationOne = await apiJson(context.request, 'POST', '/api/reservations', {
    confirmationCode: `BOARD-A-${runId}`,
    guest: {
      firstName: 'Board Alpha',
      lastName: runId,
      email: `board-alpha-${runId}@example.test`,
    },
    roomTypeCode: roomType.code,
    assignedRoomId: boardRoom.id,
    checkIn: dateKeyWithOffset(1),
    checkOut: dateKeyWithOffset(3),
    adults: 1,
    children: 0,
    childAges: [],
    ratePerNight: Math.max(100, Number(roomType.baseRate) || 1_000),
    source: 'DIRECT',
  })
  const boardReservationTwo = await apiJson(context.request, 'POST', '/api/reservations', {
    confirmationCode: `BOARD-B-${runId}`,
    guest: {
      firstName: 'Board Bravo',
      lastName: runId,
      email: `board-bravo-${runId}@example.test`,
    },
    roomTypeCode: roomType.code,
    assignedRoomId: boardRoom.id,
    checkIn: dateKeyWithOffset(4),
    checkOut: dateKeyWithOffset(6),
    adults: 2,
    children: 0,
    childAges: [],
    ratePerNight: Math.max(100, Number(roomType.baseRate) || 1_000),
    source: 'DIRECT',
  })
  assert.notEqual(boardReservationOne.data.id, boardReservationTwo.data.id, 'same-room board stays persist as distinct reservations')
  assert.equal(boardReservationOne.data.assignedRoomId, boardRoom.id, 'first board stay is assigned to the dedicated server room')
  assert.equal(boardReservationTwo.data.assignedRoomId, boardRoom.id, 'second board stay is assigned to the dedicated server room')
  const boardReservationThree = await apiJson(context.request, 'POST', '/api/reservations', {
    confirmationCode: `BOARD-C-${runId}`,
    guest: {
      firstName: 'Board Charlie',
      lastName: runId,
      email: `board-charlie-${runId}@example.test`,
    },
    roomTypeCode: roomType.code,
    checkIn: dateKeyWithOffset(7),
    checkOut: dateKeyWithOffset(9),
    adults: 1,
    children: 0,
    childAges: [],
    ratePerNight: Math.max(100, Number(roomType.baseRate) || 1_000),
    source: 'DIRECT',
  })
  assert.equal(boardReservationThree.data.assignedRoomId, null, 'third board stay begins in the authoritative unassigned queue')

  const housekeeping = await apiJson(context.request, 'POST', '/api/housekeeping/tasks', {
    roomId: room.id,
    kind: 'CLEANING',
    priority: 'HIGH',
    title: taskTitle,
    reason: 'Prove server-mode reload persistence.',
  })
  assert.ok(housekeeping.data.id)

  await apiJson(context.request, 'POST', '/api/rates/rules', {
    name: ruleName,
    description: 'Server-mode reload evidence',
    roomTypeId: roomType.id,
    priority: 10,
    startDate: '2034-01-01',
    endDate: '2034-01-31',
    daysOfWeek: [],
    adjustmentType: 'FIXED_AMOUNT',
    adjustmentSatang: '1000',
    active: true,
    reason: 'Prove server-mode rate persistence.',
  })

  const page = await context.newPage()
  page.setDefaultTimeout(30_000)
  page.setDefaultNavigationTimeout(60_000)
  const assertNoOperationalBrowserStorage = async (label) => {
    const operationalStorageKeys = await page.evaluate(() => {
      const forbidden = new Set([
        'pms-rooms', 'reservations', 'reservations-data', 'unassigned-reservations',
        'guests', 'guests-data', 'folios', 'cashier-folios', 'housekeeping-tasks',
        'night-audit-logs', 'room-types-config', 'rates', 'rate-rules',
        'internal-messages', 'guest-messages', 'messages', 'message-templates',
        'channels', 'channel-reservations', 'channel-sync-logs', 'channel-room-mappings',
        'onboarding-property', 'onboarding-room-types', 'onboarding-rooms',
        'onboarding:state', 'onboarding:admin-user', 'onboarding-admin-user',
        'auth:current-user', 'accounting-entries', 'cash-reconciliations',
      ])
      return Object.keys(window.localStorage).filter((key) => forbidden.has(key))
    })
    assert.deepEqual(operationalStorageKeys, [], `${label} does not write operational workflow state to browser storage`)
  }

  await page.route('**/api/front-desk/board?*', async (route) => {
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ ok: false, error: 'Injected authoritative booking board failure.' }),
    })
  })
  await page.goto('/board', { waitUntil: 'domcontentloaded' })
  await page.getByRole('heading', { name: 'Booking board unavailable' }).waitFor({ state: 'visible' })
  await page.getByText('Injected authoritative booking board failure.', { exact: false }).waitFor({ state: 'visible' })
  assert.equal(await page.getByTestId('server-booking-board').count(), 0, 'an initial board failure renders no operational board rows')
  assert.equal(await page.getByText(`Room ${boardRoomNumber}`, { exact: true }).count(), 0, 'an initial board failure does not retain server room rows')
  assert.equal(await page.getByText(fakeBoardRoomNumber, { exact: false }).count(), 0, 'the server board ignores fake browser room state')
  assert.equal(await page.getByText(fakeBoardGuest, { exact: false }).count(), 0, 'the server board ignores fake browser reservation state')
  const injectedBoardStorage = await page.evaluate((keys) => Object.fromEntries(
    keys.map((key) => [key, window.localStorage.getItem(key)]),
  ), ['pms-rooms', 'reservations', 'reservations-data', 'unassigned-reservations', 'guests'])
  assert.match(injectedBoardStorage['pms-rooms'] || '', new RegExp(fakeBoardRoomNumber), 'the fake room fixture existed while the board ignored it')
  assert.match(injectedBoardStorage.reservations || '', new RegExp(fakeBoardGuest), 'the fake reservation fixture existed while the board ignored it')
  await page.unroute('**/api/front-desk/board?*')
  await page.evaluate((keys) => {
    for (const key of keys) window.localStorage.removeItem(key)
  }, Object.keys(injectedBoardStorage))
  await assertNoOperationalBrowserStorage('server-mode booking board before retry')
  const boardRetry = page.getByRole('button', { name: 'Retry' })
  if (await boardRetry.isVisible().catch(() => false)) {
    await boardRetry.click({ timeout: 5_000 }).catch(() => undefined)
  }
  await page.getByTestId('server-booking-board').waitFor({ state: 'visible' })
  await page.getByText(`Room ${boardRoomNumber}`, { exact: true }).waitFor({ state: 'visible' })
  await page.getByText(boardGuestOne, { exact: true }).waitFor({ state: 'visible' })
  await page.getByText(boardGuestTwo, { exact: true }).waitFor({ state: 'visible' })
  await page.getByText(boardGuestThree, { exact: false }).waitFor({ state: 'visible' })
  assert.equal(await page.getByText(boardGuestOne, { exact: true }).count(), 1, 'the first same-room stay renders as one distinct segment')
  assert.equal(await page.getByText(boardGuestTwo, { exact: true }).count(), 1, 'the second same-room stay renders as one distinct segment')
  assert.equal(await page.getByRole('alert').count(), 0, 'retry replaces the truthful error with authoritative board data')
  await assertNoOperationalBrowserStorage('server-mode booking board after retry')

  let lostAssignmentKey = null
  await page.route(`**/api/reservations/${boardReservationThree.data.id}/assign-room`, async (route) => {
    lostAssignmentKey = route.request().headers()['x-idempotency-key'] || null
    const upstream = await context.request.fetch(route.request().url(), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-idempotency-key': lostAssignmentKey,
      },
      data: JSON.parse(route.request().postData() || '{}'),
    })
    assert.equal(upstream.status(), 200, 'the first assignment reaches the authoritative PMS before its response is lost')
    await route.abort('failed').catch((error) => {
      if (!/already handled/i.test(error instanceof Error ? error.message : String(error))) throw error
    })
  })
  await page.locator(`[data-board-reservation-select="${boardReservationThree.data.id}"]`).click()
  await page.locator(`[data-board-room-action="${boardMoveRoom.id}"]`).click()
  await page.waitForTimeout(100)
  assert.ok(lostAssignmentKey, 'the ambiguous assignment captured an idempotency key')
  await page.unroute(`**/api/reservations/${boardReservationThree.data.id}/assign-room`)
  const assignmentResponse = page.waitForResponse((response) =>
    response.url().endsWith(`/api/reservations/${boardReservationThree.data.id}/assign-room`)
      && response.request().method() === 'POST',
  )
  await page.locator(`[data-board-room-action="${boardMoveRoom.id}"]`).click()
  const assignmentRetry = await assignmentResponse
  assert.equal(assignmentRetry.status(), 200, 'server Booking Board replays the lost assignment safely')
  assert.equal(assignmentRetry.request().headers()['x-idempotency-key'], lostAssignmentKey, 'retry after a lost response reuses the exact logical assignment key')
  await page.locator(`[data-board-reservation-id="${boardReservationThree.data.id}"]`).waitFor({ state: 'visible' })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.locator(`[data-board-reservation-id="${boardReservationThree.data.id}"]`).waitFor({ state: 'visible' })
  let persistedBoardReservation = await prisma.reservation.findUnique({ where: { id: boardReservationThree.data.id } })
  assert.equal(persistedBoardReservation.assignedRoomId, boardMoveRoom.id, 'Board assignment survives a full browser reload')

  await page.locator(`[data-board-reservation-id="${boardReservationThree.data.id}"]`).click()
  await page.getByLabel('Check-in', { exact: true }).fill(dateKeyWithOffset(8))
  await page.getByLabel('Check-out', { exact: true }).fill(dateKeyWithOffset(11))
  const resizeResponse = page.waitForResponse((response) =>
    response.url().endsWith(`/api/reservations/${boardReservationThree.data.id}`)
      && response.request().method() === 'PATCH',
  )
  await page.getByRole('button', { name: 'Update stay dates', exact: true }).click()
  assert.equal((await resizeResponse).status(), 200, 'server Booking Board stay resize succeeds')
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.locator(`[data-board-reservation-id="${boardReservationThree.data.id}"]`).waitFor({ state: 'visible' })
  persistedBoardReservation = await prisma.reservation.findUnique({ where: { id: boardReservationThree.data.id } })
  assert.equal(persistedBoardReservation.checkIn.toISOString().slice(0, 10), dateKeyWithOffset(8), 'Board check-in resize survives reload')
  assert.equal(persistedBoardReservation.checkOut.toISOString().slice(0, 10), dateKeyWithOffset(11), 'Board check-out resize survives reload')

  const staleExpectedUpdatedAt = persistedBoardReservation.updatedAt.toISOString()
  const secondClient = await browser.newContext({ baseURL: baseUrl })
  const secondLogin = await secondClient.request.post('/api/auth/login', { data: { identity: username, password } })
  assert.equal(secondLogin.status(), 200, 'second booking-board client authenticates independently')
  const secondClientUpdate = await secondClient.request.fetch(`/api/reservations/${boardReservationThree.data.id}`, {
    method: 'PATCH',
    data: { checkIn: dateKeyWithOffset(12), checkOut: dateKeyWithOffset(15) },
    headers: {
      'content-type': 'application/json',
      'x-idempotency-key': `browser-second-client-resize-${runId}`,
    },
  })
  assert.equal(secondClientUpdate.status(), 200, 'second client updates the reservation before the stale board submit')
  await secondClient.close()

  await page.locator(`[data-board-reservation-id="${boardReservationThree.data.id}"]`).click()
  let staleResizeHeaders = null
  await page.route(`**/api/reservations/${boardReservationThree.data.id}`, async (route) => {
    staleResizeHeaders = route.request().headers()
    await route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({ ok: false, error: 'Injected stale two-client booking-board conflict.' }),
    })
  })
  await page.getByLabel('Check-in', { exact: true }).fill(dateKeyWithOffset(13))
  await page.getByLabel('Check-out', { exact: true }).fill(dateKeyWithOffset(16))
  await page.getByRole('button', { name: 'Update stay dates', exact: true }).click()
  await page.getByText('Injected stale two-client booking-board conflict.', { exact: false }).waitFor({ state: 'visible' })
  assert.equal(staleResizeHeaders['x-reservation-expected-updated-at'], staleExpectedUpdatedAt, 'stale board editor sends its original authoritative update token')
  assert.ok(staleResizeHeaders['x-reservation-expected-version'], 'stale board editor sends an authoritative version token')
  await page.unroute(`**/api/reservations/${boardReservationThree.data.id}`)
  await page.getByLabel('Check-in', { exact: true }).waitFor({ state: 'visible' })
  await page.waitForFunction((value) => document.querySelector('input[type="date"]')?.value === value, dateKeyWithOffset(12))
  assert.equal(await page.getByLabel('Check-in', { exact: true }).inputValue(), dateKeyWithOffset(12), '409 refetch resets the stale check-in draft to the second client truth')
  assert.equal(await page.getByLabel('Check-out', { exact: true }).inputValue(), dateKeyWithOffset(15), '409 refetch resets the stale check-out draft to the second client truth')

  await page.route(`**/api/reservations/${boardReservationThree.data.id}/assign-room`, async (route) => {
    await route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({ ok: false, error: 'Injected authoritative room-move conflict.' }),
    })
  })
  await page.locator(`[data-board-reservation-id="${boardReservationThree.data.id}"]`).click()
  await page.locator(`[data-board-room-action="${boardRoom.id}"]`).click()
  await page.getByText('Injected authoritative room-move conflict.', { exact: false }).waitFor({ state: 'visible' })
  await page.unroute(`**/api/reservations/${boardReservationThree.data.id}/assign-room`)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.locator(`[data-board-reservation-id="${boardReservationThree.data.id}"]`).waitFor({ state: 'visible' })
  persistedBoardReservation = await prisma.reservation.findUnique({ where: { id: boardReservationThree.data.id } })
  assert.equal(persistedBoardReservation.assignedRoomId, boardMoveRoom.id, 'rejected Board move preserves authoritative room assignment')
  await assertNoOperationalBrowserStorage('server-mode booking board mutations')

  await page.evaluate(() => window.sessionStorage.setItem('inject-local-operational-fixture', '/front-desk'))
  await page.route('**/api/front-desk/board*', async (route) => {
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ ok: false, error: 'Injected front desk authority failure.' }),
    })
  })
  await page.goto('/front-desk', { waitUntil: 'domcontentloaded' })
  await page.getByText('Live PMS board unavailable:', { exact: false }).waitFor({ state: 'visible' })
  assert.equal(await page.getByText(fakeBoardGuest, { exact: false }).count(), 0, 'front desk failure does not display browser reservation data')
  assert.equal(await page.getByText(fakeBoardRoomNumber, { exact: false }).count(), 0, 'front desk failure does not display browser room data')
  await page.getByRole('button', { name: 'Ask about today' }).click()
  await page.getByText('PMS unavailable', { exact: true }).waitFor({ state: 'visible' })
  assert.equal(await page.getByText(fakeBoardGuest, { exact: false }).count(), 0, 'assistant failure does not use browser guest context')
  await page.keyboard.press('Escape')
  await page.unroute('**/api/front-desk/board*')
  await page.evaluate(() => {
    window.sessionStorage.removeItem('inject-local-operational-fixture')
    window.localStorage.clear()
  })

  await page.route('**/api/front-desk/board*', async (route) => {
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 500))
    await route.continue()
  })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'Ask about today' }).click()
  await page.getByText('Live PMS', { exact: true }).waitFor({ state: 'visible' })
  await page.locator('div.ml-8').filter({ hasText: /^Show today's risks$/ }).waitFor({ state: 'visible' })
  assert.equal(await page.getByText('Live PMS records are still loading.', { exact: false }).count(), 0, 'a healthy prefilled assistant request waits for authoritative data')
  await page.keyboard.press('Escape')
  await page.unroute('**/api/front-desk/board*')

  await page.evaluate(() => window.sessionStorage.setItem('inject-local-operational-fixture', '/reports'))
  for (const pattern of ['**/api/front-desk/board*', '**/api/reservations*', '**/api/guests*']) {
    await page.route(pattern, async (route) => {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false, error: 'Injected reports authority failure.' }),
      })
    })
  }
  await page.goto('/reports', { waitUntil: 'domcontentloaded' })
  await page.getByText('Reports unavailable', { exact: true }).waitFor({ state: 'visible' })
  assert.equal(await page.getByText(fakeBoardGuest, { exact: false }).count(), 0, 'reports failure does not display browser reservation data')
  await page.getByRole('button', { name: /Export/ }).waitFor({ state: 'visible' })
  assert.equal(await page.getByRole('button', { name: /Export/ }).isDisabled(), true, 'report export is disabled without authoritative server data')
  for (const pattern of ['**/api/front-desk/board*', '**/api/reservations*', '**/api/guests*']) {
    await page.unroute(pattern)
  }
  await page.getByRole('button', { name: 'Retry authoritative reports' }).click()
  await page.getByText('Reports unavailable', { exact: true }).waitFor({ state: 'hidden' })
  await page.getByRole('button', { name: /Export/ }).click({ trial: true })
  assert.equal(await page.getByRole('button', { name: /Export/ }).isDisabled(), false, 'report retry restores export after authoritative data loads')
  await page.evaluate(() => {
    window.sessionStorage.removeItem('inject-local-operational-fixture')
    window.localStorage.clear()
  })

  await page.goto('/housekeeping', { waitUntil: 'domcontentloaded' })
  await page.getByText(taskTitle, { exact: false }).waitFor({ state: 'visible' })
  await assertNoOperationalBrowserStorage('server-mode housekeeping')
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByText(taskTitle, { exact: false }).waitFor({ state: 'visible' })

  await page.route('**/api/housekeeping/tasks*', async (route) => {
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'Injected guarded reload failure.' }) })
  })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByText('Injected guarded reload failure.', { exact: false }).waitFor({ state: 'visible' })
  await page.unroute('**/api/housekeeping/tasks*')
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByText(taskTitle, { exact: false }).waitFor({ state: 'visible' })

  await page.goto('/rates', { waitUntil: 'domcontentloaded' })
  await page.getByRole('combobox').first().click()
  await page.getByRole('option', { name: roomType.name, exact: true }).click()
  await page.getByRole('tab', { name: /Rules/ }).click()
  await page.getByText(ruleName, { exact: false }).waitFor({ state: 'visible' })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByRole('combobox').first().click()
  await page.getByRole('option', { name: roomType.name, exact: true }).click()
  await page.getByRole('tab', { name: /Rules/ }).click()
  await page.getByText(ruleName, { exact: false }).waitFor({ state: 'visible' })

  for (const path of ['/settings', '/night-audit', '/system-status', '/internal-comms', '/guest-communications', '/daily-summary', '/data-backup']) {
    await page.goto(path, { waitUntil: 'domcontentloaded' })
    await page.getByText('Loading PMS workspace...', { exact: true }).waitFor({ state: 'hidden' })
    const body = await page.locator('body').innerText()
    assert.equal(body.includes('Access restricted'), false, `${path} remains available in authenticated server mode`)
    assert.equal(body.includes('Something went wrong'), false, `${path} does not render the error boundary`)
    if (['/internal-comms', '/guest-communications', '/daily-summary', '/data-backup'].includes(path)) {
      assert.match(body, /browser-backed|unavailable/i, `${path} reports its server capability boundary`)
    }
    await assertNoOperationalBrowserStorage(path)
  }

  for (const path of ['/reservations', '/guests', '/cashier', '/rooms', '/channels', '/messaging', '/reports']) {
    await page.goto(path, { waitUntil: 'domcontentloaded' })
    await page.getByText('Loading PMS workspace...', { exact: true }).waitFor({ state: 'hidden' })
    const body = await page.locator('body').innerText()
    assert.equal(body.includes('Access restricted'), false, `${path} remains available in authenticated server mode`)
    assert.equal(body.includes('Something went wrong'), false, `${path} does not render the error boundary`)
    await assertNoOperationalBrowserStorage(path)
  }

  await page.goto('/cashier', { waitUntil: 'domcontentloaded' })
  await page.getByRole('tab', { name: 'Accounting', exact: true }).click()
  await page.getByText('Accounting dashboard unavailable in server mode', { exact: true }).waitFor({ state: 'visible' })
  await page.getByRole('tab', { name: 'Reconciliation', exact: true }).click()
  await page.getByText('Cash reconciliation unavailable in server mode', { exact: true }).waitFor({ state: 'visible' })
  await assertNoOperationalBrowserStorage('server-mode accounting capability gate')

  await page.keyboard.press('Control+K')
  await page.getByPlaceholder('Type a command or search...').waitFor({ state: 'visible' })
  for (const label of [
    'Staff Communications',
    'Guest Communications',
    'Send Email',
    'Daily Summary Report',
    'Data Backup & Export',
  ]) {
    assert.equal(await page.getByText(label, { exact: true }).count(), 0, `${label} is not presented as an operational server command`)
  }
  await page.keyboard.press('Escape')

  const lastEvent = await prisma.domainEvent.findFirst({ orderBy: { id: 'desc' }, select: { id: true } })
  const after = lastEvent?.id || 0n
  await recordDomainEvent(prisma, {
    propertyId: foreignProperty.id,
    eventType: 'SSE_FOREIGN_PROPERTY',
    aggregateType: 'releaseGate',
    aggregateId: `foreign-${runId}`,
  })
  const cookies = await context.cookies(baseUrl)
  const cookieHeader = cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ')
  const event = await readNextSseEvent({
    url: baseUrl,
    cookie: cookieHeader,
    lastEventId: after,
    trigger: () => apiJson(context.request, 'POST', '/api/housekeeping/tasks', {
      roomId: room.id,
      kind: 'INSPECTION',
      priority: 'NORMAL',
      title: `SSE task ${runId}`,
      reason: 'Prove authenticated SSE catch-up and filtering.',
    }),
  })
  assert.match(event.id, /^\d+$/)
  assert.equal(event.data.aggregateType, 'housekeepingTask')
  assert.equal(event.raw.includes(`foreign-${runId}`), false, 'SSE catch-up omits foreign-property events')

  console.log('Server-mode Playwright reload, error-truth, and SSE gates passed.')
} finally {
  await browser?.close().catch(() => undefined)
  await stopProcessTree(server.child)
  await prisma.$disconnect()
}
