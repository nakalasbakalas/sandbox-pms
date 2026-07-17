import { createBookingComAdapter, executeBookingComTask } from './booking-com.mjs'
import { createOtaPlatformSkeletonAdapter, executeOtaPlatformSkeletonTask, OTA_PLATFORM_SKELETONS } from './platform-skeleton.mjs'
import { normalizeOpsWorkerTaskPayload, runSignedMockOtaWorkerTask } from '../ops-worker-auth.mjs'

export { providerAdapterContractSchema, sanitizeProviderEvidence } from './contract.mjs'

export async function getOtaProviderContracts({ env = process.env, now } = {}) {
  const options = { env, now }
  const adapters = [
    createBookingComAdapter(options),
    ...Object.keys(OTA_PLATFORM_SKELETONS).map((platform) => createOtaPlatformSkeletonAdapter(platform, options)),
  ]
  return Promise.all(adapters.map((adapter) => adapter.describeContract({ env, now: now ? new Date(now) : new Date() })))
}

export async function executeSignedOtaWorkerTask(payload, options = {}) {
  const task = normalizeOpsWorkerTaskPayload(payload)
  if (task.platform === 'booking') {
    return executeBookingComTask(task, options)
  }
  if (OTA_PLATFORM_SKELETONS[task.platform]) {
    return executeOtaPlatformSkeletonTask(task, options)
  }
  return runSignedMockOtaWorkerTask(task)
}
