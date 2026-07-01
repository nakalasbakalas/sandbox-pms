import { executeBookingComTask } from './booking-com.mjs'
import { executeOtaPlatformSkeletonTask, OTA_PLATFORM_SKELETONS } from './platform-skeleton.mjs'
import { normalizeOpsWorkerTaskPayload, runSignedMockOtaWorkerTask } from '../ops-worker-auth.mjs'

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
