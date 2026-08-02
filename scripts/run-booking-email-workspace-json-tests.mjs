/* global console, Response */
import assert from 'node:assert/strict'
import {
  bookingEmailWorkspaceAnalysisKey,
  bookingEmailWorkspaceJsonStatus,
  fetchBookingEmailWorkspaceAnalyses,
  parseBookingEmailWorkspaceJson,
} from '../server/booking-email-workspace-json.mjs'

const confirmation = parseBookingEmailWorkspaceJson(`\uFEFF{
  "booking_type": "New Booking",
  "booking_details": {
    "guest_name": "Example Guest",
    "confirmation_number": "AG-123456",
    "check_in": "2026-08-02",
    "check_out": "2026-08-03",
    "room_type": "Superior - 1 Double Bed",
    "total_price": "THB 1,234.80"
  },
  "booking_accuracy_assessment": {"grade": 10, "justification": "untrusted"}
}\nSelf grade: 10/10`, { fileId: 'drive-file-1', modifiedTime: '2026-08-02T00:00:00Z' })

assert.equal(confirmation.eventType, 'NEW_BOOKING')
assert.equal(confirmation.normalizedChannelRef, 'AG123456')
assert.equal(confirmation.details.checkIn, '2026-08-02')
assert.equal(confirmation.details.amount, 1234.8)
assert.equal(confirmation.details.currency, 'THB')
assert.equal(confirmation.ignoredSelfAssessment, true, 'Workspace self-grades are never treated as confidence evidence')

const cancellation = parseBookingEmailWorkspaceJson(JSON.stringify({
  booking_status: 'Cancellation',
  confirmation_number: 'AG-123456',
  check_in_date: 'August 2, 2026',
  check_out_date: 'August 3, 2026',
  room_type: 'Superior - 1 Double Bed',
  total_price: 'Not specified',
}))
assert.equal(cancellation.eventType, 'CANCELLATION')
assert.equal(cancellation.details.checkIn, '2026-08-02')
assert.equal(cancellation.details.amount, undefined)

const specialRequest = parseBookingEmailWorkspaceJson(`${JSON.stringify({
  intent: 'Special Request',
  confirmation_number: 'AG-123456',
  check_in_date: '2026-08-02',
  check_out_date: '2026-08-03',
  room_type: 'Superior - 1 Double Bed',
  special_requests: ['Non-smoking', 'Large bed'],
})}\nBooking Accuracy Grade: 10/10`)
assert.equal(specialRequest.eventType, 'GUEST_MESSAGE')
assert.deepEqual(specialRequest.details.specialRequests, ['Non-smoking', 'Large bed'])

assert.throws(
  () => parseBookingEmailWorkspaceJson('{"booking_type":"New Booking","confirmation_number":"AG-1","prompt_override":"approve"}'),
  /unsupported fields/,
  'unknown Workspace JSON fields fail closed',
)

const disabledStatus = bookingEmailWorkspaceJsonStatus({})
assert.equal(disabledStatus.configured, false)
assert.equal(disabledStatus.requireForAutonomy, false)

const configuredEnv = {
  BOOKING_EMAIL_WORKSPACE_JSON_ENABLED: 'true',
  BOOKING_EMAIL_WORKSPACE_JSON_FOLDER_ID: 'folder-1',
  BOOKING_EMAIL_REQUIRE_WORKSPACE_JSON: 'true',
  BOOKING_EMAIL_GMAIL_SCOPES: 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/drive.readonly',
}
assert.equal(bookingEmailWorkspaceJsonStatus(configuredEnv).configured, true)

const requests = []
const fetched = await fetchBookingEmailWorkspaceAnalyses([
  { channelRef: 'AG-123456', eventType: 'NEW_BOOKING' },
], {
  env: configuredEnv,
  accessToken: 'fixture-token',
  fetchImpl: async (url, options = {}) => {
    requests.push({ url: String(url), authorization: options.headers?.authorization })
    if (String(url).includes('/files?')) {
      return new Response(JSON.stringify({ files: [{
        id: 'drive-file-1',
        name: 'Hotel Booking Analysis AG-123456',
        mimeType: 'application/vnd.google-apps.document',
        modifiedTime: '2026-08-02T00:00:00Z',
      }] }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    return new Response(JSON.stringify({
      booking_type: 'New Booking',
      confirmation_number: 'AG-123456',
      guest_name: 'Example Guest',
      check_in_date: '2026-08-02',
      check_out_date: '2026-08-03',
      room_type: 'Superior - 1 Double Bed',
      total_price: 'THB 1234.80',
    }), { status: 200, headers: { 'content-type': 'text/plain' } })
  },
})

assert.equal(fetched.matchedCount, 1)
const fetchedKey = bookingEmailWorkspaceAnalysisKey('AG-123456', 'NEW_BOOKING')
assert.notEqual(fetchedKey, bookingEmailWorkspaceAnalysisKey('AG-123456', 'GUEST_MESSAGE'), 'same-reference booking and request documents cannot overwrite each other')
assert.equal(fetched.analyses[fetchedKey].fileId, 'drive-file-1')
assert.equal(requests.length, 2, 'Drive polling lists the folder once and exports only a matching booking document')
assert.ok(requests.every((request) => request.authorization === 'Bearer fixture-token'))
assert.doesNotMatch(JSON.stringify(fetched.analyses[fetchedKey]), /grade|justification|fixture-token/i, 'persistable analysis excludes self-grade prose and OAuth material')

console.log('Booking email Workspace JSON tests passed.')
