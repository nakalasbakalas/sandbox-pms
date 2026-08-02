const DEFAULT_RECENCY_DAYS = 30

const APPROVED_PROVIDER_SENDERS = [
  'booking.com',
  'guest.booking.com',
  'agoda.com',
  'trip.com',
  'expedia.com',
  'priceline.com',
  'airbnb.com',
  'app.littlehotelier.com',
]

const APPROVED_PROVIDER_EXCLUDED_SENDERS = [
  'ebk.promo.hotelpartner@trip.com',
  'growth-product@agoda.com',
]

const APPROVED_PROVIDER_EXCLUDED_SUBJECTS = [
  'new sign-in to your account',
  'account security update',
  'weekly performance report',
  'performance report',
  'partner hub',
  'boost campaigns',
]

const APPROVED_PROVIDER_EXCLUDED_TERMS = [
  'two-factor authentication',
  'phishing',
  'market manager',
]

function quoted(value) {
  return `"${String(value || '').replace(/"/g, '\\"')}"`
}

export function approvedBookingEmailProviderQuery(options = {}) {
  const allPast = Boolean(options.allPast)
  const senderScope = `(${APPROVED_PROVIDER_SENDERS.map((sender) => `from:${sender}`).join(' OR ')})`
  const excludedSenders = APPROVED_PROVIDER_EXCLUDED_SENDERS.map((sender) => `-from:${sender}`)
  const excludedSubjects = APPROVED_PROVIDER_EXCLUDED_SUBJECTS.map((subject) => `-subject:${quoted(subject)}`)
  const excludedTerms = APPROVED_PROVIDER_EXCLUDED_TERMS.map((term) => `-${quoted(term)}`)
  const parts = [
    senderScope,
    '-in:spam',
    '-in:trash',
    ...excludedSenders,
    ...excludedSubjects,
    ...excludedTerms,
  ]
  if (!allPast) parts.push(`newer_than:${DEFAULT_RECENCY_DAYS}d`)
  return parts.join(' ')
}

export function primaryMailboxBookingEmailQuery(mailbox, options = {}) {
  const normalizedMailbox = String(mailbox || '').trim().toLowerCase()
  const parts = [
    `to:${normalizedMailbox}`,
    '-in:spam',
    '-in:trash',
  ]
  if (!options.allPast) parts.push(`newer_than:${DEFAULT_RECENCY_DAYS}d`)
  return parts.join(' ')
}
