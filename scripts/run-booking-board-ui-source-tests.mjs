/* global console */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = (await readFile('src/components/board/ServerBookingBoard.tsx', 'utf8')).replaceAll('\r\n', '\n')
const routeSource = (await readFile('server/index.mjs', 'utf8')).replaceAll('\r\n', '\n')
const assignmentCallers = [
  'src/components/views/ReservationsView.tsx',
  'src/components/front-desk-assistant/FrontDeskAssistantProvider.tsx',
  'src/components/board/Board.tsx',
  'src/components/front-desk/FrontDeskView.tsx',
]

assert.match(source, /aria-label="Unassigned reservations"/, 'the server board exposes a dedicated unassigned-stay selection surface')
assert.match(source, /\/api\/reservations\/\$\{encodeURIComponent\(selectedReservation\.id\)\}\/assign-room/, 'room assignment and moves use the authenticated reservation assignment endpoint')
assert.match(source, /method: 'POST'/, 'room assignment is a typed POST command')
assert.match(source, /body:\s+JSON\.stringify\(\{ roomId: room\.id \}\)/, 'room assignment sends only the target room identifier')
assert.match(source, /operation: 'reservation-assign-room'/, 'room assignment uses a durable in-memory attempt identity')
assert.match(source, /durableAttemptKeys\.getOrCreate\(attempt\)/, 'a retry reuses the durable attempt key for the same logical assignment')
assert.match(source, /durableAttemptKeys\.confirmSuccess\(attempt\)/, 'a confirmed assignment clears its durable attempt key')
assert.match(source, /\/api\/reservations\/\$\{encodeURIComponent\(selectedReservation\.id\)\}/, 'stay resize uses the authenticated reservation endpoint')
assert.match(source, /method: 'PATCH'/, 'stay resize is a typed PATCH command')
assert.match(source, /body:\s+JSON\.stringify\(\{ checkIn: plannedCheckIn, checkOut: plannedCheckOut \}\)/, 'stay resize sends both authoritative dates')
assert.match(source, /operation: 'reservation-resize-stay'/, 'stay resize uses a durable in-memory attempt identity')
assert.match(source, /'x-reservation-expected-updated-at': selectedReservation\.updatedAt/, 'stay resize sends the selected authoritative update token')
assert.match(source, /'x-reservation-expected-version': selectedReservation\.version/, 'stay resize sends the selected authoritative version token')
assert.match(source, /selectedReservation\.roomTypeId === room\.roomType\.id/, 'room actions use server-provided reservation and room-type identity before enabling a command')
assert.match(source, /format\(parseISO\(reservation\.checkIn\), 'yyyy-MM-dd'\)/, 'selected server timestamps are normalized for date inputs')
assert.match(source, /plannedCheckIn >= plannedCheckOut/, 'the UI rejects invalid local date ordering before requesting a mutation')
assert.match(source, /reload\(\)\n\s{4}} catch/, 'successful commands refetch authoritative board state')
assert.match(source, /caught instanceof PmsApiError/, 'known server failures are distinguished from ambiguous network outcomes')
assert.match(source, /Connection outcome is unknown/, 'ambiguous outcomes tell the operator to retry the same protected intent')
assert.match(source, /if \(caught\.status === 409\) setDateDraftDirty\(false\)/, 'a conflict resets stale date drafts before authoritative refetch')
assert.match(source, /if \(!selectedReservation \|\| dateDraftDirty\) return/, 'authoritative selection updates do not overwrite an actively edited date draft')
assert.doesNotMatch(source, /useKV|localStorage|sessionStorage|@github\/spark/, 'the server booking board remains free of browser-backed operational state')
assert.doesNotMatch(source, /components\/board\/Board/, 'the server booking board does not import the legacy demo board')
const patchRouteStart = routeSource.indexOf("params = routeParam(url.pathname, /^\\/api\\/reservations\\/(?<id>[^/]+)$/)")
const assignmentRouteStart = routeSource.indexOf("params = routeParam(url.pathname, /^\\/api\\/reservations\\/(?<id>[^/]+)\\/assign-room$/)")
const patchRoute = routeSource.slice(patchRouteStart, assignmentRouteStart)
const assignmentRoute = routeSource.slice(assignmentRouteStart, routeSource.indexOf("params = routeParam(url.pathname, /^\\/api\\/reservations\\/(?<id>[^/]+)\\/check-in$/)", assignmentRouteStart))
assert.match(patchRoute, /updateReservation/, 'reservation PATCH is routed to the server mutation service')
assert.match(patchRoute, /idempotencyKey:\s*context\.idempotencyKey/, 'reservation PATCH accepts legacy missing keys and forwards visible caller retry keys')
assert.match(patchRoute, /x-reservation-expected-updated-at/, 'reservation PATCH accepts the booking-board optimistic concurrency token')
assert.match(patchRoute, /x-reservation-expected-version/, 'reservation PATCH accepts the compatible booking-board version token')
assert.match(assignmentRoute, /assignRoom/, 'room assignment is routed to the server mutation service')
assert.match(assignmentRoute, /idempotencyKey:\s*context\.idempotencyKey/, 'room assignment accepts legacy missing keys and forwards visible caller retry keys')

for (const file of assignmentCallers) {
  const callerSource = await readFile(file, 'utf8')
  if (file === 'src/components/board/ServerBookingBoard.tsx') {
    assert.match(callerSource, /assign-room[\s\S]{0,420}'x-idempotency-key': idempotencyKey/, `${file} sends its durable idempotency key with every visible server room-assignment command`)
  } else {
    assert.match(callerSource, /assign-room[\s\S]{0,320}headers:\s*\{\s*'x-idempotency-key':\s*createPmsIdempotencyKey\(/, `${file} sends an idempotency key with every visible server room-assignment command`)
  }
}

console.log('Booking board server-command source tests passed.')
