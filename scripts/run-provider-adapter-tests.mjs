/* global console */
import assert from 'node:assert/strict'

import {
  getOtaProviderContracts,
  providerAdapterContractSchema,
  sanitizeProviderEvidence,
} from '../server/ota-adapters/index.mjs'
import { createBookingComAdapter } from '../server/ota-adapters/booking-com.mjs'

const now = new Date('2026-07-16T12:00:00.000Z')
const env = {
  BOOKING_USERNAME: 'configured-user',
  BOOKING_PASSWORD: 'must-not-appear',
  AGODA_USERNAME: 'configured-user',
  AGODA_PASSWORD: 'must-not-appear',
  TRIP_COM_USERNAME: 'configured-user',
  TRIP_COM_PASSWORD: 'must-not-appear',
  EXPEDIA_USERNAME: 'configured-user',
  EXPEDIA_PASSWORD: 'must-not-appear',
  OTA_LIVE_WRITES_ENABLED: 'false',
}

const contracts = await getOtaProviderContracts({ env, now })
assert.deepEqual(contracts.map((contract) => contract.provider.id), ['booking', 'agoda', 'trip', 'expedia'])
for (const contract of contracts) {
  assert.equal(providerAdapterContractSchema.safeParse(contract).success, true, `${contract.provider.id} contract validates`)
  assert.equal(contract.mode.default, 'dry-run')
  assert.equal(contract.mode.liveWritesEnabled, false)
  assert.deepEqual(contract.capabilities.liveWrites, [])
  assert.equal(contract.capabilities.reads.includes('READ_RESERVATIONS'), true)
  assert.equal(contract.capabilities.dryRunWrites.includes('UPDATE_AVAILABILITY'), true)
  assert.equal(contract.retryPolicy.maxAttempts, 1, 'unverified provider calls do not imply retries')
  assert.equal(contract.rateLimit.source, 'unverified', 'provider rate limits are not invented')
}
assert.equal(JSON.stringify(contracts).includes('must-not-appear'), false, 'contracts omit credential values')
assert.equal(JSON.stringify(contracts).includes('BOOKING_PASSWORD'), false, 'contracts omit credential environment keys')

const unconfiguredContracts = await getOtaProviderContracts({ env: { OTA_LIVE_WRITES_ENABLED: 'false' }, now })
assert.equal(unconfiguredContracts.every((contract) => contract.health.status === 'needs-configuration'), true)

const requestedContract = await createBookingComAdapter({ env: { ...env, OTA_LIVE_WRITES_ENABLED: 'true' }, now })
  .describeContract({ env: { ...env, OTA_LIVE_WRITES_ENABLED: 'true' }, now })
assert.equal(requestedContract.mode.liveWriteRequested, true)
assert.equal(requestedContract.mode.liveWritesEnabled, false, 'flag alone cannot enable an unimplemented, unproven provider')
assert.deepEqual(requestedContract.capabilities.liveWrites, [])

await assert.rejects(
  createBookingComAdapter({ env, now }).updateRate({
    taskId: 'task-live-write-denied',
    roomType: 'Standard Twin',
    dateStart: '2026-07-20',
    dateEnd: '2026-07-21',
    amount: 1200,
    dryRun: false,
  }),
  /real Booking\.com browser writes are not implemented/,
)

const evidence = sanitizeProviderEvidence([
  {
    id: 'proof-1',
    kind: 'after',
    storageUrl: 'https://proof.example.test/capture?token=top-secret&view=safe#private',
    capturedAt: now,
    redactionStatus: 'SAFE',
    password: 'must-be-dropped',
  },
  {
    id: 'proof-2',
    kind: 'unknown-kind',
    storageUrl: 'https://proof.example.test/raw?view=unsafe',
    capturedAt: 'not-a-date',
    redactionStatus: 'UNKNOWN',
  },
], { providerId: 'booking', now })
assert.equal(evidence.length, 2)
assert.equal(evidence[0].kind, 'after')
assert.equal(evidence[0].storageUrl.includes('top-secret'), false)
assert.equal(evidence[0].storageUrl.includes('private'), false)
assert.equal(Object.hasOwn(evidence[0], 'password'), false)
assert.equal(evidence[1].kind, 'trace')
assert.equal(evidence[1].redactionStatus, 'FAILED')
assert.match(evidence[1].storageUrl, /^mock:\/\/ota\/booking\/trace-2-redaction-blocked$/)
assert.equal(evidence[1].capturedAt, now.toISOString())

console.log('Provider adapter contract tests passed')
