/* global console, process */
import { executeSignedOtaWorkerTask } from '../server/ota-adapters/index.mjs'
import { executeOpsWorkerTask } from '../server/ops-worker-client.mjs'

const task = {
  id: `rate-dryrun-${Date.now()}`,
  taskType: 'UPDATE_RATE',
  platform: 'booking',
  hotelId: 'sandbox-nakhon-si-thammarat',
  roomType: 'standard twin',
  dateStart: '2027-01-01',
  dateEnd: '2027-01-01',
  message: 'rate-push dry-run validation for staging credentials',
  rateAmount: 1200,
  rateCurrency: 'THB',
}

const payload = {
  taskId: task.id,
  taskType: task.taskType,
  platform: task.platform,
  hotelId: task.hotelId,
  roomType: task.roomType,
  dateStart: task.dateStart,
  dateEnd: task.dateEnd,
  message: task.message,
  rate: { amount: task.rateAmount, currency: task.rateCurrency },
  dryRun: true,
}

const localResult = await executeOpsWorkerTask(task, { dryRun: true })
console.log('RATE_PUSH_DRYRUN_EVIDENCE', JSON.stringify({
  source: 'executeOpsWorkerTask',
  dryRun: true,
  request: {
    endpoint: '/api/rates/push (server path equivalent)',
    payload,
    workerMode: 'server',
  },
  response: localResult,
}, null, 2))

const directResult = await executeSignedOtaWorkerTask(payload, { env: process.env })
console.log('RATE_PUSH_ADAPTER_RESULT', JSON.stringify(directResult, null, 2))
