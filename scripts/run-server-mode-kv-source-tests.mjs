/* global console */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const frontDesk = await readFile('src/components/front-desk/FrontDeskView.tsx', 'utf8')
const assistant = await readFile('src/components/front-desk-assistant/FrontDeskAssistantProvider.tsx', 'utf8')
const messaging = await readFile('src/components/messaging/CommunicationCenterView.tsx', 'utf8')

function componentSlice(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start)
  assert.ok(start >= 0, `Missing ${startMarker}.`)
  assert.ok(end > start, `Missing ${endMarker} after ${startMarker}.`)
  return source.slice(start, end)
}

assert.match(frontDesk, /return SERVER_API_ENABLED \? <ServerFrontDeskView \/> : <DemoFrontDeskView \/>/, 'Front Desk must select a server-only or demo-only data provider.')
const serverFrontDesk = componentSlice(frontDesk, 'function ServerFrontDeskView()', 'function DemoFrontDeskView()')
const demoFrontDesk = componentSlice(frontDesk, 'function DemoFrontDeskView()', 'function FrontDeskViewContent(')
assert.doesNotMatch(serverFrontDesk, /useKV|useRoomSync/, 'Server Front Desk must not mount KV-backed room or workflow hooks.')
assert.match(demoFrontDesk, /useKV<UnassignedReservation\[\]>/, 'Demo Front Desk must retain its isolated KV workflow state.')
assert.match(demoFrontDesk, /useRoomSync\(\{ serverSync: false \}\)/, 'Demo Front Desk must isolate the KV-backed room sync hook.')
assert.match(frontDesk, /boardRefreshGeneration/, 'Front Desk must track overlapping authoritative refreshes.')
assert.match(frontDesk, /generation !== boardRefreshGeneration\.current/, 'Stale Front Desk responses must not overwrite newer authoritative state.')
assert.match(frontDesk, /data-testid="server-front-desk-unavailable"/, 'Front Desk must fail closed while its authoritative Board is unavailable.')
assert.match(frontDesk, /No operational totals or actions are shown/, 'Front Desk must not render false zero-state operations while loading.')

assert.match(assistant, /return SERVER_API_ENABLED\s*\? <ServerFrontDeskAssistantRuntime/, 'Front Desk AI must select a server-only or demo-only data provider.')
const serverAssistant = componentSlice(assistant, 'function ServerFrontDeskAssistantRuntime(', 'function DemoFrontDeskAssistantRuntime(')
const demoAssistant = componentSlice(assistant, 'function DemoFrontDeskAssistantRuntime(', 'function FrontDeskAssistantContent(')
assert.doesNotMatch(serverAssistant, /useKV|useRoomSync/, 'Server Front Desk AI must not mount KV-backed operational hooks.')
assert.match(demoAssistant, /useKV<UnassignedReservation\[\]>/, 'Demo Front Desk AI must retain its isolated KV reservation state.')
assert.match(demoAssistant, /useRoomSync\(\{ serverSync: false \}\)/, 'Demo Front Desk AI must retain its isolated KV room state.')
assert.match(assistant, /source\.isServer \? \(source\.board \? mapServerBoardRooms\(source\.board\) : \[\]\)/, 'Server Front Desk AI must build its room snapshot only from the authoritative board.')

assert.match(messaging, /return SERVER_API_ENABLED \? <ServerCommunicationCenterView \/> : <DemoCommunicationCenterView \/>/, 'Messaging must select a server-only or demo-only data provider.')
const serverMessaging = componentSlice(messaging, 'function ServerCommunicationCenterView()', 'function DemoCommunicationCenterView()')
const demoMessaging = componentSlice(messaging, 'function DemoCommunicationCenterView()', 'function CommunicationCenterContent(')
assert.doesNotMatch(serverMessaging, /useKV/, 'Server messaging must not mount browser KV data.')
assert.match(demoMessaging, /useKV<Message\[\]>\('messages'/, 'Demo messaging must retain its isolated message KV store.')
assert.match(messaging, /data-testid="server-messaging-unavailable"/, 'Messaging must fail closed when its server authority is unavailable.')
assert.match(messaging, /Retry messaging/, 'Messaging must provide an explicit server retry path.')
assert.match(messaging, /onSend=\{saveDraft\}/, 'Messaging closes the draft dialog only after its selected provider confirms the save.')
assert.match(messaging, /defaultValue="drafts"/, 'Messaging opens on persisted drafts instead of hiding unsent work.')
assert.match(messaging, /Drafts \(\{draftMessages\.length\}\)/, 'Messaging exposes persisted drafts in a dedicated tab.')
assert.match(messaging, /hasPermission\('send:guest-messages'\)/, 'Messaging must evaluate the guest-message permission before exposing compose actions.')
assert.match(messaging, /data-testid="messaging-compose-restricted"/, 'Read-only messaging users must see an explicit capability boundary.')
assert.match(messaging, /canCompose=\{canSendGuestMessages\}/, 'Message templates must respect the same compose permission.')

console.log('Server-mode KV instantiation source tests passed.')
