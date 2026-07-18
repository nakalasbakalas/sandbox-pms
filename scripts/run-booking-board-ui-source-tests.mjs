/* global console */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = (await readFile('src/components/board/ServerBookingBoard.tsx', 'utf8')).replaceAll('\r\n', '\n')
const drawerSource = (await readFile('src/components/board/BoardReservationCommandDrawer.tsx', 'utf8')).replaceAll('\r\n', '\n')
const attemptSource = (await readFile('src/lib/durable-attempt-key.ts', 'utf8')).replaceAll('\r\n', '\n')
const reservationsSource = (await readFile('src/components/views/ReservationsView.tsx', 'utf8')).replaceAll('\r\n', '\n')
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
assert.match(source, /reload\(\)\n\s+return true/, 'a server-accepted command triggers an authoritative Board refetch')
assert.match(source, /caught instanceof PmsApiError/, 'known server failures are distinguished from ambiguous network outcomes')
assert.match(source, /Connection outcome is unknown/, 'ambiguous outcomes tell the operator to retry the same protected intent')
assert.match(source, /if \(caught\.status === 409\) setDateDraftDirty\(false\)/, 'a conflict resets stale date drafts before authoritative refetch')
assert.match(source, /if \(!selectedReservation \|\| dateDraftDirty\) return/, 'authoritative selection updates do not overwrite an actively edited date draft')
assert.doesNotMatch(source, /useKV|localStorage|sessionStorage|@github\/spark/, 'the server booking board remains free of browser-backed operational state')
assert.doesNotMatch(source, /from ['"]@\/components\/board\/Board['"]/, 'the server booking board does not import the legacy demo board')
assert.match(source, /BoardReservationCommandDrawer/, 'the selected authoritative reservation exposes the server command drawer')
assert.match(source, /hasPermission\('cancel:reservation'\)/, 'lifecycle commands are permission-gated')
assert.match(source, /hasPermission\('view:guests'\)/, 'guest editing requires guest-view authority')
assert.match(source, /hasPermission\('post:charges'\)/, 'folio extras are permission-gated')
assert.match(source, /capabilityEnabled\(registry\?\.operations\.reservations\)/, 'reservation drawer actions require server capability evidence')
assert.match(source, /capabilityEnabled\(registry\?\.finance\.legacyFolioCharges\)/, 'charge posting requires the exact legacy-folio capability evidence')
assert.match(drawerSource, /reasonAction === 'cancel' \? 'cancel' : 'no-show'/, 'drawer selects the authenticated cancellation or no-show lifecycle endpoint')
assert.match(drawerSource, /expectedUpdatedAt/, 'lifecycle commands carry an authoritative update token')
assert.match(drawerSource, /'x-reservation-expected-updated-at': reservation\.updatedAt/, 'lifecycle commands send their optimistic concurrency header')
assert.match(drawerSource, /\/guest/, 'guest editing uses the authoritative reservation guest endpoint')
assert.match(drawerSource, /expectedGuestUpdatedAt/, 'guest editing carries the guest update token')
assert.match(drawerSource, /\/api\/charges/, 'extras post to the server charge endpoint')
assert.match(drawerSource, /bahtStringToSatang/, 'extras convert baht to exact satang before sending')
assert.match(drawerSource, /BigInt/, 'extras avoid floating-point money conversion')
assert.doesNotMatch(drawerSource, /value="TRANSPORT"/, 'the drawer does not send an unsupported charge category')
assert.match(drawerSource, /reason\.trim\(\)/, 'cancel and no-show require an operational reason')
assert.match(source, /key=\{selectedReservation\.id\}/, 'selecting another reservation remounts the command drawer with fresh reservation state')
assert.doesNotMatch(drawerSource, /useEffect/, 'same-reservation background refreshes do not erase an in-progress command draft')
assert.match(drawerSource, /'reservation-cancel' as const/, 'cancellation has a durable retry identity')
assert.match(drawerSource, /'reservation-no-show' as const/, 'no-show has a durable retry identity')
assert.match(drawerSource, /operation: 'reservation-update-guest'/, 'guest edit has a durable retry identity')
assert.match(drawerSource, /operation: 'folio-post-charge'/, 'charge posting has a durable retry identity')
assert.match(attemptSource, /'reservation-cancel'/, 'durable attempt keys allow lifecycle retries')
assert.match(attemptSource, /'reservation-update-guest'/, 'durable attempt keys allow guest retries')
assert.match(attemptSource, /'folio-post-charge'/, 'durable attempt keys allow charge retries')
assert.match(reservationsSource, /operation: action === 'cancel' \? 'reservation-cancel'/, 'the Reservations workspace uses the same durable lifecycle retry contract')
assert.match(reservationsSource, /'x-reservation-expected-updated-at': reservation\.updatedAt\.toISOString\(\)/, 'the Reservations workspace sends its stale-write token')
assert.match(reservationsSource, /durableAttemptKeys\.confirmSuccess\(attempt\)/, 'the Reservations workspace clears a lifecycle attempt only after confirmed success')
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
