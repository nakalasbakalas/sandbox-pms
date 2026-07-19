import { parseExternalEventEnvelope } from './contracts.mjs'

const TASK_BY_EVENT_TYPE = Object.freeze({
  NEW_BOOKING: 'SCAN_BOOKINGS',
  MODIFICATION: 'SCAN_BOOKINGS',
  CANCELLATION: 'SCAN_BOOKINGS',
  PAYMENT_NOTICE: 'REPORT_ACCOUNT_HEALTH',
  GUEST_MESSAGE: 'READ_GUEST_MESSAGES',
  RATE: 'READ_RATES',
  AVAILABILITY: 'READ_AVAILABILITY',
  RESTRICTION: 'READ_AVAILABILITY',
  PROVIDER_HEALTH: 'REPORT_ACCOUNT_HEALTH',
  UNKNOWN: 'GENERATE_RECOMMENDATION',
})

const EXPLANATION_BY_EVENT_TYPE = Object.freeze({
  NEW_BOOKING: 'Compare the normalized booking event with authoritative PMS reservations before staff action.',
  MODIFICATION: 'Compare the newer provider revision with the matched authoritative PMS reservation.',
  CANCELLATION: 'Verify the exact provider reference and source authority; do not cancel from shadow mode.',
  PAYMENT_NOTICE: 'Investigate the provider payment notice without treating it as cleared funds.',
  GUEST_MESSAGE: 'Read the linked guest-message record and prepare no outbound action from shadow mode.',
  RATE: 'Compare provider rate evidence with authoritative internal rate data.',
  AVAILABILITY: 'Compare provider availability evidence with authoritative PMS inventory.',
  RESTRICTION: 'Compare provider restriction evidence with authoritative PMS rate restrictions.',
  PROVIDER_HEALTH: 'Investigate provider health evidence and create no external action.',
  UNKNOWN: 'Classify the normalized event through deterministic review before any action.',
})

export function planShadowAction(eventInput) {
  const event = parseExternalEventEnvelope(eventInput)
  const taskType = TASK_BY_EVENT_TYPE[event.eventType]

  return Object.freeze({
    propertyId: event.propertyId,
    provider: event.provider,
    correlationId: event.correlationId,
    externalEventId: event.providerEventId,
    taskType,
    proposedMode: 'SHADOW',
    sourceTrust: event.sourceTrust,
    confidenceBasisPoints: event.eventType === 'UNKNOWN' ? 0 : 10_000,
    evidenceIds: [...event.evidenceIds],
    explanation: EXPLANATION_BY_EVENT_TYPE[event.eventType],
    proposedCommand: {
      taskType,
      provider: event.provider,
      providerEventId: event.providerEventId,
      eventVersion: event.eventVersion,
      correlationId: event.correlationId,
    },
    impact: {
      roomsAffected: 0,
      dateRange: null,
      currentRateSatang: null,
      proposedRateSatang: null,
      availableProof: [],
    },
    writesPerformed: false,
    providerCallsPerformed: false,
    approvalRequired: false,
  })
}
