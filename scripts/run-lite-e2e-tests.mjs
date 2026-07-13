/* global console, document, fetch, process, setTimeout, window */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { createServer as createNetServer } from 'node:net'
import { chromium } from 'playwright'

import { assertSafeE2EDatabase, parseDatabaseUrl } from './db-safety.mjs'
import { loadEnvDefaults } from './env-utils.mjs'
import { prepareE2EDatabase } from './prepare-e2e-db.mjs'
import { reconcileMoneySatang } from './reconcile-money-satang.mjs'
import { bin, run } from './run-command.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const TEST_PASSWORD = 'Lite-E2E-Test-Only!2026'
const TEST_USERS = {
  admin: {
    username: 'lite.e2e.admin',
    firstName: 'Lite',
    lastName: 'Admin',
    role: 'ADMIN',
    password: TEST_PASSWORD,
  },
  frontDesk: {
    username: 'lite.e2e.frontdesk',
    firstName: 'Lite',
    lastName: 'Front Desk',
    role: 'FRONT_DESK',
    password: TEST_PASSWORD,
  },
  housekeeping: {
    username: 'lite.e2e.housekeeping',
    firstName: 'Lite',
    lastName: 'Housekeeping',
    role: 'HOUSEKEEPING',
    password: TEST_PASSWORD,
  },
}

function sleep(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms))
}

function sanitizeProcessOutput(value) {
  return String(value || '')
    .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, '[redacted-database-url]')
    .slice(-12_000)
}

function isolatedDatabaseTarget(baseDatabaseUrl) {
  const url = parseDatabaseUrl(baseDatabaseUrl, 'E2E_DATABASE_URL')
  const schema = `lite_e2e_${Date.now()}_${randomUUID().replaceAll('-', '').slice(0, 12)}`
  url.searchParams.set('schema', schema)
  return { schema, url: url.toString() }
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

function startLiteServer({ port, databaseUrl }) {
  const child = spawn(process.execPath, ['server/index.mjs'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
      NODE_ENV: 'test',
      DATABASE_URL: databaseUrl,
      PMS_UI_VARIANT: 'lite',
      PMS_WRITE_MODE: 'active',
      SESSION_SECRET: randomBytes(48).toString('base64url'),
      APP_URL: `http://127.0.0.1:${port}`,
      ALLOWED_ORIGINS: `http://127.0.0.1:${port}`,
      BOOKING_EMAIL_GMAIL_PUBSUB_ENABLED: 'false',
      HOTEL_OPS_SCAN_INTERVAL_MINUTES: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  const collect = (chunk) => {
    output += chunk.toString()
    if (output.length > 24_000) output = output.slice(-24_000)
  }
  child.stdout.on('data', collect)
  child.stderr.on('data', collect)
  return { child, output: () => sanitizeProcessOutput(output) }
}

async function stopProcessTree(child) {
  if (!child?.pid || child.exitCode !== null) return

  if (process.platform === 'win32') {
    await new Promise((resolveStop) => {
      const killer = spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' })
      killer.on('exit', resolveStop)
      killer.on('error', resolveStop)
    })
    return
  }

  child.kill('SIGTERM')
  await Promise.race([
    new Promise((resolveExit) => child.once('exit', resolveExit)),
    sleep(5_000).then(() => child.kill('SIGKILL')),
  ])
}

async function waitForLiteServer(baseUrl, server) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (server.child.exitCode !== null) {
      throw new Error(`Lite server exited before becoming healthy.\n${server.output()}`)
    }
    try {
      const response = await fetch(`${baseUrl}/healthz?deep=1`)
      const payload = await response.json()
      if (response.ok && payload.uiVariant === 'lite' && payload.database?.ok === true) return
    } catch {
      // The server may still be opening its listener or first database connection.
    }
    await sleep(250)
  }
  throw new Error(`Lite server did not become healthy.\n${server.output()}`)
}

async function visible(locator, label, timeout = 20_000) {
  await locator.waitFor({ state: 'visible', timeout }).catch((error) => {
    throw new Error(`${label} was not visible: ${error.message}`)
  })
  return locator
}

function collectPageErrors(page, label) {
  const errors = []
  let expectedHttpFailure = false
  let expectedUnauthorized = false
  page.on('pageerror', (error) => errors.push(`${label}: ${error.stack || error.message}`))
  page.on('console', (message) => {
    if (message.type() !== 'error') return
    if (expectedUnauthorized && /401|unauthorized/i.test(message.text())) return
    if (expectedHttpFailure && /400|bad request|api\/reservations/i.test(message.text())) return
    errors.push(`${label}: ${message.text()}`)
  })
  return {
    errors,
    expectHttpFailure(value) {
      expectedHttpFailure = value
    },
    expectUnauthorized(value) {
      expectedUnauthorized = value
    },
  }
}

async function login(page, user, expectedHeading, errors) {
  errors.expectUnauthorized(true)
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await visible(page.getByRole('heading', { name: 'PMS Lite', exact: true }), 'PMS Lite login')
  await page.getByLabel('Username or email', { exact: true }).fill(user.username)
  await page.getByLabel('Password', { exact: true }).fill(user.password)
  await page.getByRole('button', { name: 'Log in', exact: true }).click()
  await visible(page.getByRole('heading', { name: expectedHeading, exact: true }), `${expectedHeading} after login`)
  errors.expectUnauthorized(false)
}

async function openBookings(page) {
  await page.getByRole('button', { name: /Bookings/i }).click()
  await visible(page.getByRole('heading', { name: 'Bookings', exact: true }), 'Bookings workspace')
}

async function assertNoDocumentOverflow(page, label) {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }))
  assert.ok(
    dimensions.scrollWidth <= dimensions.clientWidth + 1,
    `${label} overflows the document horizontally (${dimensions.scrollWidth}px > ${dimensions.clientWidth}px).`,
  )
}

async function queryBookings(context, baseUrl, query) {
  const response = await context.request.get(`${baseUrl}/api/lite/v1/bookings?limit=30&query=${encodeURIComponent(query)}`)
  const payload = await response.json()
  assert.equal(response.status(), 200, `booking query failed: ${JSON.stringify(payload)}`)
  return payload.data.items
}

async function runBrowserProof(baseUrl) {
  const browser = await chromium.launch({ headless: true })
  const runId = randomUUID().replaceAll('-', '').slice(0, 10)
  const failedGuest = `Failed Mutation ${runId}`
  const syncedGuest = `Live Sync ${runId}`
  const contexts = []
  const errorCollectors = []

  try {
    const adminContext = await browser.newContext({ baseURL: baseUrl, viewport: { width: 1440, height: 900 } })
    const frontDeskContext = await browser.newContext({ baseURL: baseUrl, viewport: { width: 1280, height: 800 } })
    const housekeepingContext = await browser.newContext({ baseURL: baseUrl, viewport: { width: 820, height: 1180 } })
    contexts.push(adminContext, frontDeskContext, housekeepingContext)

    const adminPage = await adminContext.newPage()
    const frontDeskPage = await frontDeskContext.newPage()
    const housekeepingPage = await housekeepingContext.newPage()
    for (const page of [adminPage, frontDeskPage, housekeepingPage]) {
      page.setDefaultTimeout(20_000)
      page.setDefaultNavigationTimeout(30_000)
    }
    const adminErrors = collectPageErrors(adminPage, 'admin desktop')
    const frontDeskErrors = collectPageErrors(frontDeskPage, 'front desk browser')
    const housekeepingErrors = collectPageErrors(housekeepingPage, 'housekeeping tablet')
    errorCollectors.push(adminErrors, frontDeskErrors, housekeepingErrors)

    await login(adminPage, TEST_USERS.admin, 'Front Desk', adminErrors)
    await login(frontDeskPage, TEST_USERS.frontDesk, 'Front Desk', frontDeskErrors)
    await login(housekeepingPage, TEST_USERS.housekeeping, 'Housekeeping', housekeepingErrors)
    await visible(housekeepingPage.getByText('Live updates connected', { exact: true }), 'housekeeping live event connection')

    await assertNoDocumentOverflow(adminPage, 'desktop Front Desk')

    await openBookings(frontDeskPage)
    await frontDeskPage.getByPlaceholder('Search guest, reference, or confirmation').fill(syncedGuest)
    await frontDeskPage.getByRole('button', { name: 'Search', exact: true }).click()
    await visible(frontDeskPage.getByText('Nothing needs attention here.', { exact: true }), 'empty pre-sync booking result')
    await visible(frontDeskPage.getByText('Live updates connected', { exact: true }), 'front desk live event connection')

    await openBookings(adminPage)
    const newBookingButton = adminPage.getByRole('button', { name: 'New booking', exact: true })
    await newBookingButton.waitFor({ state: 'visible' })
    await newBookingButton.click()
    const dialog = adminPage.getByRole('dialog', { name: 'New booking', exact: true })
    await visible(dialog, 'new booking dialog')
    await dialog.getByLabel('First name', { exact: true }).fill('Failed')
    await dialog.getByLabel('Last name', { exact: true }).fill(`Mutation ${runId}`)

    let rewriteNextReservation = true
    await adminPage.route('**/api/reservations', async (route) => {
      if (rewriteNextReservation && route.request().method() === 'POST') {
        rewriteNextReservation = false
        const input = route.request().postDataJSON()
        await route.continue({ postData: JSON.stringify({ ...input, roomTypeCode: 'NOT_A_REAL_ROOM_TYPE' }) })
        return
      }
      await route.continue()
    })

    adminErrors.expectHttpFailure(true)
    await dialog.getByRole('button', { name: 'Save', exact: true }).click()
    await visible(dialog.locator('.form-error'), 'backend mutation error')
    adminErrors.expectHttpFailure(false)
    assert.match(await dialog.locator('.form-error').innerText(), /room type|not found/i)
    assert.equal(await dialog.isVisible(), true, 'failed mutation must keep the editor open')
    assert.equal((await queryBookings(adminContext, baseUrl, failedGuest)).length, 0, 'failed mutation must not create a booking')

    await adminPage.unroute('**/api/reservations')
    await dialog.getByLabel('First name', { exact: true }).fill('Live')
    await dialog.getByLabel('Last name', { exact: true }).fill(`Sync ${runId}`)
    await dialog.getByRole('button', { name: 'Save', exact: true }).click()
    await dialog.waitFor({ state: 'hidden' })

    await visible(frontDeskPage.getByText(syncedGuest, { exact: true }), 'booking propagated to second browser', 15_000)
    const persisted = await queryBookings(adminContext, baseUrl, syncedGuest)
    assert.equal(persisted.length, 1, 'successful booking must be persisted once')
    assert.equal(persisted[0].guest.displayName, syncedGuest)

    const operationalLocalStorageKeys = await frontDeskPage.evaluate(() => Object.keys(window.localStorage))
    assert.deepEqual(operationalLocalStorageKeys, [], 'operational data must not be stored in localStorage')

    await frontDeskPage.getByRole('button', { name: 'ภาษาไทย', exact: true }).click()
    await visible(frontDeskPage.getByRole('heading', { name: 'การจอง', exact: true }), 'Thai bookings heading')
    assert.equal(await frontDeskPage.evaluate(() => document.documentElement.lang), 'th')
    assert.equal(await frontDeskPage.evaluate(() => window.localStorage.getItem('pms-lite-language')), 'th')
    await frontDeskPage.getByRole('button', { name: /ฟรอนต์ออฟฟิศ/ }).click()
    await visible(frontDeskPage.getByRole('heading', { name: 'ฟรอนต์ออฟฟิศ', exact: true }), 'Thai Front Desk flow')
    await frontDeskPage.getByRole('button', { name: '02 การจอง', exact: true }).click()
    await visible(frontDeskPage.getByText(syncedGuest, { exact: true }), 'server booking in Thai flow')

    await frontDeskPage.evaluate(() => window.localStorage.clear())
    await frontDeskPage.reload({ waitUntil: 'domcontentloaded' })
    await visible(frontDeskPage.getByRole('heading', { name: 'Bookings', exact: true }), 'English booking view after localStorage clear')
    await visible(frontDeskPage.getByText(syncedGuest, { exact: true }), 'server booking after localStorage clear')
    assert.deepEqual(await frontDeskPage.evaluate(() => Object.keys(window.localStorage)), [])

    assert.equal(await housekeepingPage.getByRole('button', { name: /Bookings/i }).count(), 0, 'housekeeping nav must hide Bookings')
    assert.equal(await housekeepingPage.getByRole('button', { name: /Booking Board/i }).count(), 0, 'housekeeping nav must hide the guest-facing booking board')
    assert.equal(await housekeepingPage.getByRole('button', { name: /Settings/i }).count(), 0, 'housekeeping nav must hide Settings')
    const forbiddenBookings = await housekeepingContext.request.get(`${baseUrl}/api/lite/v1/bookings?limit=1`)
    assert.equal(forbiddenBookings.status(), 403, 'housekeeping API access to Bookings must be denied')
    const forbiddenBoard = await housekeepingContext.request.get(`${baseUrl}/api/lite/v1/board?from=2026-07-13&to=2026-07-14`)
    assert.equal(forbiddenBoard.status(), 403, 'housekeeping API access to the guest-facing booking board must be denied')
    await housekeepingPage.goto('/settings', { waitUntil: 'domcontentloaded' })
    await visible(housekeepingPage.getByRole('heading', { name: 'Housekeeping', exact: true }), 'RBAC fallback from Settings')
    await visible(housekeepingPage.getByText(/Room 201/).first(), 'tablet housekeeping room card')
    await assertNoDocumentOverflow(housekeepingPage, 'tablet Housekeeping')

    for (const collector of errorCollectors) {
      assert.deepEqual(collector.errors, [], `unexpected browser errors:\n${collector.errors.join('\n')}`)
    }

    console.log('Lite database E2E passed: real server/build, two-browser live refresh, failed-mutation handling, server persistence, RBAC, desktop/tablet layout, and EN/TH flows.')
  } finally {
    await Promise.all(contexts.map((context) => context.close().catch(() => undefined)))
    await browser.close()
  }
}

async function dropIsolatedSchema(databaseUrl, schema) {
  const { createPrismaClient } = await import('../server/prisma-client.mjs')
  const prisma = createPrismaClient(databaseUrl)
  try {
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    console.log('Removed the isolated Lite E2E database schema.')
  } finally {
    await prisma.$disconnect()
  }
}

async function assertMoneyParity(databaseUrl, label) {
  const { createPrismaClient } = await import('../server/prisma-client.mjs')
  const prisma = createPrismaClient(databaseUrl)
  try {
    const report = await reconcileMoneySatang(prisma)
    assert.equal(
      report.status,
      'PASS',
      `${label} money reconciliation failed: ${JSON.stringify(report.totals)}`,
    )
    console.log(`${label} money reconciliation passed (${report.totals.comparedValues} compared values).`)
  } finally {
    await prisma.$disconnect()
  }
}

async function main() {
  process.chdir(repoRoot)
  loadEnvDefaults()

  const guardedBaseDatabaseUrl = assertSafeE2EDatabase()
  const target = isolatedDatabaseTarget(guardedBaseDatabaseUrl)
  const previousRuntimeDatabaseUrl = process.env.DATABASE_URL
  let server
  let databasePreparationStarted = false

  try {
    process.env.E2E_DATABASE_URL = target.url
    delete process.env.DATABASE_URL
    process.env.SEED_MODE = 'e2e'
    process.env.SEED_USERS_JSON = JSON.stringify(Object.values(TEST_USERS))

    await run(bin('npm'), ['run', 'build:lite'], {
      env: {
        VITE_PMS_API_MODE: 'server',
        PMS_UI_VARIANT: 'lite',
      },
    })
    databasePreparationStarted = true
    await prepareE2EDatabase()
    await assertMoneyParity(target.url, 'Post-seed')

    const port = await availablePort()
    const baseUrl = `http://127.0.0.1:${port}`
    server = startLiteServer({ port, databaseUrl: target.url })
    await waitForLiteServer(baseUrl, server)
    await runBrowserProof(baseUrl)
    await assertMoneyParity(target.url, 'Post-browser')
  } finally {
    await stopProcessTree(server?.child)
    if (databasePreparationStarted) {
      await dropIsolatedSchema(target.url, target.schema).catch((error) => {
        console.error(`Could not remove the isolated Lite E2E schema: ${sanitizeProcessOutput(error instanceof Error ? error.message : error)}`)
      })
    }
    if (previousRuntimeDatabaseUrl === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = previousRuntimeDatabaseUrl
  }
}

main().catch((error) => {
  console.error(sanitizeProcessOutput(error instanceof Error ? error.stack || error.message : error))
  process.exitCode = 1
})
