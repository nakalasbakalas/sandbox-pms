/* global console, process */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const files = {
  boardTypes: 'src/types/board.ts',
  apiClient: 'src/lib/pms-api-client.ts',
  roomsView: 'src/components/rooms/RoomsView.tsx',
  launchProofPack: 'docs/launch/LAUNCH_PROOF_PACK_V2.md',
  remediationPlan: 'docs/remediation/council-remediation-patches.md',
}

async function read(path) {
  return readFile(path, 'utf8')
}

function requireIncludes(source, needle, message) {
  assert.ok(source.includes(needle), message || `Expected source to include ${needle}`)
}

function requireNotIncludes(source, needle, message) {
  assert.ok(!source.includes(needle), message || `Expected source not to include ${needle}`)
}

const boardTypes = await read(files.boardTypes)
requireIncludes(boardTypes, 'roomTypeCode?: string', 'Board room cards must carry server roomTypeCode metadata.')
requireIncludes(boardTypes, 'roomTypeName?: string', 'Board room cards must carry server roomTypeName metadata.')

const apiClient = await read(files.apiClient)
requireIncludes(apiClient, 'function roomTypeMetadata', 'PMS API mapper must centralize dynamic room-type metadata handling.')
requireIncludes(apiClient, 'roomTypeId: roomType.id', 'PMS API mapper must expose roomTypeId from server data.')
requireIncludes(apiClient, 'roomTypeCode: roomType.code', 'PMS API mapper must expose roomTypeCode from server data.')
requireIncludes(apiClient, 'roomTypeName: roomType.name', 'PMS API mapper must expose roomTypeName from server data.')
requireNotIncludes(
  apiClient,
  "room.roomType?.code === 'DOUBLE' ? 'DOUBLE' : 'TWIN'",
  'PMS API mapper must not collapse every non-DOUBLE room into TWIN.',
)

const roomsView = await read(files.roomsView)
requireIncludes(roomsView, 'function roomTypeKey', 'Rooms view must group by source room-type key.')
requireIncludes(roomsView, 'function roomTypeLabel', 'Rooms view must label sections from source room-type metadata.')
requireNotIncludes(
  roomsView,
  "room.roomTypeId || room.roomType || room.type || 'unknown'",
  'Rooms view should prefer roomTypeCode/roomTypeName-aware grouping, not the old visual bucket only.',
)

const launchProofPack = await read(files.launchProofPack)
requireIncludes(launchProofPack, 'Credentialed auth/RBAC proof', 'Launch proof pack v2 must include credentialed auth/RBAC proof.')
requireIncludes(launchProofPack, 'Cloudflare WAF/rate-limit proof', 'Launch proof pack v2 must include privileged WAF/rate-limit proof.')
requireIncludes(launchProofPack, 'Database backup/recovery proof', 'Launch proof pack v2 must include backup/recovery proof.')

const remediationPlan = await read(files.remediationPlan)
requireIncludes(remediationPlan, 'Council remediation queue', 'Council remediation plan must be present.')
requireIncludes(remediationPlan, 'Money precision', 'Council remediation plan must include money precision remediation.')
requireIncludes(remediationPlan, 'PII governance', 'Council remediation plan must include PII governance remediation.')

console.log('Council remediation checks passed.')
