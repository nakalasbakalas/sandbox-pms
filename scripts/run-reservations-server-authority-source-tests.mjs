/* global console */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const reservationsSource = (await readFile('src/components/views/ReservationsView.tsx', 'utf8')).replaceAll('\r\n', '\n')
const appSource = (await readFile('src/App.tsx', 'utf8')).replaceAll('\r\n', '\n')
const rbacSource = (await readFile('server/rbac.mjs', 'utf8')).replaceAll('\r\n', '\n')

const serverStart = reservationsSource.indexOf('function ServerReservationsView()')
const demoStart = reservationsSource.indexOf('function DemoReservationsView()')
assert.ok(serverStart >= 0 && demoStart >= 0 && serverStart !== demoStart, 'Reservations keeps distinct server and demo components')
const serverSlice = serverStart < demoStart
  ? reservationsSource.slice(serverStart, demoStart)
  : reservationsSource.slice(serverStart)
const demoSlice = demoStart < serverStart
  ? reservationsSource.slice(demoStart, serverStart)
  : reservationsSource.slice(demoStart)

assert.match(reservationsSource, /SERVER_API_ENABLED/, 'Reservations explicitly distinguishes server mode from demo mode')
assert.match(reservationsSource, /server-reservations-view/, 'the successful server Reservations surface has a stable authority test id')
assert.match(reservationsSource, /server-reservations-error/, 'the failed server Reservations surface has a stable authority test id')
assert.match(reservationsSource, /Reservations unavailable/, 'Reservations fails closed with a truthful authoritative-data error')
assert.match(reservationsSource, /Retry/, 'Reservations exposes a visible retry after an authoritative fetch failure')
assert.match(serverSlice, /useServerBookingBoard\(/, 'server Reservations consumes the authenticated Board snapshot')
assert.match(serverSlice, /mapServerBoardRooms\(/, 'server Reservations maps room/readiness data only from the Board snapshot')
assert.match(serverSlice, /\breload\b/, 'server Reservations retries by reloading authoritative Board data')
assert.doesNotMatch(serverSlice, /\buseKV\b|\buseRoomSync\b|localStorage|sessionStorage/, 'server Reservations cannot read browser-owned operational state')
assert.match(demoSlice, /\buseKV\b/, 'browser-owned reservation state remains confined to demo mode')
assert.match(demoSlice, /\buseRoomSync\b/, 'browser-owned room state remains confined to demo mode')
assert.match(serverSlice, /pendingAssignmentAttempt/, 'server direct assignment retains an in-memory pending attempt')
assert.match(serverSlice, /durableAttemptKeys\.getOrCreate\(assignmentAttempt\.descriptor\)/, 'server direct assignment reuses the durable attempt key for an unchanged retry')
assert.match(serverSlice, /expectedUpdatedAt/, 'server direct assignment carries an authoritative stale-write token')
assert.match(serverSlice, /x-reservation-expected-updated-at/, 'server direct assignment sends the stale-write token to the PMS')
assert.match(serverSlice, /\/assign-room/, 'server direct assignment uses the authenticated PMS command')
assert.match(serverSlice, /pms:domain-event/, 'room and reservation events cause authoritative server refresh')
assert.match(appSource, /reservations: \['view:reservations'\]/, 'the client route requires reservation-view permission')
assert.match(rbacSource, /reservations: \['view:reservations'\]/, 'the server route registry requires reservation-view permission')

console.log('Reservations server-authority source guards passed.')
