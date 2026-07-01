import { getOpsScanPolicy, runOpsScan } from './ops-service.mjs'

const SYSTEM_SCAN_ACTOR = Object.freeze({
  id: 'system',
  role: 'SYSTEM',
  name: 'Hotel Ops Scheduler',
})

function redactSchedulerError(error) {
  return String(error?.message || error || 'Scheduled scan failed.')
    .replace(/\b(password|secret|token|key)=([^&\s]+)/gi, '$1=[redacted]')
    .replace(/\b(Bearer)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 [redacted]')
    .slice(0, 500)
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60_000).toISOString()
}

function disabledReasonForPolicy(policy) {
  if (policy.schedule.mode === 'cron') return 'external_cron'
  if (policy.schedule.configured) return 'unsupported_schedule'
  return 'manual_only'
}

export function createHotelOpsScanScheduler(options = {}) {
  const {
    env = process.env,
    prisma = null,
    getPrisma = null,
    runScan = runOpsScan,
    logger = console,
    setIntervalFn = setInterval,
    clearIntervalFn = clearInterval,
    now = () => new Date(),
  } = options

  const policy = getOpsScanPolicy(env)
  const intervalMinutes = policy.schedule.mode === 'interval' ? policy.schedule.intervalMinutes : null
  const enabled = Number.isFinite(intervalMinutes) && intervalMinutes > 0
  let timer = null
  let running = false

  const state = {
    enabled,
    mode: policy.schedule.mode,
    intervalMinutes: enabled ? intervalMinutes : null,
    status: enabled ? 'IDLE' : 'DISABLED',
    disabledReason: enabled ? null : disabledReasonForPolicy(policy),
    startedAt: null,
    lastRunStartedAt: null,
    lastRunAt: null,
    nextRunAt: null,
    lastAlertCount: null,
    lastError: null,
  }

  async function resolvePrisma() {
    if (typeof getPrisma === 'function') return getPrisma()
    if (prisma) return prisma
    throw new Error('Prisma client is not available for scheduled Hotel Ops scans.')
  }

  function getStatus() {
    return {
      ...state,
      started: Boolean(timer),
      running,
    }
  }

  async function runOnce(trigger = 'scheduled') {
    if (!state.enabled) {
      return { skipped: true, reason: state.disabledReason || 'disabled', status: getStatus() }
    }
    if (running) {
      return { skipped: true, reason: 'already_running', status: getStatus() }
    }

    running = true
    state.status = 'RUNNING'
    state.lastError = null
    state.lastRunStartedAt = now().toISOString()

    let result
    try {
      const db = await resolvePrisma()
      const alerts = await runScan(db, { source: 'scheduler', trigger }, SYSTEM_SCAN_ACTOR)
      state.status = 'SUCCEEDED'
      state.lastRunAt = now().toISOString()
      state.lastAlertCount = Array.isArray(alerts) ? alerts.length : 0
      result = { skipped: false, alerts }
    } catch (error) {
      const message = redactSchedulerError(error)
      state.status = 'FAILED'
      state.lastRunAt = now().toISOString()
      state.lastAlertCount = null
      state.lastError = message
      logger.error?.('Hotel Ops scheduled scan failed:', message)
      result = { skipped: false, error: message }
    } finally {
      running = false
      if (state.enabled && timer) state.nextRunAt = addMinutes(now(), state.intervalMinutes)
    }

    return { ...result, status: getStatus() }
  }

  function start() {
    if (!state.enabled) {
      return { started: false, reason: state.disabledReason || 'disabled', status: getStatus() }
    }
    if (timer) {
      return { started: false, reason: 'already_started', status: getStatus() }
    }

    state.startedAt = now().toISOString()
    state.nextRunAt = addMinutes(now(), state.intervalMinutes)
    timer = setIntervalFn(() => {
      void runOnce('interval')
    }, state.intervalMinutes * 60_000)
    timer?.unref?.()
    return { started: true, status: getStatus() }
  }

  function stop() {
    if (timer) {
      clearIntervalFn(timer)
      timer = null
    }
    state.nextRunAt = null
    return getStatus()
  }

  return {
    start,
    stop,
    runOnce,
    getStatus,
  }
}
