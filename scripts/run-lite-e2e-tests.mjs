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

function hotelDate() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

function plusDays(value, days) {
  const date = new Date(`${value}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
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

async function queryBookingDetail(context, baseUrl, reservationId) {
  const response = await context.request.get(`${baseUrl}/api/lite/v1/bookings/${encodeURIComponent(reservationId)}`)
  const payload = await response.json()
  assert.equal(response.status(), 200, `booking detail query failed: ${JSON.stringify(payload)}`)
  return payload.data
}

async function apiMutation(context, baseUrl, method, path, data, expectedStatus = 200) {
  const response = await context.request.fetch(`${baseUrl}${path}`, { method, data })
  const payload = await response.json().catch(() => null)
  assert.equal(response.status(), expectedStatus, `${method} ${path} failed: ${JSON.stringify(payload)}`)
  return payload?.data
}

async function runCoreOperationsProof(adminContext, housekeepingContext, adminPage, frontDeskPage, housekeepingPage, frontDeskErrors, baseUrl, reservation, runId) {
  const today = hotelDate()
  const boardResponse = await adminContext.request.get(`${baseUrl}/api/lite/v1/board?from=${today}&to=${plusDays(today, 14)}`)
  assert.equal(boardResponse.status(), 200)
  const board = (await boardResponse.json()).data
  const room = board.rooms.find((candidate) => (
    candidate.roomTypeId === reservation.roomType.id
      && candidate.operationalStatus === 'AVAILABLE'
      && ['VACANT_CLEAN', 'INSPECTED'].includes(candidate.housekeepingStatus)
  ))
  assert.ok(room, 'a ready room must be available for lifecycle proof')

  await adminPage.getByRole('button', { name: /Booking Board/i }).click()
  await visible(adminPage.getByRole('heading', { name: 'Booking Board', exact: true }), 'booking board workspace')
  await adminPage.locator('button.unassigned-card').filter({ hasText: reservation.guest.displayName }).click()
  const boardDetail = adminPage.getByRole('dialog', { name: reservation.guest.displayName, exact: true })
  await visible(boardDetail, 'booking board reservation detail')
  await boardDetail.getByRole('button', { name: 'Assign room', exact: true }).click()
  const assignDialog = adminPage.getByRole('dialog', { name: 'Assign room', exact: true })
  await visible(assignDialog, 'board assignment dialog')
  await assignDialog.locator('select').selectOption(room.id)
  await assignDialog.getByRole('button', { name: 'Save', exact: true }).click()
  await assignDialog.waitFor({ state: 'hidden' })
  let [current] = await queryBookings(adminContext, baseUrl, reservation.confirmationCode)
  assert.equal(current.assignedRoomId, room.id)
  assert.ok(current.folio.balanceSatang > 0)

  const assignedChip = adminPage.locator('button.stay-chip').filter({ hasText: reservation.guest.displayName })
  await visible(assignedChip, 'assigned booking board chip')
  await assignedChip.click()
  const assignedDetail = adminPage.getByRole('dialog', { name: reservation.guest.displayName, exact: true })
  await assignedDetail.getByRole('button', { name: 'Edit dates', exact: true }).click()
  const datesDialog = adminPage.getByRole('dialog', { name: 'Edit stay dates', exact: true })
  await visible(datesDialog, 'board stay-date dialog')
  await datesDialog.getByLabel('Check-out date', { exact: true }).fill(plusDays(today, 2))
  await datesDialog.getByRole('button', { name: 'Save', exact: true }).click()
  await datesDialog.waitFor({ state: 'hidden' })
  ;[current] = await queryBookings(adminContext, baseUrl, reservation.confirmationCode)
  assert.equal(current.checkOut.slice(0, 10), plusDays(today, 2), 'board date edit must persist')

  await frontDeskPage.getByRole('button', { name: 'ภาษาไทย', exact: true }).click()
  await frontDeskPage.getByRole('button', { name: /ฟรอนต์ออฟฟิศ/ }).click()
  await visible(frontDeskPage.getByRole('heading', { name: 'ฟรอนต์ออฟฟิศ', exact: true }), 'Thai Front Desk before check-in')
  const arrivalRow = frontDeskPage.locator('article.reservation-row').filter({ hasText: reservation.guest.displayName })
  await visible(arrivalRow, 'arrival row for Thai check-in')
  await arrivalRow.getByRole('button', { name: 'เช็กอิน', exact: true }).click()
  const checkInDialog = frontDeskPage.getByRole('dialog', { name: `เช็กอิน · ${reservation.guest.displayName}`, exact: true })
  await visible(checkInDialog, 'Thai check-in dialog')
  await checkInDialog.getByLabel('สัญชาติ', { exact: true }).fill('ไทย')
  await checkInDialog.getByLabel('เลขบัตร/พาสปอร์ต', { exact: true }).fill(`LITE-E2E-${runId}`)
  const thaiPaymentInput = checkInDialog.getByLabel('ยอดรับชำระ (บาท)', { exact: true })
  await thaiPaymentInput.fill('')
  frontDeskErrors.expectHttpFailure(true)
  await checkInDialog.getByRole('button', { name: 'เช็กอิน', exact: true }).click()
  const thaiMutationError = checkInDialog.locator('.form-error')
  await visible(thaiMutationError, 'Thai failed check-in message')
  assert.match(await thaiMutationError.innerText(), /collect|payment|balance|ชำระ/i)
  frontDeskErrors.expectHttpFailure(false)
  ;[current] = await queryBookings(adminContext, baseUrl, reservation.confirmationCode)
  assert.equal(current.status, 'CONFIRMED', 'failed Thai check-in must leave the booking unchanged')
  await thaiPaymentInput.fill((current.folio.balanceSatang / 100).toFixed(2))
  await checkInDialog.getByRole('button', { name: 'เช็กอิน', exact: true }).click()
  await checkInDialog.waitFor({ state: 'hidden' })
  ;[current] = await queryBookings(adminContext, baseUrl, reservation.confirmationCode)
  assert.equal(current.status, 'CHECKED_IN')
  assert.equal(current.guest.identityComplete, true)
  assert.equal(current.folio.balanceSatang, 0)

  const checkedInCancellation = await adminContext.request.post(`${baseUrl}/api/reservations/${reservation.id}/cancel`, {
    data: { reason: 'E2E verifies an occupied stay cannot be cancelled.' },
  })
  assert.equal(checkedInCancellation.status(), 400, 'checked-in bookings must be checked out rather than cancelled')
  ;[current] = await queryBookings(adminContext, baseUrl, reservation.confirmationCode)
  assert.equal(current.status, 'CHECKED_IN', 'rejected cancellation must leave the in-house stay unchanged')

  const checkedInEdit = await adminContext.request.patch(`${baseUrl}/api/reservations/${reservation.id}`, {
    data: {
      checkIn: current.checkIn.slice(0, 10),
      checkOut: plusDays(today, 3),
      expectedUpdatedAt: current.updatedAt,
    },
  })
  assert.equal(checkedInEdit.status(), 400, 'generic booking edits must not detach or corrupt an occupied checked-in room')
  ;[current] = await queryBookings(adminContext, baseUrl, reservation.confirmationCode)
  assert.equal(current.status, 'CHECKED_IN')
  assert.equal(current.assignedRoomId, room.id)

  await frontDeskPage.getByRole('button', { name: 'English', exact: true }).click()
  await openBookings(adminPage)
  const bookingRow = adminPage.locator('tbody tr').filter({ hasText: reservation.guest.displayName })
  await visible(bookingRow, 'booking row for detail and folio workflow')
  await bookingRow.getByRole('button', { name: 'Details', exact: true }).click()
  const folioDialog = adminPage.getByRole('dialog', { name: `Booking details · ${reservation.confirmationCode}`, exact: true })
  await visible(folioDialog, 'booking detail and folio dialog')
  await folioDialog.getByRole('button', { name: 'Add charge', exact: true }).click()
  await folioDialog.getByLabel('Description', { exact: true }).fill('E2E minibar charge')
  await folioDialog.locator('.folio-form select').selectOption('MINIBAR')
  await folioDialog.getByLabel('Amount (THB)', { exact: true }).fill('12.34')
  await folioDialog.getByRole('button', { name: 'Save', exact: true }).click()
  await visible(folioDialog.getByText('E2E minibar charge', { exact: true }), 'persisted folio charge')
  ;[current] = await queryBookings(adminContext, baseUrl, reservation.confirmationCode)
  assert.equal(current.folio.balanceSatang, 1_234)
  assert.equal(current.folio.charges.some((charge) => charge.description === 'E2E minibar charge' && charge.totalSatang === 1_234), true)

  await folioDialog.getByRole('button', { name: 'Record payment', exact: true }).click()
  assert.equal(await folioDialog.getByLabel('Amount (THB)', { exact: true }).inputValue(), '12.34')
  await folioDialog.getByRole('button', { name: 'Save', exact: true }).click()
  await visible(folioDialog.locator('.ledger-section .ledger-row').filter({ hasText: 'Cash' }).first(), 'persisted localized folio payment')
  for (let attempt = 0; attempt < 40; attempt += 1) {
    ;[current] = await queryBookings(adminContext, baseUrl, reservation.confirmationCode)
    if (current.folio.balanceSatang === 0) break
    await sleep(250)
  }
  assert.equal(current.folio.balanceSatang, 0)
  assert.equal(current.folio.payments.some((payment) => payment.amountSatang === 1_234), true)

  const openFolioDetail = await queryBookingDetail(adminContext, baseUrl, reservation.id)
  assert.equal(openFolioDetail.reservation.folio.id, current.folio.id, 'folio detail must use the persisted booking folio')
  assert.equal(openFolioDetail.reservation.folio.status, 'OPEN', 'a settled in-house folio remains open until checkout')
  assert.equal(openFolioDetail.reservation.folio.paymentState, 'SETTLED')
  assert.equal(
    openFolioDetail.reservation.folio.charges.reduce((sum, charge) => sum + (charge.void ? 0 : charge.totalSatang), 0),
    openFolioDetail.reservation.folio.totalSatang,
    'folio retrieval must reconcile active room and extra charges to its total',
  )
  assert.equal(
    openFolioDetail.reservation.folio.payments.reduce((sum, payment) => sum + payment.amountSatang, 0),
    openFolioDetail.reservation.folio.paidSatang,
    'folio retrieval must reconcile payments to its paid total',
  )
  await folioDialog.locator('.modal-footer').getByRole('button', { name: 'Close', exact: true }).click()

  const inHouseRow = frontDeskPage.locator('article.reservation-row').filter({ hasText: reservation.guest.displayName })
  await visible(inHouseRow, 'in-house row for checkout')
  await inHouseRow.getByRole('button', { name: 'Check out', exact: true }).click()
  const checkOutDialog = frontDeskPage.getByRole('dialog', { name: `Check out · ${reservation.guest.displayName}`, exact: true })
  await visible(checkOutDialog, 'checkout dialog')
  await checkOutDialog.getByRole('button', { name: 'Check out', exact: true }).click()
  await checkOutDialog.waitFor({ state: 'hidden' })
  ;[current] = await queryBookings(adminContext, baseUrl, reservation.confirmationCode)
  assert.equal(current.status, 'CHECKED_OUT')
  assert.equal(current.folio.status, 'CLOSED')

  const closedFolioDetail = await queryBookingDetail(adminContext, baseUrl, reservation.id)
  assert.equal(closedFolioDetail.reservation.status, 'CHECKED_OUT')
  assert.ok(closedFolioDetail.reservation.actualCheckOut, 'checkout must persist its actual completion timestamp')
  assert.equal(closedFolioDetail.reservation.folio.status, 'CLOSED')
  assert.equal(closedFolioDetail.reservation.folio.balanceSatang, 0)
  assert.equal(closedFolioDetail.reservation.assignedRoom.housekeepingStatus, 'VACANT_DIRTY')
  const lifecycleActions = new Set(closedFolioDetail.auditTimeline.events.map((event) => event.action))
  for (const action of ['CREATED', 'ASSIGNED_ROOM', 'CHECKED_IN', 'CHECKED_OUT']) {
    assert.equal(lifecycleActions.has(action), true, `booking history must include ${action}`)
  }

  const housekeepingBefore = await housekeepingContext.request.get(`${baseUrl}/api/lite/v1/housekeeping?date=${today}`)
  assert.equal(housekeepingBefore.status(), 200)
  const dirtyTurnover = (await housekeepingBefore.json()).data.rooms.find((candidate) => candidate.id === room.id)
  assert.ok(dirtyTurnover, 'the checked-out room must remain visible in the housekeeping queue')
  assert.equal(dirtyTurnover.housekeepingStatus, 'VACANT_DIRTY')
  assert.equal(dirtyTurnover.readyForArrival, false)

  const turnoverStates = [
    ['CLEANING', 'CLEANING'],
    ['CLEAN', 'VACANT_CLEAN'],
    ['INSPECTED', 'INSPECTED'],
  ]
  for (const [requested, persisted] of turnoverStates) {
    const updatedRoom = await apiMutation(
      housekeepingContext,
      baseUrl,
      'POST',
      `/api/housekeeping/rooms/${room.id}/status`,
      { status: requested },
    )
    assert.equal(updatedRoom.currentStatus, persisted, `housekeeping ${requested} must persist as ${persisted}`)
  }

  const housekeepingAfter = await housekeepingContext.request.get(`${baseUrl}/api/lite/v1/housekeeping?date=${today}`)
  assert.equal(housekeepingAfter.status(), 200)
  const inspectedTurnover = (await housekeepingAfter.json()).data.rooms.find((candidate) => candidate.id === room.id)
  assert.equal(inspectedTurnover.housekeepingStatus, 'INSPECTED')
  assert.equal(inspectedTurnover.readyForArrival, true)
  await housekeepingPage.reload({ waitUntil: 'domcontentloaded' })
  const turnoverCard = housekeepingPage.locator('article.room-task').filter({ hasText: `Room ${room.number}` })
  await visible(turnoverCard, 'checked-out room in the housekeeping workspace')
  await visible(turnoverCard.getByText('Inspected', { exact: true }), 'inspected turnover state in the housekeeping UI')
  await openBookings(frontDeskPage)
  await visible(frontDeskPage.getByText(reservation.guest.displayName, { exact: true }), 'checked-out booking in Bookings')

  const noShow = await apiMutation(adminContext, baseUrl, 'POST', '/api/reservations', {
    checkIn: today,
    checkOut: plusDays(today, 1),
    roomTypeCode: reservation.roomType.code,
    adults: 1,
    children: 0,
    childAges: [],
    ratePerNightSatang: reservation.roomType.baseRateSatang,
    guest: { firstName: 'No Show', lastName: runId },
    source: 'DIRECT',
  }, 201)
  const reasonlessNoShow = await adminContext.request.post(`${baseUrl}/api/reservations/${noShow.id}/no-show`, {
    data: {},
  })
  assert.equal(reasonlessNoShow.status(), 400, 'no-show requires an operational reason')
  let [noShowRead] = await queryBookings(adminContext, baseUrl, noShow.confirmationCode)
  assert.equal(noShowRead.status, 'CONFIRMED', 'reasonless no-show must leave the booking active')
  await apiMutation(adminContext, baseUrl, 'POST', `/api/reservations/${noShow.id}/no-show`, {
    reason: 'E2E verified guest did not arrive',
  })
  ;[noShowRead] = await queryBookings(adminContext, baseUrl, noShow.confirmationCode)
  assert.equal(noShowRead.status, 'NO_SHOW')

  const cancellation = await apiMutation(adminContext, baseUrl, 'POST', '/api/reservations', {
    checkIn: plusDays(today, 3),
    checkOut: plusDays(today, 4),
    roomTypeCode: reservation.roomType.code,
    adults: 1,
    children: 0,
    childAges: [],
    ratePerNightSatang: reservation.roomType.baseRateSatang,
    guest: { firstName: 'Cancelled', lastName: runId },
    source: 'DIRECT',
  }, 201)
  const reasonlessCancellation = await adminContext.request.post(`${baseUrl}/api/reservations/${cancellation.id}/cancel`, {
    data: {},
  })
  assert.equal(reasonlessCancellation.status(), 400, 'cancellation requires an operational reason')
  let [cancelledRead] = await queryBookings(adminContext, baseUrl, cancellation.confirmationCode)
  assert.equal(cancelledRead.status, 'CONFIRMED', 'reasonless cancellation must leave the booking active')
  await apiMutation(adminContext, baseUrl, 'POST', `/api/reservations/${cancellation.id}/cancel`, {
    reason: 'E2E guest cancelled before arrival',
  })
  ;[cancelledRead] = await queryBookings(adminContext, baseUrl, cancellation.confirmationCode)
  assert.equal(cancelledRead.status, 'CANCELLED')
  const cancelledAssignment = await adminContext.request.post(`${baseUrl}/api/reservations/${cancellation.id}/assign-room`, {
    data: { roomId: room.id, expectedUpdatedAt: cancelledRead.updatedAt },
  })
  assert.equal(cancelledAssignment.status(), 400, 'cancelled bookings cannot be assigned back into sellable inventory')

  const concurrencyStay = {
    checkIn: plusDays(today, 5),
    checkOut: plusDays(today, 7),
    roomTypeCode: reservation.roomType.code,
    adults: 1,
    children: 0,
    childAges: [],
    ratePerNightSatang: reservation.roomType.baseRateSatang,
    source: 'DIRECT',
  }
  const first = await apiMutation(adminContext, baseUrl, 'POST', '/api/reservations', {
    ...concurrencyStay,
    guest: { firstName: 'Board A', lastName: runId },
  }, 201)
  const second = await apiMutation(adminContext, baseUrl, 'POST', '/api/reservations', {
    ...concurrencyStay,
    guest: { firstName: 'Board B', lastName: runId },
  }, 201)
  const prematureNoShow = await adminContext.request.post(`${baseUrl}/api/reservations/${first.id}/no-show`, {
    data: { reason: 'E2E premature no-show must be rejected' },
  })
  assert.equal(prematureNoShow.status(), 400, 'future arrivals cannot be marked no-show')
  const assignmentResponses = await Promise.all([
    adminContext.request.post(`${baseUrl}/api/reservations/${first.id}/assign-room`, { data: { roomId: room.id, expectedUpdatedAt: first.updatedAt } }),
    adminContext.request.post(`${baseUrl}/api/reservations/${second.id}/assign-room`, { data: { roomId: room.id, expectedUpdatedAt: second.updatedAt } }),
  ])
  const assignmentStatuses = assignmentResponses.map((response) => response.status())
  assert.equal(assignmentStatuses.filter((status) => status === 200).length, 1, `exactly one concurrent room assignment must commit: ${assignmentStatuses.join(',')}`)
  assert.equal(assignmentStatuses.filter((status) => status >= 400).length, 1, `one conflicting room assignment must be rejected: ${assignmentStatuses.join(',')}`)

  const winner = assignmentStatuses[0] === 200 ? first : second
  const [winnerRead] = await queryBookings(adminContext, baseUrl, winner.confirmationCode)
  const staleVersion = winnerRead.updatedAt
  await apiMutation(adminContext, baseUrl, 'PATCH', `/api/reservations/${winner.id}`, {
    checkIn: plusDays(today, 6),
    checkOut: plusDays(today, 8),
    expectedUpdatedAt: staleVersion,
  })
  const staleResponse = await adminContext.request.patch(`${baseUrl}/api/reservations/${winner.id}`, {
    data: {
      checkIn: plusDays(today, 7),
      checkOut: plusDays(today, 9),
      expectedUpdatedAt: staleVersion,
    },
  })
  assert.equal(staleResponse.status(), 409, 'stale booking-board date edits must be rejected')

  console.log('Lite core operations E2E passed: booking/assignment, Thai identity/check-in, room and extra charges, payments, folio retrieval, checkout, housekeeping turnover, cancellation/no-show guardrails, concurrent assignment, and stale edit rejection.')
}

async function runAtomicWalkInProof(adminContext, adminPage, baseUrl, runId) {
  const guestName = `Atomic Walkin ${runId}`
  const checkIn = hotelDate()
  const checkOut = plusDays(checkIn, 1)
  const boardResponse = await adminContext.request.get(`${baseUrl}/api/lite/v1/board?from=${checkIn}&to=${checkOut}`)
  assert.equal(boardResponse.status(), 200)
  const board = (await boardResponse.json()).data
  let provenQuote = null
  for (const roomType of board.roomTypes) {
    const quoteResponse = await adminContext.request.get(`${baseUrl}/api/lite/v1/walk-in-quote?checkIn=${checkIn}&checkOut=${checkOut}&roomTypeCode=${encodeURIComponent(roomType.code)}&adults=1&children=0&childAges=`)
    const quotePayload = await quoteResponse.json()
    assert.equal(quoteResponse.status(), 200, `walk-in quote failed: ${JSON.stringify(quotePayload)}`)
    if (quotePayload.data.readyRooms.length > 0) {
      provenQuote = quotePayload.data
      break
    }
  }
  assert.ok(provenQuote, 'at least one room type must have a clean ready room for atomic walk-in proof')
  await openBookings(adminPage)
  await adminPage.getByRole('button', { name: 'Walk-in check-in', exact: true }).click()
  const dialog = adminPage.getByRole('dialog', { name: 'Walk-in check-in', exact: true })
  await visible(dialog, 'atomic walk-in dialog')
  await dialog.getByLabel('First name', { exact: true }).fill('Atomic')
  await dialog.getByLabel('Last name', { exact: true }).fill(`Walkin ${runId}`)
  await dialog.getByLabel('Email (optional)', { exact: true }).fill(`walkin-${runId}@example.invalid`)
  await dialog.getByLabel('Phone (optional)', { exact: true }).fill('0800000000')
  await dialog.getByLabel('Nationality', { exact: true }).fill('Thai')
  await dialog.getByLabel('Identity number', { exact: true }).fill(`E2E-${runId}`)
  await dialog.locator('label').filter({ hasText: 'Room type' }).locator('select').selectOption(provenQuote.roomType.code)
  await visible(dialog.getByText('Amount due', { exact: true }), 'server-derived walk-in quote')
  const readyRoom = dialog.locator('label').filter({ hasText: 'Ready room' }).locator('select')
  await readyRoom.locator('option').nth(1).waitFor({ state: 'attached' })
  assert.notEqual(await readyRoom.inputValue(), '', 'the quote must select a clean ready room')
  await dialog.getByRole('button', { name: 'Confirm & check in', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })

  const persisted = await queryBookings(adminContext, baseUrl, guestName)
  assert.equal(persisted.length, 1, 'atomic walk-in must create exactly one booking')
  assert.equal(persisted[0].status, 'CHECKED_IN')
  assert.equal(persisted[0].source, 'WALK_IN')
  assert.ok(persisted[0].assignedRoomId, 'atomic walk-in must assign a ready room')
  assert.equal(persisted[0].folio.balanceSatang, 0, 'full walk-in settlement must leave no balance')
  assert.equal(persisted[0].folio.paidSatang, persisted[0].folio.totalSatang, 'walk-in payment must match the server quote')

  const bookingRow = adminPage.locator('tbody tr').filter({ hasText: guestName })
  await visible(bookingRow, 'atomic walk-in booking row')
  await bookingRow.getByRole('button', { name: 'Details', exact: true }).click()
  const detailDialog = adminPage.getByRole('dialog', { name: `Booking details · ${persisted[0].confirmationCode}`, exact: true })
  await visible(detailDialog.getByRole('button', { name: 'Print guest folio', exact: true }), 'guest folio print action')
  const printStatement = await detailDialog.locator('.folio-print-sheet').textContent()
  assert.match(printStatement || '', /Guest Folio \/ Statement/)
  assert.match(printStatement || '', /not a tax invoice/i)
  await detailDialog.locator('.modal-footer').getByRole('button', { name: 'Close', exact: true }).click()
  console.log('Lite atomic walk-in E2E passed: quote, ready-room selection, identity, settlement, check-in, persisted folio, and honest print statement.')
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
    await dialog.getByLabel('Email (optional)', { exact: true }).fill(`live-${runId}@example.invalid`)
    await dialog.getByLabel('Phone (optional)', { exact: true }).fill('0811111111')
    await dialog.getByLabel('Guest special requests', { exact: true }).fill('Quiet room if available')
    await dialog.getByLabel('Internal notes', { exact: true }).fill('E2E contact context')
    await dialog.getByRole('button', { name: 'Save', exact: true }).click()
    await dialog.waitFor({ state: 'hidden' })

    await visible(frontDeskPage.getByText(syncedGuest, { exact: true }), 'booking propagated to second browser', 15_000)
    const persisted = await queryBookings(adminContext, baseUrl, syncedGuest)
    assert.equal(persisted.length, 1, 'successful booking must be persisted once')
    assert.equal(persisted[0].guest.displayName, syncedGuest)
    const createdDetail = await queryBookingDetail(adminContext, baseUrl, persisted[0].id)
    assert.equal(createdDetail.reservation.guest.email, `live-${runId}@example.invalid`)
    assert.equal(createdDetail.reservation.guest.phone, '0811111111')
    assert.equal(createdDetail.reservation.specialRequests, 'Quiet room if available')
    assert.equal(createdDetail.reservation.notes, 'E2E contact context')

    const createdRow = adminPage.locator('tbody tr').filter({ hasText: syncedGuest })
    await createdRow.getByRole('button', { name: 'Edit', exact: true }).click()
    const editDialog = adminPage.getByRole('dialog', { name: `Edit ${persisted[0].confirmationCode}`, exact: true })
    await visible(editDialog, 'booking editor with protected contact detail')
    await adminPage.waitForFunction(() => Array.from(document.querySelectorAll('input[type="tel"]')).some((input) => input.value === '0811111111'))
    await editDialog.getByLabel('Phone (optional)', { exact: true }).fill('0822222222')
    await editDialog.locator('label').filter({ hasText: 'Internal notes' }).locator('textarea').fill('E2E contact updated')
    await editDialog.getByRole('button', { name: 'Save', exact: true }).click()
    await editDialog.waitFor({ state: 'hidden' })
    const updatedDetail = await queryBookingDetail(adminContext, baseUrl, persisted[0].id)
    assert.equal(updatedDetail.reservation.guest.phone, '0822222222')
    assert.equal(updatedDetail.reservation.notes, 'E2E contact updated')
    const refreshed = await queryBookings(adminContext, baseUrl, syncedGuest)
    persisted[0] = refreshed[0]

    await runCoreOperationsProof(adminContext, housekeepingContext, adminPage, frontDeskPage, housekeepingPage, frontDeskErrors, baseUrl, persisted[0], runId)
    await runAtomicWalkInProof(adminContext, adminPage, baseUrl, runId)

    const operationalLocalStorageKeys = await frontDeskPage.evaluate(() => Object.keys(window.localStorage))
    assert.deepEqual(operationalLocalStorageKeys, ['pms-lite-language'], 'only the language preference may be stored in localStorage')

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
