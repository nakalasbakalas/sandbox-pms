import { getOpsScanPolicy, runOpsScan, submitOpsCommand } from './ops-service.mjs'
import {
  bookingEmailGmailCredentialStatus,
  listBookingEmailSources,
  syncBookingEmail,
} from './pms-service.mjs'
import { processEmailOpsCommandEvents } from './email-ops-intake.mjs'

const SYSTEM_SCAN_ACTOR = Object.freeze({
  id: 'system',
  role: 'SYSTEM',
  name: 'Hotel Ops Scheduler',
})

const SYSTEM_BOOKING_EMAIL_ACTOR = Object.freeze({
  id: 'system',
  role: 'SYSTEM',
  name: 'Near-live Booking Email Scheduler',
})

function redactSchedulerError(error) {
  return String(error?.message || error || 'Scheduled scan failed.')
    .replace(/\b(password|secret|token|key)=([^&\s]+)/gi, '$1=[redacted]')
    .replace(/\b(Bearer)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 [redacted]')
    .replace(/\bya29\.[A-Za-z0-9._-]+/g, 'ya29.[redacted]')
    .slice(0, 500)
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60_000).toISOString()
}

function addSeconds(date, seconds) {
  return new Date(date.getTime() + seconds * 1_000).toISOString()
}

function envEnabled(value) {
  return ['1', 'true', 'yes', 'on', 'enabled'].includes(String(value || '').trim().toLowerCase())
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(Math.max(Math.round(parsed), minimum), maximum)
}

function disabledReasonForPolicy(policy) {
  if (policy.schedule.mode === 'cron') return 'external_cron'
  if (policy.schedule.configured) return 'unsupported_schedule'
  return 'manual_only'
}

export function getBookingEmailSyncPolicy(env = process.env) {
  const requested = envEnabled(env.BOOKING_EMAIL_NEAR_LIVE_ENABLED)
  const intervalSeconds = boundedInteger(env.BOOKING_EMAIL_SYNC_INTERVAL_SECONDS, 120, 30, 3_600)
  const batchLimit = boundedInteger(env.BOOKING_EMAIL_SYNC_BATCH_LIMIT, 25, 1, 250)
  const credentials = bookingEmailGmailCredentialStatus(env)
  const enabled = requested && credentials.configured

  return {
    requested,
    configured: credentials.configured,
    enabled,
    intervalSeconds,
    batchLimit,
    reviewOnly: true,
    operationalMutationsEnabled: false,
    disabledReason: enabled
      ? null
      : !requested
        ? 'not_requested'
        : 'gmail_oauth_not_configured',
    credentialMode: credentials.mode,
    targetMailboxConfigured: credentials.targetMailboxConfigured,
    missing: credentials.missing,
  }
}

function initialBookingEmailState(policy) {
  return {
    requested: policy.requested,
    configured: policy.configured,
    enabled: policy.enabled,
    intervalSeconds: policy.intervalSeconds,
    batchLimit: policy.batchLimit,
    reviewOnly: true,
    operationalMutationsEnabled: false,
    status: policy.enabled ? 'IDLE' : 'DISABLED',
    disabledReason: policy.disabledReason,
    credentialMode: policy.credentialMode,
    targetMailboxConfigured: policy.targetMailboxConfigured,
    missing: policy.missing,
    startedAt: null,
    lastRunStartedAt: null,
    lastRunAt: null,
    nextRunAt: null,
    lastSourceCount: null,
    lastImportedCount: null,
    lastCommandCount: null,
    lastErrorCount: null,
    lastError: null,
  }
}

export function createHotelOpsScanScheduler(options = {}) {
  const {
    env = process.env,
    prisma = null,
    getPrisma = null,
    runScan = runOpsScan,
    listBookingSources = listBookingEmailSources,
    syncBooking = syncBookingEmail,
    processEmailCommands = processEmailOpsCommandEvents,
    submitEmailCommand = submitOpsCommand,
    logger = console,
    setIntervalFn = setInterval,
    clearIntervalFn = clearInterval,
    now = () => new Date(),
  } = options

  const policy = getOpsScanPolicy(env)
  const intervalMinutes = policy.schedule.mode === 'interval' ? policy.schedule.intervalMinutes : null
  const enabled = Number.isFinite(intervalMinutes) && intervalMinutes > 0
  const bookingEmailPolicy = getBookingEmailSyncPolicy(env)
  let timer = null
  let bookingEmailTimer = null
  let running = false
  let bookingEmailRunning = false

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
    bookingEmail: initialBookingEmailState(bookingEmailPolicy),
  }

  async function resolvePrisma() {
    if (typeof getPrisma === 'function') return getPrisma()
    if (prisma) return prisma
    throw new Error('Prisma client is not available for scheduled Hotel Ops scans.')
  }

  function getStatus() {
    return {
      ...state,
      bookingEmail: {
        ...state.bookingEmail,
        started: Boolean(bookingEmailTimer),
        running: bookingEmailRunning,
      },
      started: Boolean(timer),
      anyStarted: Boolean(timer || bookingEmailTimer),
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

  async function runBookingEmailOnce(trigger = 'scheduled') {
    const emailState = state.bookingEmail
    if (!emailState.enabled) {
      return { skipped: true, reason: emailState.disabledReason || 'disabled', status: getStatus() }
    }
    if (bookingEmailRunning) {
      return { skipped: true, reason: 'already_running', status: getStatus() }
    }

    bookingEmailRunning = true
    emailState.status = 'RUNNING'
    emailState.lastError = null
    emailState.lastRunStartedAt = now().toISOString()

    try {
      const db = await resolvePrisma()
      const sources = (await listBookingSources(db)).filter((source) => source.enabled)
      const sourceResults = []
      let importedCount = 0
      let commandCount = 0
      let errorCount = 0

      for (const source of sources) {
        try {
          const result = await syncBooking(
            db,
            {
              sourceId: source.id,
              reviewOnly: true,
              limit: emailState.batchLimit,
              schedulerTrigger: trigger,
            },
            SYSTEM_BOOKING_EMAIL_ACTOR,
          )
          const events = Array.isArray(result?.events) ? result.events : []
          const commandEvents = Array.isArray(result?.opsCommandEvents) ? result.opsCommandEvents : events
          const commandResults = commandEvents.length > 0
            ? await processEmailCommands(db, commandEvents, {
                env,
                submitCommand: submitEmailCommand,
              })
            : []
          const acceptedCommands = commandResults.filter((item) => item.status === 'accepted').length
          importedCount += events.length
          commandCount += acceptedCommands
          sourceResults.push({
            sourceId: source.id,
            mailbox: source.mailbox,
            imported: events.length,
            acceptedCommands,
            error: null,
          })
        } catch (error) {
          const message = redactSchedulerError(error)
          errorCount += 1
          sourceResults.push({
            sourceId: source.id,
            mailbox: source.mailbox,
            imported: 0,
            acceptedCommands: 0,
            error: message,
          })
          logger.error?.(`Near-live booking email sync failed for ${source.mailbox || source.id}:`, message)
        }
      }

      emailState.status = errorCount === 0 ? 'SUCCEEDED' : importedCount > 0 ? 'PARTIAL' : 'FAILED'
      emailState.lastRunAt = now().toISOString()
      emailState.lastSourceCount = sources.length
      emailState.lastImportedCount = importedCount
      emailState.lastCommandCount = commandCount
      emailState.lastErrorCount = errorCount
      emailState.lastError = sourceResults.find((item) => item.error)?.error || null

      return {
        skipped: false,
        trigger,
        sources: sourceResults,
        importedCount,
        commandCount,
        errorCount,
        status: getStatus(),
      }
    } catch (error) {
      const message = redactSchedulerError(error)
      emailState.status = 'FAILED'
      emailState.lastRunAt = now().toISOString()
      emailState.lastSourceCount = null
      emailState.lastImportedCount = null
      emailState.lastCommandCount = null
      emailState.lastErrorCount = 1
      emailState.lastError = message
      logger.error?.('Near-live booking email scheduler failed:', message)
      return { skipped: false, error: message, status: getStatus() }
    } finally {
      bookingEmailRunning = false
      if (emailState.enabled && bookingEmailTimer) {
        emailState.nextRunAt = addSeconds(now(), emailState.intervalSeconds)
      }
    }
  }

  function start() {
    let started = false

    if (state.enabled && !timer) {
      state.startedAt = now().toISOString()
      state.nextRunAt = addMinutes(now(), state.intervalMinutes)
      timer = setIntervalFn(() => {
        void runOnce('interval')
      }, state.intervalMinutes * 60_000)
      timer?.unref?.()
      started = true
    }

    if (state.bookingEmail.enabled && !bookingEmailTimer) {
      state.bookingEmail.startedAt = now().toISOString()
      state.bookingEmail.nextRunAt = addSeconds(now(), state.bookingEmail.intervalSeconds)
      bookingEmailTimer = setIntervalFn(() => {
        void runBookingEmailOnce('interval')
      }, state.bookingEmail.intervalSeconds * 1_000)
      bookingEmailTimer?.unref?.()
      started = true
    }

    if (started) return { started: true, status: getStatus() }
    if (timer || bookingEmailTimer) {
      return { started: false, reason: 'already_started', status: getStatus() }
    }
    return {
      started: false,
      reason: state.disabledReason || state.bookingEmail.disabledReason || 'disabled',
      status: getStatus(),
    }
  }

  function stop() {
    if (timer) {
      clearIntervalFn(timer)
      timer = null
    }
    if (bookingEmailTimer) {
      clearIntervalFn(bookingEmailTimer)
      bookingEmailTimer = null
    }
    state.nextRunAt = null
    state.bookingEmail.nextRunAt = null
    return getStatus()
  }

  return {
    start,
    stop,
    runOnce,
    runBookingEmailOnce,
    getStatus,
  }
}
