/* global console, document, fetch, process, setTimeout, window */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, readdir, readFile } from 'node:fs/promises'
import { createServer as createNetServer } from 'node:net'
import { dirname, extname, join, resolve } from 'node:path'
import { chromium } from 'playwright'
import { assertSafeE2EDatabase } from './db-safety.mjs'
import { loadEnvDefaults } from './env-utils.mjs'
import { prepareE2EDatabase } from './prepare-e2e-db.mjs'
import { resolveApiRouteContract } from '../server/api-routes.mjs'
import { createLoginThrottle, resolveClientIp } from '../server/login-throttle.mjs'
import { canPerformAction, canViewRoute } from '../server/rbac.mjs'
import { requestSetupToken, requireSetupPermission, setupTokenRequired } from '../server/setup-permission.mjs'
import { signOpsWorkerRequest } from '../server/ops-worker-auth.mjs'
import {
  calculateStayPricing,
  isSellableRoomNumber,
  normalizePaymentMethod,
  paymentMethodRequiresReference,
  reservationsOverlap,
  roomStatusForHousekeeping,
  PmsValidationError,
} from '../server/pms-domain.mjs'

loadEnvDefaults()

const runDbWorkflow = process.argv.includes('--db') || process.env.npm_lifecycle_event === 'test:e2e:db'
const repoRoot = process.cwd()
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const AUTHENTICATED_ROUTE_SMOKE_PATHS = [
  '/',
  '/board',
  '/rooms',
  '/booking-inbox',
  '/front-desk',
  '/reservations',
  '/guests',
  '/housekeeping',
  '/tablet-housekeeping',
  '/cashier',
  '/rates',
  '/channels',
  '/growth-suite',
  '/reports',
  '/settings',
  '/messaging',
  '/internal-comms',
  '/guest-communications',
  '/daily-summary',
  '/night-audit',
  '/revenue-analytics',
  '/predictive-analytics',
  '/system-status',
  '/user-management',
  '/data-backup',
  '/ops-chat',
  '/ops-approvals',
  '/ops-tasks',
  '/ops-intelligence',
  '/ops-settings',
]

function sleep(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms))
}

function hashLocalPassword(password, salt) {
  return createHash('sha256').update(`${salt}:${password}`).digest('hex')
}

function bangkokDateKey(offsetDays = 0) {
  const base = new Date()
  base.setUTCDate(base.getUTCDate() + offsetDays)
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(base)

  const year = parts.find((part) => part.type === 'year')?.value
  const month = parts.find((part) => part.type === 'month')?.value
  const day = parts.find((part) => part.type === 'day')?.value
  return `${year}-${month}-${day}`
}

function browserSmokeSeed() {
  const password = 'E2E-Secure-Password-123!'
  const passwordSalt = 'e2e-local-login-salt'
  const today = bangkokDateKey()
  const yesterday = bangkokDateKey(-1)
  const tomorrow = bangkokDateKey(1)
  const createdAt = new Date().toISOString()
  const user = {
    id: 'e2e-admin-user',
    email: 'e2e-admin@property.test',
    username: 'e2e-admin@property.test',
    role: 'admin',
    displayName: 'E2E Admin',
    createdAt,
    passwordSalt,
    passwordHash: hashLocalPassword(password, passwordSalt),
  }
  const property = {
    name: 'SANDBOX HOTEL',
    address: '626/1 Karom Rd., Pho Sadet',
    city: 'Mueang, Nakhon Si Thammarat 80000',
    country: 'Thailand',
    phone: '+66 88-578-3478',
    email: 'booking@sandboxhotel.com',
    website: 'https://www.sandboxhotel.com',
    taxId: '',
    timeZone: 'Asia/Bangkok',
    currency: 'THB',
    defaultCheckIn: '14:00',
    defaultCheckOut: '12:00',
    brandColor: '#2563eb',
    receiptFooter: '',
    taxConfiguration: { enabled: false, pricesIncludeTax: false, taxes: [] },
  }
  const roomTypes = [
    { id: 'double', code: 'DOUBLE', name: 'Superior Double', baseRate: 2000, baseOccupancy: 2, maxOccupancy: 4, extraGuestFee: 300, childFreeAge: 5, childFeeAge: 11, childFee: 300 },
    { id: 'twin', code: 'TWIN', name: 'Standard Twin', baseRate: 2000, baseOccupancy: 2, maxOccupancy: 2, extraGuestFee: 300, childFreeAge: 5, childFeeAge: 11, childFee: 300 },
  ]
  const rooms = [
    {
      roomId: 'room-201',
      number: '201',
      floor: 2,
      type: 'DOUBLE',
      roomTypeId: 'double',
      status: 'VACANT_CLEAN',
      operationalStatus: 'AVAILABLE',
      cleanStatus: 'INSPECTED',
      housekeepingStatus: 'INSPECTED',
      depositStatus: 'NONE',
      isArrivalToday: false,
      isDepartureToday: false,
      isVIP: false,
      hasIssue: false,
      needsAttention: false,
    },
    {
      roomId: 'room-202',
      number: '202',
      floor: 2,
      type: 'DOUBLE',
      roomTypeId: 'double',
      status: 'OCCUPIED_CLEAN',
      operationalStatus: 'AVAILABLE',
      cleanStatus: 'CLEAN',
      housekeepingStatus: 'CLEAN',
      depositStatus: 'PAID',
      isArrivalToday: false,
      isDepartureToday: true,
      isVIP: false,
      hasIssue: false,
      needsAttention: false,
      reservationId: 'res-departure',
      currentReservationId: 'res-departure',
      guestName: 'E2E Departing Guest',
      checkIn: yesterday,
      checkOut: today,
      guestCount: 2,
      balanceDue: 0,
      reservation: {
        id: 'SBX-E2E-DEP',
        guestName: 'E2E Departing Guest',
        checkIn: yesterday,
        checkOut: today,
        status: 'CHECKED_IN',
        totalAmount: 2000,
        balanceDue: 0,
        depositStatus: 'PAID',
      },
    },
  ]
  const seed = {
    'system:users': [user],
    'auth:current-user': null,
    'onboarding:completed': true,
    'onboarding-property': property,
    'onboarding-room-types': roomTypes,
    'onboarding-rooms': [
      { id: 'room-201', number: '201', roomTypeId: 'double', floor: 2, status: 'available', notes: '' },
      { id: 'room-202', number: '202', roomTypeId: 'double', floor: 2, status: 'available', notes: '' },
    ],
    'onboarding-rates': [
      { roomTypeId: 'double', baseRate: 2000, taxInclusive: false },
      { roomTypeId: 'twin', baseRate: 2000, taxInclusive: false },
    ],
    'room-types-config': roomTypes.map((roomType) => ({ id: roomType.id, code: roomType.code, name: roomType.name, baseRate: roomType.baseRate, baseOccupancy: roomType.baseOccupancy, maxOccupancy: roomType.maxOccupancy })),
    'pms-rooms': rooms,
    'unassigned-reservations': [
      {
        id: 'res-arrival',
        guestName: 'E2E Arrival Guest',
        roomType: 'DOUBLE',
        checkIn: today,
        checkOut: tomorrow,
        guestCount: 2,
        nights: 1,
        source: 'Direct',
        ratePerNight: 2000,
        totalAmount: 2000,
        depositAmount: 2000,
        balanceDue: 0,
        paidAmount: 2000,
      },
    ],
    reservations: [],
    'reservations-data': [],
    guests: [{ id: 'legacy-sparse-guest', name: 'Legacy Sparse Guest' }],
    'guests-data': [{ id: 'legacy-sparse-guest', name: 'Legacy Sparse Guest' }],
    folios: [],
    'cashier-folios': [],
  }

  return {
    email: user.email,
    password,
    seed,
  }
}

async function availablePort() {
  return new Promise((resolvePort, reject) => {
    const server = createNetServer()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => resolvePort(address.port))
    })
  })
}

function startVite(port) {
  const args = ['run', 'dev', '--', '--host', '127.0.0.1', '--port', String(port), '--strictPort', '--force']
  const child = process.platform === 'win32'
    ? spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', [npm, ...args].join(' ')], {
      cwd: repoRoot,
      env: {
        ...process.env,
        SPARK_VITE_PORT: String(port),
        VITE_PMS_API_MODE: '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    : spawn(npm, args, {
    cwd: repoRoot,
    env: {
      ...process.env,
      SPARK_VITE_PORT: String(port),
      VITE_PMS_API_MODE: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  const collect = (chunk) => {
    output += chunk.toString()
    if (output.length > 12_000) output = output.slice(-12_000)
  }
  child.stdout.on('data', collect)
  child.stderr.on('data', collect)
  return { child, output: () => output }
}

function startApiServer(port) {
  const child = spawn(process.execPath, ['server/index.mjs'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
      NODE_ENV: 'test',
      OTA_WORKER_SHARED_SECRET: 'route-test-worker-secret',
      OTA_WORKER_BASE_URL: `http://127.0.0.1:${port}/api/internal/ops/worker/tasks`,
      BOOKING_USERNAME: 'route-test-booking-user',
      BOOKING_PASSWORD: 'route-test-booking-password',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  const collect = (chunk) => {
    output += chunk.toString()
    if (output.length > 12_000) output = output.slice(-12_000)
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
    const killer = spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], {
      stdio: 'ignore',
    })
    killer.on('exit', () => resolveStop())
    killer.on('error', () => resolveStop())
  })
}

async function waitForHttp(url, server) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (server.child.exitCode !== null) {
      throw new Error(`Vite dev server exited early.\n${server.output()}`)
    }
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {
      // Keep polling until Vite is ready.
    }
    await sleep(250)
  }
  throw new Error(`Vite dev server did not become ready.\n${server.output()}`)
}

async function waitVisible(locator, label) {
  await locator.waitFor({ state: 'visible', timeout: 15_000 }).catch((error) => {
    throw new Error(`${label} was not visible: ${error.message}`)
  })
}

async function smokeAuthenticatedRoute(page, baseUrl, path) {
  await page.goto(`${baseUrl}${path}`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => !document.body.innerText.includes('Loading PMS workspace'), null, { timeout: 20_000 })

  const bodyText = await page.locator('body').innerText({ timeout: 5_000 })
  assert.notEqual(bodyText.trim(), '', `${path} rendered a blank body`)
  assert.equal(bodyText.includes('Page not found'), false, `${path} rendered Page not found`)
  assert.equal(bodyText.includes('Access restricted'), false, `${path} rendered Access restricted`)
  assert.equal(bodyText.includes('Something went wrong'), false, `${path} rendered the error boundary`)
}

async function runBrowserSmokeTests() {
  const port = await availablePort()
  const baseUrl = `http://127.0.0.1:${port}`
  const server = startVite(port)

  try {
    await waitForHttp(baseUrl, server)
    const browser = await chromium.launch({ headless: true })
    const errors = []
    let currentStep = 'browser setup'
    const setStep = (step) => {
      currentStep = step
    }

    try {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
      const { email, password, seed } = browserSmokeSeed()
      await context.addInitScript((storageSeed) => {
        if (window.localStorage.getItem('__e2e_seeded') === 'true') return
        window.localStorage.clear()
        for (const [key, value] of Object.entries(storageSeed)) {
          window.localStorage.setItem(key, JSON.stringify(value))
        }
        window.localStorage.setItem('__e2e_seeded', 'true')
      }, seed)

      const page = await context.newPage()
      page.setDefaultTimeout(60_000)
      page.setDefaultNavigationTimeout(60_000)
      page.on('pageerror', (error) => errors.push(`[${currentStep}] ${error.stack || error.message}`))
      page.on('console', async (message) => {
        if (message.type() === 'error') {
          const location = message.location()
          const suffix = location.url ? ` (${location.url}:${location.lineNumber}:${location.columnNumber})` : ''
          const args = []
          for (const arg of message.args()) {
            try {
              args.push(await arg.jsonValue())
            } catch {
              // Ignore unserializable console arguments.
            }
          }
          const details = args.length ? ` args=${JSON.stringify(args)}` : ''
          errors.push(`[${currentStep}] ${message.text()}${suffix}${details}`)
        }
      })

      setStep('login')
      await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })
      await waitVisible(page.getByRole('heading', { name: /hotel pms/i }), 'login screen')
      await page.getByLabel(/username or email/i).fill(email)
      await page.getByLabel(/password/i).fill(password)
      await page.getByRole('button', { name: /^sign in$/i }).click()
      await waitVisible(page.getByRole('heading', { name: /^today$/i }), 'Today view after login')

      const legacyToken = await page.evaluate(() => window.localStorage.getItem(['auth', 'pms-token'].join(':')))
      assert.equal(legacyToken, null, 'browser login does not write a JavaScript-readable session token')

      setStep('open board from today')
      await page.getByRole('button', { name: /open front desk board/i }).click()
      await waitVisible(page.getByRole('heading', { name: /front desk board/i }), 'Board navigation')

      setStep('front desk checkout')
      await page.goto(`${baseUrl}/front-desk`, { waitUntil: 'domcontentloaded' })
      await waitVisible(page.getByText('E2E Departing Guest').first(), 'seeded departure')
      await page.getByRole('button', { name: /^express check-out$/i }).first().click()
      await waitVisible(page.getByRole('heading', { name: /express check-out: e2e departing guest/i }), 'checkout dialog')
      await page.getByRole('button', { name: /confirm express check-out/i }).click()
      await page.waitForFunction(() => {
        const rooms = JSON.parse(window.localStorage.getItem('pms-rooms') || '[]')
        return rooms.some((room) => room.number === '202' && room.status === 'VACANT_DIRTY' && !room.guestName)
      }, { timeout: 10_000 })

      setStep('front desk check-in')
      await waitVisible(page.getByText('E2E Arrival Guest').first(), 'seeded arrival')
      await page.getByRole('button', { name: /^assign room$/i }).first().click()
      await waitVisible(page.getByRole('heading', { name: /check in: e2e arrival guest/i }), 'check-in dialog')
      await page.getByRole('button', { name: /^assign best room$/i }).first().click()
      await page.getByLabel(/nationality/i).fill('Thai')
      await page.getByLabel(/id\/passport/i).fill('E2E-ID-001')
      await page.locator('[role="dialog"]').getByRole('button', { name: /complete|confirm/i }).last().click()
      await page.waitForFunction(() => {
        const rooms = JSON.parse(window.localStorage.getItem('pms-rooms') || '[]')
        return rooms.some((room) => room.number === '201' && room.status === 'OCCUPIED_CLEAN' && room.guestName === 'E2E Arrival Guest')
      }, { timeout: 10_000 })

      setStep('board extra item load')
      await page.goto(`${baseUrl}/board`, { waitUntil: 'domcontentloaded' })
      await waitVisible(page.getByRole('heading', { name: /front desk board/i }), 'Board after check-in')
      setStep('board extra item open overlay')
      await page.getByText('E2E Arrival Guest').last().click()
      await waitVisible(page.getByRole('heading', { name: /reservation .*e2e arrival guest/i }), 'reservation detail overlay')
      setStep('board extra item view reservation')
      await page.getByRole('button', { name: /view reservation/i }).click()
      await page.getByRole('tab', { name: /extra items/i }).click()
      setStep('board extra item fill form')
      await page.locator('#reservation-extra-description').fill('Late checkout')
      await page.locator('#reservation-extra-unit').fill('250')
      await page.locator('#reservation-extra-quantity').fill('2')
      setStep('board extra item submit')
      await page.getByRole('button', { name: /^add$/i }).click()
      setStep('board extra item verify storage')
      await page.waitForFunction(() => {
        const folios = [
          ...JSON.parse(window.localStorage.getItem('folios') || '[]'),
          ...JSON.parse(window.localStorage.getItem('cashier-folios') || '[]'),
        ]
        return folios.some((folio) =>
          folio.reservationId === 'res-arrival' &&
          Number(folio.balance) === 500 &&
          folio.charges?.some((charge) => charge.description === 'Late checkout' && Number(charge.total) === 500)
        )
      }, { timeout: 10_000 })
      setStep('board extra item close overlay')
      await page.getByRole('button', { name: /^close$/i }).click()

      for (const path of AUTHENTICATED_ROUTE_SMOKE_PATHS) {
        setStep(`route smoke ${path}`)
        await smokeAuthenticatedRoute(page, baseUrl, path)
      }

      assert.deepEqual(errors, [], `browser console/page errors: ${errors.join('\n')}`)
      await context.close()
    } finally {
      await browser.close()
    }
  } finally {
    await stopProcessTree(server.child)
  }

  console.log('Playwright browser smoke passed.')
}

async function runInternalWorkerRouteSmoke() {
  const port = await availablePort()
  const baseUrl = `http://127.0.0.1:${port}`
  const server = startApiServer(port)

  try {
    await waitForHttp(`${baseUrl}/api/health`, server)

    const unsignedResponse = await fetch(`${baseUrl}/api/internal/ops/worker/tasks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ taskId: 'route-task-unsigned', taskType: 'READ_RATES', platform: 'agoda' }),
    })
    assert.equal(unsignedResponse.status, 401, 'internal worker endpoint rejects unsigned requests')

    const invalidSignedRequest = signOpsWorkerRequest({
      taskId: 'route-task-invalid',
      taskType: 'FORBIDDEN',
      platform: 'agoda',
    }, { secret: 'route-test-worker-secret' })
    const invalidResponse = await fetch(`${baseUrl}/api/internal/ops/worker/tasks`, {
      method: 'POST',
      headers: invalidSignedRequest.headers,
      body: invalidSignedRequest.body,
    })
    assert.equal(invalidResponse.status, 400, 'internal worker endpoint rejects disallowed signed tasks')

    const validSignedRequest = signOpsWorkerRequest({
      taskId: 'route-task-valid',
      taskType: 'UPDATE_RATE',
      platform: 'booking',
      roomType: 'Deluxe Room',
      dateStart: '2026-07-03',
      dateEnd: '2026-07-04',
      rate: { amount: 2200, currency: 'THB' },
      dryRun: true,
    }, { secret: 'route-test-worker-secret' })
    const validResponse = await fetch(`${baseUrl}/api/internal/ops/worker/tasks`, {
      method: 'POST',
      headers: validSignedRequest.headers,
      body: validSignedRequest.body,
    })
    assert.equal(validResponse.status, 200, 'internal worker endpoint accepts signed allowed tasks')
    const payload = await validResponse.json()
    assert.equal(payload.data.status, 'SUCCEEDED', 'internal worker route returns a structured execution result')
    assert.equal(payload.data.data.dryRun, true, 'internal worker route defaults to dry-run execution')
    assert.equal(payload.data.proofScreenshots.length, 2, 'internal worker route returns Booking.com dry-run proof placeholders')
    assert.equal(JSON.stringify(payload).includes('route-test-booking-password'), false, 'internal worker route never returns OTA credentials')
  } finally {
    await stopProcessTree(server.child)
  }

  console.log('Internal worker route smoke passed.')
}

async function markdownFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const fullPath = join(directory, entry.name)
    if (entry.isDirectory()) {
      if (['.git', 'node_modules', 'dist'].includes(entry.name)) continue
      files.push(...await markdownFiles(fullPath))
    } else if (entry.isFile() && extname(entry.name).toLowerCase() === '.md') {
      files.push(fullPath)
    }
  }
  return files
}

async function runDocumentationLinkSmoke() {
  const failures = []
  const linkPattern = /!?\[[^\]]*\]\(([^)]+)\)/g

  for (const file of await markdownFiles(repoRoot)) {
    const source = await readFile(file, 'utf8')
    for (const match of source.matchAll(linkPattern)) {
      const rawTarget = match[1].trim()
      if (
        !rawTarget ||
        rawTarget.startsWith('#') ||
        /^[a-z][a-z0-9+.-]*:/i.test(rawTarget)
      ) {
        continue
      }
      const targetWithoutAnchor = rawTarget.split('#')[0]
      if (!targetWithoutAnchor) continue
      const decodedTarget = decodeURIComponent(targetWithoutAnchor)
      const resolvedTarget = resolve(dirname(file), decodedTarget)
      await access(resolvedTarget).catch(() => failures.push(`${file}: ${rawTarget}`))
    }
  }

  assert.deepEqual(failures, [], `broken local documentation links:\n${failures.join('\n')}`)
  console.log('Documentation link smoke passed.')
}

const admin = { id: 'e2e-admin', role: 'ADMIN', email: 'admin@property.test' }
const manager = { id: 'e2e-manager', role: 'MANAGER', email: 'manager@property.test' }
const frontDesk = { id: 'e2e-front-desk', role: 'FRONT_DESK', email: 'frontdesk@property.test' }
const housekeeping = { id: 'e2e-housekeeping', role: 'HOUSEKEEPING', email: 'housekeeping@property.test' }

assert.equal(canViewRoute(admin, 'user-management'), true, 'admin can view user management')
assert.equal(canViewRoute(admin, 'ops-settings'), true, 'admin can view Hotel Ops settings')
assert.equal(canViewRoute(manager, 'ops-approvals'), true, 'manager can view Hotel Ops approvals')
assert.equal(canViewRoute(frontDesk, 'ops-chat'), true, 'front desk can submit Hotel Ops read commands')
assert.equal(canViewRoute(frontDesk, 'ops-settings'), false, 'front desk cannot view Hotel Ops settings')
assert.equal(canViewRoute(housekeeping, 'ops-tasks'), true, 'housekeeping can view Hotel Ops task history')
assert.equal(canViewRoute(housekeeping, 'ops-chat'), false, 'housekeeping cannot submit Hotel Ops commands')
assert.equal(canViewRoute(housekeeping, 'ops-approvals'), false, 'housekeeping cannot approve Hotel Ops tasks')
assert.equal(canViewRoute(manager, 'ops-settings'), false, 'manager cannot change Hotel Ops settings')
assert.equal(canViewRoute(frontDesk, 'user-management'), false, 'front desk cannot view user management')
assert.equal(canViewRoute(frontDesk, 'channels'), false, 'front desk cannot view channel management')
assert.equal(canViewRoute(manager, 'channels'), true, 'manager can view channel management')
assert.equal(canViewRoute(housekeeping, 'tablet-housekeeping'), true, 'housekeeping can view tablet housekeeping')
assert.equal(canViewRoute(frontDesk, 'does-not-exist'), false, 'unknown routes are denied by default')
assert.equal(canPerformAction(frontDesk, 'check-in:guest'), true, 'front desk can check in guests')
assert.equal(canPerformAction(frontDesk, 'override:check-in'), false, 'front desk cannot override check-in blockers')
assert.equal(canPerformAction(admin, 'override:check-out'), true, 'admin can override checkout blockers')
assert.equal(canPerformAction(manager, 'edit:rates'), true, 'manager server permissions match rate UI access')
assert.equal(canPerformAction(frontDesk, 'send:guest-messages'), true, 'front desk server permissions match guest messaging UI access')
assert.equal(canPerformAction(housekeeping, 'process:payment'), false, 'housekeeping cannot process payments')
assert.deepEqual(resolveApiRouteContract('/api/auth/login')?.methods, ['POST'], 'auth login only allows POST')
assert.deepEqual(resolveApiRouteContract('/api/users')?.methods, ['GET', 'POST'], 'user collection exposes admin read/create methods')
assert.deepEqual(resolveApiRouteContract('/api/users/user-1')?.methods, ['PATCH', 'DELETE'], 'user detail exposes admin update/deactivate methods')
assert.deepEqual(resolveApiRouteContract('/api/ops/commands')?.methods, ['POST'], 'Hotel Ops command endpoint accepts command posts')
assert.deepEqual(resolveApiRouteContract('/api/ops/tasks')?.methods, ['GET'], 'Hotel Ops task history exposes read method')
assert.deepEqual(resolveApiRouteContract('/api/ops/tasks/task-1')?.methods, ['GET'], 'Hotel Ops task detail exposes read method')
assert.deepEqual(resolveApiRouteContract('/api/ops/tasks/task-1/approve')?.methods, ['POST'], 'Hotel Ops approve endpoint only allows POST')
assert.deepEqual(resolveApiRouteContract('/api/ops/tasks/task-1/run')?.methods, ['POST'], 'Hotel Ops queued task runner only allows POST')
assert.deepEqual(resolveApiRouteContract('/api/ops/approvals')?.methods, ['GET'], 'Hotel Ops approvals expose read method')
assert.deepEqual(resolveApiRouteContract('/api/ops/notifications')?.methods, ['GET'], 'Hotel Ops notifications expose read method')
assert.deepEqual(resolveApiRouteContract('/api/ops/intelligence/alerts/alert-1/approve-recommendation')?.methods, ['POST'], 'Hotel Ops recommendation approval exposes mutation method')
assert.deepEqual(resolveApiRouteContract('/api/ops/intelligence/alerts/alert-1/acknowledge')?.methods, ['POST'], 'Hotel Ops alert acknowledge exposes mutation method')
assert.deepEqual(resolveApiRouteContract('/api/ops/intelligence/alerts/alert-1/resolve')?.methods, ['POST'], 'Hotel Ops alert resolve exposes mutation method')
assert.deepEqual(resolveApiRouteContract('/api/ops/emergency-stop')?.methods, ['GET', 'POST'], 'Hotel Ops emergency stop exposes read/update methods')
assert.deepEqual(resolveApiRouteContract('/api/ops/ota/status')?.methods, ['GET'], 'Hotel Ops OTA status exposes read method')
assert.deepEqual(resolveApiRouteContract('/api/ops/scan/run')?.methods, ['POST'], 'Hotel Ops scan run exposes mutation method')
assert.deepEqual(resolveApiRouteContract('/api/internal/ops/worker/tasks')?.methods, ['POST'], 'Hotel Ops internal worker endpoint only accepts signed posts')
assert.deepEqual(resolveApiRouteContract('/api/reservations')?.methods, ['GET', 'POST'], 'reservations collection exposes read/create methods')
assert.deepEqual(resolveApiRouteContract('/api/reservations/res-1/check-in')?.methods, ['POST'], 'check-in mutation only allows POST')
assert.deepEqual(resolveApiRouteContract('/api/booking-email/status')?.methods, ['GET'], 'booking email status exposes read method')
assert.deepEqual(resolveApiRouteContract('/api/booking-email/sync')?.methods, ['POST'], 'booking email sync exposes mutation method')
assert.deepEqual(resolveApiRouteContract('/api/booking-email/events')?.methods, ['GET'], 'booking email events expose read methods')
assert.deepEqual(resolveApiRouteContract('/api/booking-email/events/event-1/approve')?.methods, ['POST'], 'booking email approve mutation only allows POST')
assert.deepEqual(resolveApiRouteContract('/api/booking-email/events/event-1/reprocess')?.methods, ['POST'], 'booking email reprocess mutation only allows POST')
assert.deepEqual(resolveApiRouteContract('/api/booking-email/sources')?.methods, ['GET', 'POST'], 'booking email sources expose read/create methods')
assert.deepEqual(resolveApiRouteContract('/api/booking-email/sources/source-1')?.methods, ['PATCH'], 'booking email source detail exposes update method')
assert.deepEqual(resolveApiRouteContract('/api/channels/ical/booking-com')?.methods, ['POST', 'DELETE'], 'iCal channel route exposes publish/disable methods')
assert.equal(resolveApiRouteContract('/api/does-not-exist'), null, 'unknown API routes fall through to 404')
assert.equal(isSellableRoomNumber('201'), true, 'room 201 is sellable')
assert.equal(isSellableRoomNumber('216'), true, 'sellability is driven by room configuration, not a fixed room-number list')
assert.equal(isSellableRoomNumber(''), false, 'blank room numbers are not sellable')
assert.equal(reservationsOverlap('2026-05-27', '2026-05-29', '2026-05-29', '2026-05-30'), false, 'same-day turnover is allowed')
assert.equal(reservationsOverlap('2026-05-27', '2026-05-30', '2026-05-29', '2026-05-31'), true, 'overlapping stays are rejected')
assert.equal(roomStatusForHousekeeping('OCCUPIED_CLEAN', 'DIRTY'), 'OCCUPIED_DIRTY', 'occupied dirty status is preserved')
assert.equal(roomStatusForHousekeeping('VACANT_DIRTY', 'INSPECTED'), 'INSPECTED', 'inspection status is represented')
assert.equal(normalizePaymentMethod('CARD'), 'CARD', 'card payment method is accepted')
assert.equal(normalizePaymentMethod('promptpay'), 'BANK_TRANSFER', 'PromptPay maps to bank transfer for folio posting')
assert.throws(() => normalizePaymentMethod('negative-test-method'), PmsValidationError, 'invalid payment methods are rejected')
assert.equal(paymentMethodRequiresReference('CASH'), false, 'cash payment does not require a provider reference')
assert.equal(paymentMethodRequiresReference('CARD'), true, 'card payment requires a provider reference')
assert.equal(paymentMethodRequiresReference('promptpay'), true, 'PromptPay/bank transfer payment requires a provider reference')
assert.equal(requestSetupToken({ headers: { 'x-setup-token': ' launch-token ' } }), 'launch-token', 'setup token can be supplied through x-setup-token')
assert.equal(requestSetupToken({ headers: { authorization: 'Bearer bearer-token' } }), 'bearer-token', 'setup token can be supplied through bearer auth')
assert.equal(setupTokenRequired({ INITIAL_SETUP_TOKEN: 'launch-token' }), true, 'setup status reports when a setup token is configured')
assert.doesNotThrow(
  () => requireSetupPermission({ headers: { 'x-setup-token': 'launch-token' } }, { NODE_ENV: 'production', INITIAL_SETUP_TOKEN: 'launch-token' }),
  'production setup accepts the configured setup token',
)
assert.throws(
  () => requireSetupPermission({ headers: {} }, { NODE_ENV: 'production', INITIAL_SETUP_TOKEN: 'launch-token' }),
  /valid setup token/,
  'production setup rejects missing setup token when one is configured',
)
assert.throws(
  () => requireSetupPermission({ headers: {} }, { NODE_ENV: 'production' }),
  /Public first-run setup is disabled/,
  'production setup rejects public first-run setup by default',
)
assert.doesNotThrow(
  () => requireSetupPermission({ headers: {} }, { NODE_ENV: 'production', ALLOW_PUBLIC_SETUP: 'true' }),
  'production setup can be explicitly opened only through ALLOW_PUBLIC_SETUP=true',
)

const pricing = calculateStayPricing({
  checkIn: '2026-05-27',
  checkOut: '2026-05-29',
  adults: 3,
  childAges: [],
  ratePerNight: 1500,
})
assert.equal(pricing.total, 3600, 'extra adult fee is charged for each night')
assert.equal(
  assertSafeE2EDatabase({
    ALLOW_DB_E2E: 'true',
    E2E_DATABASE_URL: 'postgresql://sandbox:sandbox@localhost:55432/sandbox_hotel_e2e?schema=public',
  }),
  'postgresql://sandbox:sandbox@localhost:55432/sandbox_hotel_e2e?schema=public',
  'E2E DB guard allows explicit disposable databases',
)
assert.throws(
  () => assertSafeE2EDatabase({
    ALLOW_DB_E2E: 'true',
    E2E_DATABASE_URL: 'postgresql://user:pass@db.internal:5432/sandbox_hotel_pms?schema=public',
  }),
  /production-like marker/,
  'E2E DB guard blocks production-like database names',
)
assert.throws(
  () => assertSafeE2EDatabase({
    ALLOW_DB_E2E: 'false',
    E2E_DATABASE_URL: 'postgresql://sandbox:sandbox@localhost:55432/sandbox_hotel_e2e?schema=public',
  }),
  /ALLOW_DB_E2E=true/,
  'E2E DB guard requires explicit opt-in',
)

const loginThrottle = createLoginThrottle({
  windowMs: 60_000,
  lockoutMs: 30_000,
  accountMaxAttempts: 2,
  ipMaxAttempts: 3,
})
assert.equal(loginThrottle.check({ email: 'ADMIN@PROPERTY.TEST', ip: '203.0.113.10' }, 1_000).allowed, true, 'first login attempt is allowed')
assert.equal(loginThrottle.recordFailure({ email: 'admin@property.test', ip: '203.0.113.10' }, 1_000).allowed, true, 'first bad password is recorded without lockout')
const accountLockout = loginThrottle.recordFailure({ email: 'ADMIN@PROPERTY.TEST', ip: '203.0.113.10' }, 2_000)
assert.equal(accountLockout.allowed, false, 'repeated bad password locks account scope')
assert.equal(accountLockout.scope, 'account', 'account lockout is reported')
assert.equal(loginThrottle.check({ email: 'admin@property.test', ip: '203.0.113.10' }, 3_000).allowed, false, 'locked account blocks subsequent attempts')
assert.equal(loginThrottle.check({ email: 'admin@property.test', ip: '203.0.113.10' }, 33_000).allowed, true, 'account lockout expires after retry window')
loginThrottle.reset()
loginThrottle.recordFailure({ email: 'one@property.test', ip: '203.0.113.20' }, 1_000)
loginThrottle.recordFailure({ email: 'two@property.test', ip: '203.0.113.20' }, 2_000)
const ipLockout = loginThrottle.recordFailure({ email: 'three@property.test', ip: '203.0.113.20' }, 3_000)
assert.equal(ipLockout.allowed, false, 'bad attempts across accounts lock IP scope')
assert.equal(ipLockout.scope, 'ip', 'IP lockout is reported')
const previousTrustProxyHeaders = process.env.TRUST_PROXY_HEADERS
delete process.env.TRUST_PROXY_HEADERS
assert.equal(
  resolveClientIp({ headers: { 'x-forwarded-for': '198.51.100.7, 10.0.0.1' }, socket: { remoteAddress: '127.0.0.1' } }),
  '127.0.0.1',
  'login throttle ignores forwarded client IP unless proxy header trust is enabled',
)
process.env.TRUST_PROXY_HEADERS = 'true'
assert.equal(
  resolveClientIp({ headers: { 'x-forwarded-for': '198.51.100.7, 10.0.0.1' }, socket: { remoteAddress: '127.0.0.1' } }),
  '198.51.100.7',
  'login throttle uses first forwarded client IP when proxy header trust is enabled',
)
if (previousTrustProxyHeaders === undefined) delete process.env.TRUST_PROXY_HEADERS
else process.env.TRUST_PROXY_HEADERS = previousTrustProxyHeaders

await runDocumentationLinkSmoke()
await runInternalWorkerRouteSmoke()
await runBrowserSmokeTests()

if (!runDbWorkflow) {
  console.log('E2E contract and browser smoke checks passed.')
  console.log('Database-mutating workflow e2e not requested. Run npm run test:e2e:db with ALLOW_DB_E2E=true and E2E_DATABASE_URL set to a disposable/staging database.')
  process.exit(0)
}

let e2eDatabaseUrl
try {
  e2eDatabaseUrl = assertSafeE2EDatabase()
  await prepareE2EDatabase()
  process.env.DATABASE_URL = e2eDatabaseUrl
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}

const { createPrismaClient } = await import('../server/prisma-client.mjs')
const {
  assignRoom,
  cancelReservation,
  checkInReservation,
  checkOutReservation,
  createReservation,
} = await import('../server/pms-service.mjs')

const prisma = createPrismaClient()

try {
  const twinRoom = await prisma.room.findFirst({
    where: {
      roomType: { code: 'TWIN' },
      operationalStatus: 'AVAILABLE',
      currentStatus: { in: ['VACANT_CLEAN', 'INSPECTED'] },
    },
    include: { roomType: true },
    orderBy: { number: 'asc' },
  })
  assert.ok(twinRoom, 'a sellable twin room must exist')

  const reservation = await createReservation(prisma, {
    guest: {
      firstName: 'E2E',
      lastName: `Guest ${Date.now()}`,
      email: `e2e-${Date.now()}@property.test`,
    },
    roomTypeCode: 'TWIN',
    checkIn: '2027-01-10',
    checkOut: '2027-01-12',
    adults: 2,
    children: 0,
    childAges: [],
    ratePerNight: 1500,
    source: 'DIRECT',
  }, admin)

  const assigned = await assignRoom(prisma, reservation.id, twinRoom.id, frontDesk)
  assert.equal(assigned.assignedRoomId, twinRoom.id, 'room assignment persists')

  const checkedIn = await checkInReservation(prisma, reservation.id, admin, {
    allowDateOverride: true,
    overrideReason: 'Disposable database workflow test uses future stay dates.',
    guest: {
      nationality: 'Thai',
      idNumber: 'E2E-ID',
      idType: 'ID',
    },
    payment: {
      amount: assigned.folio.balance,
      method: 'CASH',
    },
  })
  assert.equal(checkedIn.status, 'CHECKED_IN', 'check-in persists')
  assert.equal(checkedIn.folio.balance, 0, 'check-in payment settles folio')

  const checkedOut = await checkOutReservation(prisma, reservation.id, frontDesk)
  assert.equal(checkedOut.status, 'CHECKED_OUT', 'check-out persists')

  await cancelReservation(prisma, reservation.id, admin, 'CANCELLED', 'E2E cleanup marker').catch(() => undefined)
  console.log('Database workflow e2e passed.')
} finally {
  await prisma.$disconnect()
}
