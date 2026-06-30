import { executeBookingComTask } from './booking-com.mjs'
import { normalizeOpsWorkerTaskPayload, runSignedMockOtaWorkerTask } from '../ops-worker-auth.mjs'

export async function executeSignedOtaWorkerTask(payload, options = {}) {
  const task = normalizeOpsWorkerTaskPayload(payload)
  if (task.platform === 'booking') {
    return executeBookingComTask(task, options)
  }
  return runSignedMockOtaWorkerTask(task)
}
