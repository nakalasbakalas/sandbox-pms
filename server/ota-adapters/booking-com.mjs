import { PmsValidationError, stayDates } from '../pms-domain.mjs'

const BOOKING_COM_SELECTORS = {
  loginEmail: 'TODO: stable Booking.com email input selector',
  loginPassword: 'TODO: stable Booking.com password input selector',
  twoFactorChallenge: 'TODO: stable Booking.com 2FA challenge selector',
  captchaChallenge: 'TODO: stable Booking.com CAPTCHA challenge selector',
  ratesCalendar: 'TODO: stable Booking.com rates calendar selector',
  availabilityCalendar: 'TODO: stable Booking.com availability calendar selector',
}

function normalizeString(value) {
  const text = String(value || '').trim()
  return text || null
}

function redactedSensitiveText(value) {
  return String(value || '')
    .replace(/\b(password|passcode|secret|token|api[_ -]?key|credential|session)\s*[:=]\s*("[^"]*"|'[^']*'|\S+)/gi, '$1=[REDACTED]')
    .replace(/\b(sk-[A-Za-z0-9_-]{8,})\b/g, '[REDACTED_API_KEY]')
}

function envFlag(env, name) {
  return String(env?.[name] || '').trim().toLowerCase() === 'true'
}

function nowIso(options = {}) {
  return (options.now ? new Date(options.now) : new Date()).toISOString()
}

function bookingUsername(env = process.env) {
  return normalizeString(env.BOOKING_USERNAME || env.BOOKING_COM_USERNAME)
}

function bookingPassword(env = process.env) {
  return normalizeString(env.BOOKING_PASSWORD || env.BOOKING_COM_PASSWORD)
}

export function bookingComCredentialsConfigured(env = process.env) {
  return Boolean(bookingUsername(env) && bookingPassword(env))
}

function forcedHumanReason(env = process.env) {
  const reason = normalizeString(env.BOOKING_FORCE_HUMAN_CHALLENGE || env.BOOKING_COM_AUTH_CHALLENGE)?.toUpperCase()
  return ['2FA', 'CAPTCHA', 'PASSWORD_EXPIRED', 'LOCKED', 'UNKNOWN'].includes(reason) ? reason : null
}

function validateDateRange(input) {
  if (!input.dateStart || !input.dateEnd) {
    throw new PmsValidationError('Booking.com adapter requires dateStart and dateEnd.', 400)
  }
  const dates = stayDates(input.dateStart, input.dateEnd)
  if (dates.length === 0 && input.dateStart !== input.dateEnd) {
    throw new PmsValidationError('Booking.com adapter date range is invalid.', 400)
  }
  return dates.length > 0 ? dates : [input.dateStart]
}

function validateRoomType(input) {
  const roomType = normalizeString(input.roomType)
  if (!roomType) throw new PmsValidationError('Booking.com adapter requires roomType.', 400)
  return roomType
}

function validateTaskId(input) {
  const taskId = normalizeString(input.taskId)
  if (!taskId) throw new PmsValidationError('Booking.com adapter requires taskId.', 400)
  return taskId
}

function validateMessage(input, label = 'message') {
  const message = normalizeString(input.message)
  if (!message) throw new PmsValidationError(`Booking.com adapter requires ${label}.`, 400)
  return redactedSensitiveText(message)
}

function messagePreview(message) {
  const text = redactedSensitiveText(message).replace(/\s+/g, ' ').trim()
  return text.length > 120 ? `${text.slice(0, 117)}...` : text
}

function proof(taskId, kind, options = {}) {
  return {
    kind,
    storageUrl: `mock://ota/booking/${encodeURIComponent(taskId)}/${kind}`,
    capturedAt: nowIso(options),
    redactionStatus: 'SAFE',
  }
}

function dryRunEnabled(input) {
  return input.dryRun !== false
}

function assertDryRunOnly(operation, dryRun) {
  if (dryRun) return
  throw new PmsValidationError(`${operation} real Booking.com browser writes are not implemented. Keep OTA_DRY_RUN=true until selectors are verified.`, 409)
}

function bookingComAuthState(env) {
  const challenge = forcedHumanReason(env)
  if (challenge) {
    return {
      authenticated: false,
      requiresHuman: true,
      reason: challenge,
      message: `Booking.com requires human ${challenge} handling. No bypass attempted.`,
    }
  }

  if (!bookingComCredentialsConfigured(env)) {
    return {
      authenticated: false,
      requiresHuman: true,
      reason: 'UNKNOWN',
      message: 'Booking.com credentials are not configured in the server environment.',
    }
  }

  return {
    authenticated: true,
    requiresHuman: false,
    message: 'Booking.com dry-run adapter is ready. Real browser selectors are still gated.',
  }
}

async function loadPlaywrightForFutureRealRun(env) {
  if (!envFlag(env, 'OTA_ENABLE_REAL_BROWSER_WRITES')) return null
  const playwright = await import('playwright')
  return playwright.chromium
}

export function createBookingComAdapter(options = {}) {
  const env = options.env || process.env

  return {
    platform: 'booking',

    async healthCheck() {
      const auth = bookingComAuthState(env)
      return {
        platform: 'booking',
        ok: auth.authenticated,
        authenticated: auth.authenticated,
        requiresHuman: auth.requiresHuman,
        message: auth.message,
        checkedAt: nowIso(options),
        selectors: {
          status: 'skeleton',
          names: Object.keys(BOOKING_COM_SELECTORS),
        },
      }
    },

    async ensureAuthenticated() {
      await loadPlaywrightForFutureRealRun(env)
      return bookingComAuthState(env)
    },

    async readReservations(input) {
      validateDateRange(input)
      return {
        reservations: [],
        scannedAt: nowIso(options),
      }
    },

    async readGuestMessages() {
      return {
        messages: [],
        scannedAt: nowIso(options),
      }
    },

    async draftGuestReply(input) {
      const taskId = validateTaskId(input)
      const message = validateMessage(input, 'draft reply instructions')
      return {
        changed: false,
        dryRun: true,
        draft: {
          platform: 'booking',
          messagePreview: messagePreview(message),
        },
        proofScreenshots: [proof(taskId, 'trace', options)],
        summary: 'Dry run: drafted a Booking.com guest reply. No OTA message was sent.',
      }
    },

    async sendGuestReply(input) {
      const taskId = validateTaskId(input)
      const message = validateMessage(input, 'approved guest reply text')
      const dryRun = dryRunEnabled(input, env)
      assertDryRunOnly('SEND_GUEST_REPLY', dryRun)
      return {
        changed: false,
        dryRun: true,
        before: { platform: 'booking', messageComposer: 'not-opened-in-dry-run' },
        after: { platform: 'booking', plannedMessagePreview: messagePreview(message), sent: false },
        proofScreenshots: [proof(taskId, 'before', options), proof(taskId, 'after', options)],
        summary: 'Dry run: would send a Booking.com guest reply after approval. No OTA message was sent.',
      }
    },

    async readRates(input) {
      const roomType = validateRoomType(input)
      const dates = validateDateRange(input)
      return {
        rates: dates.map((stayDate) => ({
          roomType,
          stayDate,
          amount: Number(input.rate?.amount || 0),
          currency: input.rate?.currency || 'THB',
        })),
        scannedAt: nowIso(options),
      }
    },

    async updateRate(input) {
      const taskId = validateTaskId(input)
      const roomType = validateRoomType(input)
      const dates = validateDateRange(input)
      const amount = Number(input.amount ?? input.rate?.amount)
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new PmsValidationError('Booking.com adapter requires a positive rate amount.', 400)
      }
      const dryRun = dryRunEnabled(input, env)
      assertDryRunOnly('UPDATE_RATE', dryRun)

      return {
        changed: false,
        dryRun: true,
        before: { platform: 'booking', roomType, dates, currentRate: null },
        after: { platform: 'booking', roomType, dates, plannedRate: amount, currency: input.currency || input.rate?.currency || 'THB' },
        proofScreenshots: [proof(taskId, 'before', options), proof(taskId, 'after', options)],
        summary: `Dry run: would update Booking.com ${roomType} to ${amount.toLocaleString()} ${input.currency || input.rate?.currency || 'THB'} for ${input.dateStart} to ${input.dateEnd}.`,
      }
    },

    async readAvailability(input) {
      const roomType = validateRoomType(input)
      const dates = validateDateRange(input)
      return {
        availability: dates.map((stayDate) => ({
          roomType,
          stayDate,
          roomsAvailable: Number(input.availability?.rooms || 0),
          status: input.availability?.status || 'unknown',
        })),
        scannedAt: nowIso(options),
      }
    },

    async updateAvailability(input) {
      const taskId = validateTaskId(input)
      const roomType = validateRoomType(input)
      const dates = validateDateRange(input)
      const dryRun = dryRunEnabled(input, env)
      assertDryRunOnly('UPDATE_AVAILABILITY', dryRun)

      return {
        changed: false,
        dryRun: true,
        before: { platform: 'booking', roomType, dates, availability: null },
        after: { platform: 'booking', roomType, dates, plannedAvailability: input.availability || { rooms: input.rooms ?? null, status: input.status ?? null } },
        proofScreenshots: [proof(taskId, 'before', options), proof(taskId, 'after', options)],
        summary: `Dry run: would update Booking.com availability for ${roomType} from ${input.dateStart} to ${input.dateEnd}.`,
      }
    },

    async closeRoom(input) {
      return this.updateAvailability({ ...input, availability: { rooms: 0, status: 'closed' }, status: 'closed' })
    },

    async openRoom(input) {
      return this.updateAvailability({ ...input, availability: { rooms: input.rooms ?? null, status: 'open' }, status: 'open' })
    },

    async updateDescription(input) {
      const taskId = validateTaskId(input)
      const description = validateMessage(input, 'approved listing description')
      const dryRun = dryRunEnabled(input, env)
      assertDryRunOnly('UPDATE_DESCRIPTION', dryRun)
      return {
        changed: false,
        dryRun: true,
        before: { platform: 'booking', description: 'not-read-in-dry-run' },
        after: { platform: 'booking', plannedDescriptionPreview: messagePreview(description), changed: false },
        proofScreenshots: [proof(taskId, 'before', options), proof(taskId, 'after', options)],
        summary: 'Dry run: would update the Booking.com listing description after owner approval.',
      }
    },

    async takeProofScreenshot(input) {
      return proof(validateTaskId(input), input.kind || 'trace', options)
    },
  }
}

export async function executeBookingComTask(payload, options = {}) {
  const adapter = createBookingComAdapter(options)
  const auth = await adapter.ensureAuthenticated()
  if (auth.requiresHuman || !auth.authenticated) {
    return {
      taskId: payload.taskId,
      status: 'NEEDS_HUMAN',
      summary: auth.message,
      proofScreenshots: [await adapter.takeProofScreenshot({ taskId: payload.taskId, kind: 'trace' })],
      errorCode: `NEEDS_HUMAN_${auth.reason || 'UNKNOWN'}`,
      errorMessage: auth.message,
      data: { platform: 'booking', reason: auth.reason || 'UNKNOWN' },
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
    throw new PmsValidationError('Booking.com adapter does not support this task type.', 400)
  }

  return {
    taskId: payload.taskId,
    status: 'SUCCEEDED',
    summary: result.summary || `Booking.com ${payload.taskType} completed in dry-run mode.`,
    proofScreenshots: result.proofScreenshots || [],
    data: {
      platform: 'booking',
      dryRun: result.dryRun !== false,
      result,
    },
  }
}
