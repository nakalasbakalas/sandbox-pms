/* global AbortController, clearTimeout, console, fetch, process, setTimeout, TextDecoder, window */
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
      ACCOUNTING_V2_ENABLED: 'false',
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
  const context = await browser.newContext({ baseURL: baseUrl, viewport: { width: 1440, height: 1000 } })
  await context.addInitScript(() => window.localStorage.clear())
  const login = await context.request.post('/api/auth/login', { data: { identity: username, password } })
  assert.equal(login.status(), 200, `server login failed: ${await login.text()}`)

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
      ])
      return Object.keys(window.localStorage).filter((key) => forbidden.has(key))
    })
    assert.deepEqual(operationalStorageKeys, [], `${label} does not write operational workflow state to browser storage`)
  }

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

  for (const path of ['/settings', '/night-audit', '/system-status', '/internal-comms', '/guest-communications']) {
    await page.goto(path, { waitUntil: 'domcontentloaded' })
    const body = await page.locator('body').innerText()
    assert.equal(body.includes('Access restricted'), false, `${path} remains available in authenticated server mode`)
    assert.equal(body.includes('Something went wrong'), false, `${path} does not render the error boundary`)
    if (path === '/internal-comms' || path === '/guest-communications') {
      assert.match(body, /browser-backed|unavailable/i, `${path} reports its server capability boundary`)
    }
    await assertNoOperationalBrowserStorage(path)
  }

  for (const path of ['/reservations', '/guests', '/cashier', '/rooms', '/channels', '/messaging', '/reports']) {
    await page.goto(path, { waitUntil: 'domcontentloaded' })
    const body = await page.locator('body').innerText()
    assert.equal(body.includes('Access restricted'), false, `${path} remains available in authenticated server mode`)
    assert.equal(body.includes('Something went wrong'), false, `${path} does not render the error boundary`)
    await assertNoOperationalBrowserStorage(path)
  }

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
