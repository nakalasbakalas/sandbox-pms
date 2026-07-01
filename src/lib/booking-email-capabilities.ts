export interface BookingEmailCapabilityInput {
  serverApiEnabled: boolean
  apiAvailable: boolean
  mailboxConfigured: boolean
}

export function resolveBookingEmailCapabilities(input: BookingEmailCapabilityInput) {
  const backendAvailable = Boolean(input.serverApiEnabled && input.apiAvailable)
  const mailboxConfigured = Boolean(input.mailboxConfigured)

  return {
    backendAvailable,
    canApplyEvents: backendAvailable,
    canSyncMailbox: backendAvailable && mailboxConfigured,
    bannerTitle: !backendAvailable
      ? 'Booking-email backend connection needed'
      : mailboxConfigured
        ? null
        : 'Mailbox sync credentials needed',
  }
}
