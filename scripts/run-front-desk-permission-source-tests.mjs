/* global console */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const frontDesk = await readFile('src/components/front-desk/FrontDeskView.tsx', 'utf8')
const assistant = await readFile('src/components/front-desk-assistant/FrontDeskAssistantProvider.tsx', 'utf8')
const arrivals = await readFile('src/components/front-desk/ArrivalList.tsx', 'utf8')
const departures = await readFile('src/components/front-desk/DepartureList.tsx', 'utf8')

for (const permission of [
  "hasPermission('create:reservation')",
  "hasPermission('edit:reservation')",
  "hasPermission('check-in:guest')",
  "hasPermission('check-out:guest')",
  "hasPermission('edit:room-status')",
]) {
  assert.match(frontDesk, new RegExp(permission.replace(/[():']/g, '\\$&')), `Front Desk must enforce ${permission}.`)
}

assert.match(arrivals, /Check-in restricted/, 'Arrival actions must visibly show check-in denial.')
assert.match(departures, /Check-out restricted/, 'Departure actions must visibly show check-out denial.')
assert.match(frontDesk, /Room-status edit permission is required/, 'Room-readiness writes must be permission-gated.')

for (const operation of ['reservation-check-in', 'reservation-check-out']) {
  assert.match(frontDesk, new RegExp(`operation: '${operation}'`), `${operation} must use a durable attempt key.`)
}
assert.match(frontDesk, /x-reservation-expected-updated-at/, 'Lifecycle writes must send the optimistic-concurrency header.')
assert.match(frontDesk, /expectedUpdatedAt/, 'Lifecycle writes must include the optimistic-concurrency body token.')
assert.match(frontDesk, /await refreshServerBoard\(\)\.catch/, 'Lifecycle outcomes must refetch authoritative state.')
assert.match(frontDesk, /Connection outcome is unknown/, 'Ambiguous lifecycle outcomes must instruct a protected retry.')
assert.match(frontDesk, /pendingAssignmentAttempt/, 'Ambiguous room assignment retries must retain their original request snapshot.')
assert.match(frontDesk, /isDefinitivePmsApiError/, 'Only definitive client rejections may retire lifecycle retry state.')
assert.match(frontDesk, /useAuthoritativeWorkflowNavigationVersion/, 'Front Desk must observe same-route authoritative workflow handoffs.')

assert.doesNotMatch(assistant, /method:\s*'POST'/, 'Front Desk AI must not send mutating API requests.')
assert.doesNotMatch(assistant, /sessionStorage/, 'Front Desk AI must not use browser storage to hand off mutations.')
assert.doesNotMatch(assistant, /updateRoomStatus/, 'Front Desk AI must not mutate local room state.')
assert.match(assistant, /navigateToAuthoritativeWorkflow/, 'Front Desk AI actions must open authoritative workflows.')
assert.match(assistant, /No change was applied by Front Desk AI/, 'Front Desk AI must state its navigation-only boundary.')
assert.match(assistant, /Sent the request to the authoritative staff workflow/, 'Front Desk AI must not falsely claim same-route workflow consumption.')

console.log('Front Desk permission and AI navigation source tests passed.')
