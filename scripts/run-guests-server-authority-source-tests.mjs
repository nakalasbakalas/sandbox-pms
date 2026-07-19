/* global console */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { canReadOperationalEvent, requireOperationalEventPermission } from '../server/event-access.mjs'
import { ROLE_PERMISSIONS } from '../server/rbac.mjs'

const source = (await readFile('src/components/views/GuestsView.tsx', 'utf8')).replaceAll('\r\n', '\n')
const app = (await readFile('src/App.tsx', 'utf8')).replaceAll('\r\n', '\n')
const rbac = (await readFile('server/rbac.mjs', 'utf8')).replaceAll('\r\n', '\n')

const serverStart = source.indexOf('function ServerGuestsView()')
const demoStart = source.indexOf('function DemoGuestsView()')
assert.ok(serverStart >= 0 && demoStart >= 0, 'Guest Directory keeps distinct server and demo components')
const serverSlice = serverStart < demoStart ? source.slice(serverStart, demoStart) : source.slice(serverStart)
const demoSlice = demoStart < serverStart ? source.slice(demoStart, serverStart) : source.slice(demoStart)

assert.match(source, /server-guests-view/, 'the successful server Guest Directory has a stable authority test id')
assert.match(source, /server-guests-error/, 'the failed server Guest Directory has a stable authority test id')
assert.match(source, /Guest Directory unavailable/, 'Guest Directory fails closed when its snapshot is unavailable')
assert.match(source, /Retry/, 'Guest Directory has an inline authoritative retry')
assert.match(serverSlice, /\/api\/guests/, 'server Guest Directory reads the authenticated guest API')
assert.match(serverSlice, /pms:domain-event/, 'guest and reservation events refresh the server guest snapshot')
assert.match(serverSlice, /refreshGeneration/, 'server Guest Directory rejects stale refresh responses')
assert.match(serverSlice, /mounted/, 'server Guest Directory does not update state after unmount')
assert.doesNotMatch(serverSlice, /\buseKV\b|localStorage|sessionStorage/, 'server Guest Directory cannot mount browser-owned guest state')
assert.match(demoSlice, /\buseKV\b/, 'browser-owned guest state remains confined to demo mode')
assert.match(source, /hasPermission\('edit:reservation'\)/, 'New Guest uses the same effective permission as the server contract')
assert.match(app, /guests: \['view:guests'\]/, 'the client route requires guest-view permission')
assert.match(rbac, /guests: \['view:guests'\]/, 'the server route registry requires guest-view permission')
assert.match(app, /GUEST_CREATED: 'RESERVATION_MODIFIED'/, 'the event bridge subscribes to real guest-create events')
assert.match(app, /GUEST_UPDATED: 'RESERVATION_MODIFIED'/, 'the event bridge subscribes to real guest-update events')
assert.match(app, /hasAnyPermission\(\['view:board', 'view:cashier', 'view:guests'\]\)/, 'guest-only users can open the authenticated event stream')
const pmsService = (await readFile('server/pms-service.mjs', 'utf8')).replaceAll('\r\n', '\n')
assert.match(pmsService, /'GUEST_CREATED', 'guest', guest\.id, actor/, 'guest creation records a property-scoped guest event')
assert.match(pmsService, /'GUEST_UPDATED', 'guest', guest\.id, actor/, 'guest updates record a property-scoped guest event')

ROLE_PERMISSIONS.GUEST_DIRECTORY_TEST = ['view:guests']
try {
  const guestOnlyActor = { role: 'GUEST_DIRECTORY_TEST' }
  assert.doesNotThrow(() => requireOperationalEventPermission(guestOnlyActor), 'guest-directory users can subscribe to the property event stream')
  assert.equal(canReadOperationalEvent(guestOnlyActor, { aggregateType: 'guest' }), true, 'guest-directory users receive guest invalidations')
  assert.equal(canReadOperationalEvent(guestOnlyActor, { aggregateType: 'reservation' }), true, 'guest-directory users receive reservation invalidations needed by Guest Directory')
  assert.equal(canReadOperationalEvent(guestOnlyActor, { aggregateType: 'payment' }), false, 'guest-directory users cannot observe finance invalidations')
  assert.equal(canReadOperationalEvent(guestOnlyActor, { aggregateType: 'room' }), false, 'guest-directory users cannot observe board invalidations')
} finally {
  delete ROLE_PERMISSIONS.GUEST_DIRECTORY_TEST
}

const housekeepingActor = { role: 'HOUSEKEEPING' }
assert.doesNotThrow(() => requireOperationalEventPermission(housekeepingActor), 'housekeeping can subscribe for board and housekeeping invalidations')
assert.equal(canReadOperationalEvent(housekeepingActor, { aggregateType: 'reservation' }), true, 'housekeeping receives reservation invalidations needed by the room board')
assert.equal(canReadOperationalEvent(housekeepingActor, { aggregateType: 'room' }), true, 'housekeeping receives room invalidations')
assert.equal(canReadOperationalEvent(housekeepingActor, { aggregateType: 'housekeepingTask' }), true, 'housekeeping receives task invalidations')
assert.equal(canReadOperationalEvent(housekeepingActor, { aggregateType: 'payment' }), false, 'board access does not expose payment identifiers')
assert.equal(canReadOperationalEvent(housekeepingActor, { aggregateType: 'rateRule' }), false, 'board access does not expose rate identifiers')
assert.equal(canReadOperationalEvent(housekeepingActor, { aggregateType: 'property' }), false, 'board access does not expose settings identifiers')
assert.equal(canReadOperationalEvent(housekeepingActor, { aggregateType: 'guest' }), false, 'board access does not expose guest profile identifiers')

console.log('Guests server-authority source guards passed.')
