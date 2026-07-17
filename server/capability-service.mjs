import { bookingEmailGmailCredentialStatus } from './pms-service.mjs'
import { envEnabled } from './setup-permission.mjs'

function capability(status, evidence, options = {}) {
  return {
    status,
    evidence,
    writeMode: options.writeMode || 'disabled',
    providerProof: options.providerProof === true,
  }
}

export function getSystemCapabilities(env = process.env) {
  const gmail = bookingEmailGmailCredentialStatus(env)
  const directBookingEnabled = envEnabled(env.DIRECT_BOOKING_ENABLED)
  const accountingEnabled = envEnabled(env.ACCOUNTING_V2_ENABLED)
  const otaLiveWritesEnabled = envEnabled(env.OTA_LIVE_WRITES_ENABLED)
  const sseEnabled = String(env.SSE_ENABLED ?? 'true').toLowerCase() !== 'false'

  return {
    sourceOfTruth: 'server',
    generatedAt: new Date().toISOString(),
    operations: {
      today: capability('available', 'PostgreSQL-backed Today summary', { writeMode: 'read-only' }),
      reservations: capability('available', 'Authenticated PMS reservation service', { writeMode: 'controlled' }),
      frontDesk: capability('available', 'Authenticated board and stay lifecycle services', { writeMode: 'controlled' }),
      housekeeping: capability('available', 'Room status, tasks, assignments, issues, and histories persist in PostgreSQL', { writeMode: 'controlled' }),
      rates: capability('available', 'PostgreSQL-backed rate rules, calendars, restrictions, and effective-rate queries', { writeMode: 'controlled' }),
      nightAudit: capability('available', 'Idempotent backend business-date close with blockers and exact-satang evidence', { writeMode: 'controlled' }),
      messaging: capability('partial', 'Hotel Ops notifications persist; general guest messaging remains provider-pending', { writeMode: 'review-gated' }),
      realtime: capability(sseEnabled ? 'available' : 'disabled', sseEnabled ? 'Authenticated PostgreSQL-backed SSE with bounded catch-up' : 'SSE_ENABLED is off', { writeMode: 'read-only' }),
    },
    finance: {
      accountingV2: capability(accountingEnabled ? 'enabled' : 'disabled', accountingEnabled ? 'ACCOUNTING_V2_ENABLED is active' : 'ACCOUNTING_V2_ENABLED is off', { writeMode: accountingEnabled ? 'controlled' : 'disabled' }),
      onlinePayments: capability('disabled', 'No payment gateway is enabled'),
    },
    integrations: {
      bookingEmail: capability(gmail.configured ? 'configured' : 'provider-pending', gmail.configured ? 'Backend Gmail OAuth credential path is configured' : 'Backend Gmail OAuth credentials are missing', { writeMode: 'review-gated', providerProof: false }),
      directBooking: capability(directBookingEnabled ? 'enabled' : 'disabled', directBookingEnabled ? 'DIRECT_BOOKING_ENABLED is active' : 'DIRECT_BOOKING_ENABLED is off', { writeMode: directBookingEnabled ? 'controlled' : 'disabled' }),
      ota: capability(otaLiveWritesEnabled ? 'enabled-unproven' : 'dry-run', otaLiveWritesEnabled ? 'OTA live-write flag is active; provider proof is still required' : 'OTA_LIVE_WRITES_ENABLED is off', { writeMode: otaLiveWritesEnabled ? 'controlled' : 'dry-run', providerProof: false }),
      ical: capability('manual', 'Hosted iCal date-block feeds only', { writeMode: 'review-gated', providerProof: false }),
    },
  }
}
