import { PmsValidationError, stayDates } from '../pms-domain.mjs'

export const OTA_PLATFORM_SKELETONS = Object.freeze({
  agoda: {
    label: 'Agoda',
    credentialEnv: ['AGODA_USERNAME', 'AGODA_PASSWORD'],
  },
  trip: {
    label: 'Trip.com',
    credentialEnv: ['TRIP_COM_USERNAME', 'TRIP_COM_PASSWORD'],
  },
  expedia: {
    label: 'Expedia',
    credentialEnv: ['EXPEDIA_USERNAME', 'EXPEDIA_PASSWORD'],
  },
})

function normalizeString(value) {
  const text = String(value || '').trim()
  return text || null
}

function redactedSensitiveText(value) {
  return String(value || '')
    .replace(/\b(password|passcode|secret|token|api[_ -]?key|credential|session)\s*[:=]\s*("[^"]*"|'[^']*'|\S+)/gi, '$1=[REDACTED]')
    .replace(/\b(sk-[A-Za-z0-9_-]{8,})\b/g, '[REDACTED_API_KEY]')
}

function nowIso(options = {}) {
  return (options.now ? new Date(options.now) : new Date()).toISOString()
}

function envFlag(env, name) {
  return String(env?.[name] || '').trim().toLowerCase() === 'true'
}

function labelFor(platform) {
  return OTA_PLATFORM_SKELETONS[platform]?.label || String(platform || 'OTA')
}

function credentialsConfigured(platform, env = process.env) {
  const config = OTA_PLATFORM_SKELETONS[platform]
  if (!config) return false
  return config.credentialEnv.every((key) => Boolean(normalizeString(env[key])))
}

function forcedHumanReason(platform, env = process.env) {
  const upperPlatform = String(platform || '').toUpperCase().replace(/[^A-Z0-9]/g, '_')
  const reason = normalizeString(env[`${upperPlatform}_FORCE_HUMAN_CHALLENGE`])?.toUpperCase()
  return ['2FA', 'CAPTCHA', 'PASSWORD_EXPIRED', 'LOCKED', 'UNKNOWN'].includes(reason) ? reason : null
}

function proof(platform, taskId, kind, options = {}) {
  return {
    kind,
    storageUrl: `mock://ota/${platform}/${encodeURIComponent(taskId)}/${kind}`,
    capturedAt: nowIso(options),
    redactionStatus: 'SAFE',
  }
}

function dryRunEnabled(input) {
  return input.dryRun !== false
}

function assertDryRunOnly(platform, dryRun) {
  if (dryRun) return
  throw new PmsValidationError(`${labelFor(platform)} real browser writes are not implemented. Keep OTA_DRY_RUN=true until credentials, selectors, and account-owner proof are verified.`, 409)
}

function validateTaskId(input, label) {
  const taskId = normalizeString(input.taskId)
  if (!taskId) throw new PmsValidationError(`${label} adapter requires taskId.`, 400)
  return taskId
}

function validateRoomType(input, label) {
  const roomType = normalizeString(input.roomType)
  if (!roomType) throw new PmsValidationError(`${label} adapter requires roomType.`, 400)
  return roomType
}

function validateDateRange(input, label) {
  if (!input.dateStart || !input.dateEnd) {
    throw new PmsValidationError(`${label} adapter requires dateStart and dateEnd.`, 400)
  }
  const dates = stayDates(input.dateStart, input.dateEnd)
  if (dates.length === 0 && input.dateStart !== input.dateEnd) {
    throw new PmsValidationError(`${label} adapter date range is invalid.`, 400)
  }
  return dates.length > 0 ? dates : [input.dateStart]
}

function validateMessage(input, label, fieldLabel = 'message') {
  const message = normalizeString(input.message)
  if (!message) throw new PmsValidationError(`${label} adapter requires ${fieldLabel}.`, 400)
  return redactedSensitiveText(message)
}

function messagePreview(message) {
  const text = redactedSensitiveText(message).replace(/\s+/g, ' ').trim()
  return text.length > 120 ? `${text.slice(0, 117)}...` : text
}

function authState(platform, env) {
  const label = labelFor(platform)
  const challenge = forcedHumanReason(platform, env)
  if (challenge) {
    return {
      authenticated: false,
      requiresHuman: true,
      reason: challenge,
      message: `${label} requires human ${challenge} handling. No bypass attempted.`,
    }
  }

  return {
    authenticated: credentialsConfigured(platform, env),
    requiresHuman: false,
    reason: credentialsConfigured(platform, env) ? null : 'CREDENTIALS_NOT_CONFIGURED',
    message: credentialsConfigured(platform, env)
      ? `${label} dry-run adapter skeleton is ready. Real browser selectors are still gated.`
      : `${label} dry-run adapter skeleton is installed, but server-side credentials are not configured.`,
  }
}

async function loadPlaywrightForFutureRealRun(env) {
  if (!envFlag(env, 'OTA_ENABLE_REAL_BROWSER_WRITES')) return null
  const playwright = await import('playwright')
  return playwright.chromium
}

function scenarioFailure(platform, payload, options = {}) {
  const label = labelFor(platform)
  const taskId = validateTaskId(payload, label)
  if (payload.mockScenario === 'selector_failure') {
    return {
      taskId,
      status: 'FAILED',
      summary: `${label} dry-run adapter could not find the expected selector.`,
      proofScreenshots: [proof(platform, taskId, 'error', options)],
      errorCode: 'MOCK_SELECTOR_FAILURE',
      errorMessage: 'Selector not found in dry-run platform skeleton.',
      data: {
        dryRun: payload.dryRun !== false,
        platform,
        taskType: payload.taskType,
      },
    }
  }
  if (payload.mockScenario === 'human_challenge') {
    return {
      taskId,
      status: 'NEEDS_HUMAN',
      summary: `${label} dry-run adapter requires human 2FA/CAPTCHA completion. No bypass attempted.`,
      proofScreenshots: [proof(platform, taskId, 'trace', options)],
      errorCode: 'NEEDS_HUMAN_CHALLENGE',
      errorMessage: '2FA/CAPTCHA requires authorized human action.',
      data: {
        dryRun: payload.dryRun !== false,
        platform,
        taskType: payload.taskType,
      },
    }
  }
  return null
}

export function otaPlatformSkeletonCredentialsConfigured(platform, env = process.env) {
  return credentialsConfigured(platform, env)
}

export function otaPlatformSkeletonStatuses({ env = process.env, signedWorkerConfigured = false } = {}) {
  return Object.entries(OTA_PLATFORM_SKELETONS).map(([platform, config]) => {
    const configured = credentialsConfigured(platform, env)
    return {
      platform,
      configured,
      status: configured ? 'adapter-dry-run-ready' : signedWorkerConfigured ? 'adapter-skeleton-credentials-needed' : 'adapter-skeleton-local-dry-run',
      message: configured
        ? `${config.label} adapter skeleton is available for signed dry-run tasks. Real browser writes remain disabled until selectors are verified.`
        : `${config.label} adapter skeleton is installed for dry-run tasks, but server-side credentials and Playwright selectors are not configured for real browser writes.`,
    }
  })
}

export function createOtaPlatformSkeletonAdapter(platform, options = {}) {
  if (!OTA_PLATFORM_SKELETONS[platform]) throw new PmsValidationError(`Unsupported OTA platform skeleton ${platform}.`, 400)
  const env = options.env || process.env
  const label = labelFor(platform)

  return {
    platform,

    async healthCheck() {
      const auth = authState(platform, env)
      return {
        platform,
        ok: true,
        configured: auth.authenticated,
        authenticated: auth.authenticated,
        requiresHuman: auth.requiresHuman,
        message: auth.message,
        checkedAt: nowIso(options),
        selectors: {
          status: 'skeleton',
          names: ['login', 'securityChallenge', 'reservations', 'ratesCalendar', 'availabilityCalendar', 'guestMessages'],
        },
      }
    },

    async ensureAuthenticated() {
      await loadPlaywrightForFutureRealRun(env)
      return authState(platform, env)
    },

    async readReservations(input) {
      validateDateRange(input, label)
      return {
        reservations: [],
        scannedAt: nowIso(options),
        summary: `Dry run: would read ${label} reservations for ${input.dateStart} to ${input.dateEnd}.`,
      }
    },

    async readGuestMessages() {
      return {
        messages: [],
        scannedAt: nowIso(options),
        summary: `Dry run: would read ${label} guest messages.`,
      }
    },

    async draftGuestReply(input) {
      const taskId = validateTaskId(input, label)
      const message = validateMessage(input, label, 'draft reply instructions')
      return {
        changed: false,
        dryRun: true,
        draft: { platform, messagePreview: messagePreview(message) },
        proofScreenshots: [proof(platform, taskId, 'trace', options)],
        summary: `Dry run: drafted a ${label} guest reply. No OTA message was sent.`,
      }
    },

    async sendGuestReply(input) {
      const taskId = validateTaskId(input, label)
      const message = validateMessage(input, label, 'approved guest reply text')
      const dryRun = dryRunEnabled(input)
      assertDryRunOnly(platform, dryRun)
      return {
        changed: false,
        dryRun: true,
        before: { platform, messageComposer: 'not-opened-in-dry-run' },
        after: { platform, plannedMessagePreview: messagePreview(message), sent: false },
        proofScreenshots: [proof(platform, taskId, 'before', options), proof(platform, taskId, 'after', options)],
        summary: `Dry run: would send a ${label} guest reply after approval. No OTA message was sent.`,
      }
    },

    async readRates(input) {
      const roomType = validateRoomType(input, label)
      const dates = validateDateRange(input, label)
      return {
        rates: dates.map((stayDate) => ({
          roomType,
          stayDate,
          amount: Number(input.rate?.amount || 0),
          currency: input.rate?.currency || 'THB',
        })),
        scannedAt: nowIso(options),
        summary: `Dry run: would read ${label} rates for ${roomType}.`,
      }
    },

    async updateRate(input) {
      const taskId = validateTaskId(input, label)
      const roomType = validateRoomType(input, label)
      const dates = validateDateRange(input, label)
      const amount = Number(input.amount ?? input.rate?.amount)
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new PmsValidationError(`${label} adapter requires a positive rate amount.`, 400)
      }
      const dryRun = dryRunEnabled(input)
      assertDryRunOnly(platform, dryRun)

      return {
        changed: false,
        dryRun: true,
        before: { platform, roomType, dates, currentRate: null },
        after: { platform, roomType, dates, plannedRate: amount, currency: input.currency || input.rate?.currency || 'THB' },
        proofScreenshots: [proof(platform, taskId, 'before', options), proof(platform, taskId, 'after', options)],
        summary: `Dry run: would update ${label} ${roomType} to ${amount.toLocaleString()} ${input.currency || input.rate?.currency || 'THB'} for ${input.dateStart} to ${input.dateEnd}.`,
      }
    },

    async readAvailability(input) {
      const roomType = validateRoomType(input, label)
      const dates = validateDateRange(input, label)
      return {
        availability: dates.map((stayDate) => ({
          roomType,
          stayDate,
          roomsAvailable: Number(input.availability?.rooms || 0),
          status: input.availability?.status || 'unknown',
        })),
        scannedAt: nowIso(options),
        summary: `Dry run: would read ${label} availability for ${roomType}.`,
      }
    },

    async updateAvailability(input) {
      const taskId = validateTaskId(input, label)
      const roomType = validateRoomType(input, label)
      const dates = validateDateRange(input, label)
      const dryRun = dryRunEnabled(input)
      assertDryRunOnly(platform, dryRun)

      return {
        changed: false,
        dryRun: true,
        before: { platform, roomType, dates, availability: null },
        after: { platform, roomType, dates, plannedAvailability: input.availability || { rooms: input.rooms ?? null, status: input.status ?? null } },
        proofScreenshots: [proof(platform, taskId, 'before', options), proof(platform, taskId, 'after', options)],
        summary: `Dry run: would update ${label} availability for ${roomType} from ${input.dateStart} to ${input.dateEnd}.`,
      }
    },

    async closeRoom(input) {
      return this.updateAvailability({ ...input, availability: { rooms: 0, status: 'closed' }, status: 'closed' })
    },

    async openRoom(input) {
      return this.updateAvailability({ ...input, availability: { rooms: input.rooms ?? null, status: 'open' }, status: 'open' })
    },

    async updateDescription(input) {
      const taskId = validateTaskId(input, label)
      const description = validateMessage(input, label, 'approved listing description')
      const dryRun = dryRunEnabled(input)
      assertDryRunOnly(platform, dryRun)
      return {
        changed: false,
        dryRun: true,
        before: { platform, description: 'not-read-in-dry-run' },
        after: { platform, plannedDescriptionPreview: messagePreview(description), changed: false },
        proofScreenshots: [proof(platform, taskId, 'before', options), proof(platform, taskId, 'after', options)],
        summary: `Dry run: would update the ${label} listing description after owner approval.`,
      }
    },

    async takeProofScreenshot(input) {
      return proof(platform, validateTaskId(input, label), input.kind || 'trace', options)
    },
  }
}

export async function executeOtaPlatformSkeletonTask(payload, options = {}) {
  const platform = normalizeString(payload.platform)?.toLowerCase()
  const adapter = createOtaPlatformSkeletonAdapter(platform, options)
  const scenario = scenarioFailure(platform, payload, options)
  if (scenario) return scenario

  const auth = await adapter.ensureAuthenticated()
  if (auth.requiresHuman) {
    return {
      taskId: payload.taskId,
      status: 'NEEDS_HUMAN',
      summary: auth.message,
      proofScreenshots: [await adapter.takeProofScreenshot({ taskId: payload.taskId, kind: 'trace' })],
      errorCode: `NEEDS_HUMAN_${auth.reason || 'UNKNOWN'}`,
      errorMessage: auth.message,
      data: { platform, reason: auth.reason || 'UNKNOWN' },
    }
  }

  const common = {
    taskId: payload.taskId,
    hotelId: payload.hotelId,
    roomType: payload.roomType,
    dateStart: payload.dateStart,
    dateEnd: payload.dateEnd,
    rate: payload.rate,
    availability: payload.availability,
    message: payload.message,
    dryRun: payload.dryRun !== false,
  }

  let result
  if (payload.taskType === 'READ_RESERVATIONS' || payload.taskType === 'SCAN_BOOKINGS') {
    result = await adapter.readReservations(common)
  } else if (payload.taskType === 'READ_GUEST_MESSAGES') {
    result = await adapter.readGuestMessages(common)
  } else if (payload.taskType === 'DRAFT_GUEST_REPLY') {
    result = await adapter.draftGuestReply(common)
  } else if (payload.taskType === 'SEND_GUEST_REPLY') {
    result = await adapter.sendGuestReply(common)
  } else if (payload.taskType === 'READ_RATES') {
    result = await adapter.readRates(common)
  } else if (payload.taskType === 'UPDATE_RATE') {
    result = await adapter.updateRate({
      ...common,
      amount: payload.rate?.amount,
      currency: payload.rate?.currency,
    })
  } else if (payload.taskType === 'READ_AVAILABILITY') {
    result = await adapter.readAvailability(common)
  } else if (payload.taskType === 'UPDATE_AVAILABILITY') {
    result = await adapter.updateAvailability(common)
  } else if (payload.taskType === 'CLOSE_ROOM') {
    result = await adapter.closeRoom(common)
  } else if (payload.taskType === 'OPEN_ROOM') {
    result = await adapter.openRoom(common)
  } else if (payload.taskType === 'UPDATE_DESCRIPTION') {
    result = await adapter.updateDescription(common)
  } else {
    throw new PmsValidationError(`${labelFor(platform)} adapter does not support this task type.`, 400)
  }

  return {
    taskId: payload.taskId,
    status: 'SUCCEEDED',
    summary: result.summary || `${labelFor(platform)} ${payload.taskType} completed in dry-run mode.`,
    proofScreenshots: result.proofScreenshots || [],
    data: {
      platform,
      dryRun: result.dryRun !== false,
      adapterMode: 'platform-skeleton',
      credentialsConfigured: credentialsConfigured(platform, options.env || process.env),
      result,
    },
  }
}
