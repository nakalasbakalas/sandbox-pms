#!/usr/bin/env node
/* global console, process */
import { readFile, writeFile, rm } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = process.cwd()

function replaceOnce(content, search, replacement, path) {
  const first = content.indexOf(search)
  if (first === -1) throw new Error(`Expected source block was not found in ${path}`)
  if (content.indexOf(search, first + search.length) !== -1) throw new Error(`Expected source block is not unique in ${path}`)
  return content.slice(0, first) + replacement + content.slice(first + search.length)
}

async function patch(path, transform) {
  const absolute = resolve(root, path)
  const current = await readFile(absolute, 'utf8')
  const next = transform(current)
  if (next === current) throw new Error(`Patch produced no change for ${path}`)
  await writeFile(absolute, next)
  console.log(`updated ${path}`)
}

await patch('server/availability-queue.mjs', (content) => replaceOnce(
  content,
  `    if (task.status !== 'PENDING_APPROVAL') {
      throw new PmsValidationError(\`Availability queue item cannot be approved from \${task.status}.\`, 409)
    }

    const approval = await tx.hotelOpsTaskApproval.findFirst({`,
  `    if (task.status !== 'PENDING_APPROVAL') {
      throw new PmsValidationError(\`Availability queue item cannot be approved from \${task.status}.\`, 409)
    }

    const emergencyStop = await tx.hotelOpsEmergencyStop.findUnique({ where: { propertyId: task.propertyId } })
    if (emergencyStop?.enabled) {
      throw new PmsValidationError('Emergency stop is enabled for Hotel Ops write tasks.', 409)
    }

    const approval = await tx.hotelOpsTaskApproval.findFirst({`,
  'server/availability-queue.mjs',
))

await patch('scripts/run-channel-sync-tests.mjs', (content) => {
  let next = replaceOnce(
    content,
    `function createQueuePrismaFixture() {
  const now = () => new Date('2026-07-10T00:00:00.000Z')`,
    `function createQueuePrismaFixture(options = {}) {
  const now = () => new Date('2026-07-10T00:00:00.000Z')`,
    'scripts/run-channel-sync-tests.mjs',
  )
  next = replaceOnce(
    next,
    `  let logCounter = 0
  let auditCounter = 0`,
    `  let logCounter = 0
  let auditCounter = 0
  let emergencyStopEnabled = Boolean(options.emergencyStopEnabled)`,
    'scripts/run-channel-sync-tests.mjs',
  )
  next = replaceOnce(
    next,
    `    hotelOpsEmergencyStop: {
      findUnique: async () => ({ id: 'stop-1', propertyId: property.id, enabled: false }),
    },`,
    `    hotelOpsEmergencyStop: {
      findUnique: async () => ({ id: 'stop-1', propertyId: property.id, enabled: emergencyStopEnabled }),
    },`,
    'scripts/run-channel-sync-tests.mjs',
  )
  next = replaceOnce(
    next,
    `    audits,
    getTask: (taskId) => withRelations(tasks.find((task) => task.id === taskId)),`,
    `    audits,
    setEmergencyStop: (enabled) => { emergencyStopEnabled = Boolean(enabled) },
    getTask: (taskId) => withRelations(tasks.find((task) => task.id === taskId)),`,
    'scripts/run-channel-sync-tests.mjs',
  )
  next = replaceOnce(
    next,
    `  assert.equal(fixture.logs.some((log) => log.taskId === created.item.id && log.action === 'TASK_QUEUED'), false)
  assert.equal(fixture.logs.some((log) => log.taskId === created.item.id && log.action === 'AVAILABILITY_APPROVED'), true)

  const workerDecision = evaluateOpsTaskRun(fixture.getTask(created.item.id), admin, { enabled: false })`,
    `  assert.equal(fixture.logs.some((log) => log.taskId === created.item.id && log.action === 'TASK_QUEUED'), false)
  assert.equal(fixture.logs.some((log) => log.taskId === created.item.id && log.action === 'AVAILABILITY_APPROVED'), true)

  const stoppedFixture = createQueuePrismaFixture({ emergencyStopEnabled: true })
  const stoppedAdmin = await resolveAvailabilityQueueActor(stoppedFixture.prisma, 'admin')
  const stoppedManager = await resolveAvailabilityQueueActor(stoppedFixture.prisma, 'manager')
  const stoppedItem = await createAvailabilityQueueItem(stoppedFixture.prisma, {
    provider: 'trip',
    hotelId: 'TRIP-STOPPED',
    roomType: 'DOUBLE',
    startDate: '2026-07-11',
    endDate: '2026-07-12',
    availableRooms: 1,
    reason: 'Queue while emergency stop is active.',
  }, stoppedAdmin)
  await assert.rejects(
    () => approveAvailabilityQueueItem(stoppedFixture.prisma, stoppedItem.item.id, { notes: 'Should be blocked.' }, stoppedManager),
    /Emergency stop is enabled/,
  )
  assert.equal(stoppedFixture.getTask(stoppedItem.item.id).status, 'PENDING_APPROVAL')
  assert.equal(stoppedFixture.approvals[0].status, 'PENDING')

  const workerDecision = evaluateOpsTaskRun(fixture.getTask(created.item.id), admin, { enabled: false })`,
    'scripts/run-channel-sync-tests.mjs',
  )
  return next
})

await patch('docs/CHANNEL_SYNC_V2.md', (content) => replaceOnce(
  content,
  `- Generic Hotel Ops approval leaves these records in \`APPROVED\`; generic queue/run actions reject them.
- The task interface labels them as manual delivery and hides the worker Run action.`,
  `- Generic Hotel Ops approval leaves these records in \`APPROVED\`; generic queue/run actions reject them.
- Both the task interface and dedicated CLI approval path honor the Hotel Ops emergency stop.
- The task interface labels them as manual delivery and hides the worker Run action.`,
  'docs/CHANNEL_SYNC_V2.md',
))

await rm(resolve(root, 'scripts/apply-channel-sync-lite-emergency-stop.mjs'))
await rm(resolve(root, '.github/workflows/apply-channel-sync-lite-emergency-stop.yml'))
console.log('Emergency-stop consistency patch applied; temporary files removed.')
