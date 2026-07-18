function routePattern(path) {
  const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`^${escaped.replace(/\\\{[^/]+?\\\}/g, '[^/]+')}$`)
}

function route(path, methods, options = {}) {
  return {
    path,
    pattern: routePattern(path),
    methods,
    tag: options.tag || 'PMS',
    summary: options.summary || `${methods.join('/')} ${path}`,
    parameters: options.parameters || [],
    public: options.public === true,
    internal: options.internal === true,
  }
}

const optionalIdempotencyKeyParameter = {
  name: 'x-idempotency-key',
  in: 'header',
  required: false,
  description: 'Optional retry key. Reuse the same value when retrying the same reservation mutation after an uncertain response.',
  schema: { type: 'string', maxLength: 200 },
}

const requiredIdempotencyKeyParameter = {
  ...optionalIdempotencyKeyParameter,
  required: true,
  description: 'Required property-scoped retry key. Reuse the same value when retrying the same lifecycle command after an uncertain response.',
}

const optionalReservationVersionParameters = [
  {
    name: 'x-reservation-expected-updated-at',
    in: 'header',
    required: false,
    description: 'Optional ISO-8601 reservation update token. A stale token returns 409 instead of overwriting a later edit.',
    schema: { type: 'string', format: 'date-time' },
  },
  {
    name: 'x-reservation-expected-version',
    in: 'header',
    required: false,
    description: 'Compatibility alias for x-reservation-expected-updated-at.',
    schema: { type: 'string', format: 'date-time' },
  },
]

const optionalGuestVersionParameters = [
  {
    name: 'x-guest-expected-updated-at',
    in: 'header',
    required: false,
    description: 'Optional ISO-8601 guest update token. A stale token returns 409 instead of overwriting a later edit.',
    schema: { type: 'string', format: 'date-time' },
  },
  {
    name: 'x-guest-expected-version',
    in: 'header',
    required: false,
    description: 'Compatibility alias for x-guest-expected-updated-at.',
    schema: { type: 'string', format: 'date-time' },
  },
]

const API_ROUTE_CONTRACTS = [
  route('/api/health', ['GET'], { tag: 'System', summary: 'Service health', public: true }),
  route('/api/openapi.json', ['GET'], { tag: 'System', summary: 'Authenticated API contract' }),
  route('/api/system/capabilities', ['GET'], { tag: 'System', summary: 'Operational capability registry' }),
  route('/api/events', ['GET'], { tag: 'System', summary: 'Property-scoped operational event stream' }),
  route('/api/messages', ['GET', 'POST'], { tag: 'Messaging', summary: 'Property-scoped message drafts' }),
  route('/api/message-templates', ['GET', 'POST'], { tag: 'Messaging', summary: 'Property-scoped message templates' }),
  route('/api/public/v1/availability', ['GET'], { tag: 'Public Booking', public: true }),
  route('/api/public/v1/quotes', ['POST'], { tag: 'Public Booking', public: true }),
  route('/api/public/v1/holds', ['POST'], { tag: 'Public Booking', public: true }),
  route('/api/public/v1/bookings', ['POST'], { tag: 'Public Booking', public: true }),
  route('/api/rates/rules', ['GET', 'POST'], { tag: 'Rates' }),
  route('/api/rates/rules/{id}', ['PATCH'], { tag: 'Rates' }),
  route('/api/rates/calendar', ['GET', 'PUT'], { tag: 'Rates' }),
  route('/api/rates/effective', ['GET'], { tag: 'Rates' }),
  route('/api/rates/recommendations', ['POST'], { tag: 'Rates' }),
  route('/api/line/webhook', ['GET', 'POST'], { tag: 'Integrations', public: true }),
  route('/api/whatsapp/webhook', ['GET', 'POST'], { tag: 'Integrations', public: true }),
  route('/api/auth/login', ['POST'], { tag: 'Authentication', public: true }),
  route('/api/auth/logout', ['POST'], { tag: 'Authentication', public: true }),
  route('/api/auth/me', ['GET'], { tag: 'Authentication' }),
  route('/api/auth/can-view', ['GET'], { tag: 'Authentication' }),
  route('/api/setup/status', ['GET'], { tag: 'Setup', public: true }),
  route('/api/setup/complete', ['POST'], { tag: 'Setup', public: true }),
  route('/api/users', ['GET', 'POST'], { tag: 'Users' }),
  route('/api/users/{id}', ['PATCH', 'DELETE'], { tag: 'Users' }),
  route('/api/ops/commands', ['POST'], { tag: 'Hotel Ops' }),
  route('/api/ops/tasks', ['GET'], { tag: 'Hotel Ops' }),
  route('/api/ops/tasks/{id}', ['GET'], { tag: 'Hotel Ops' }),
  route('/api/ops/tasks/{id}/approve', ['POST'], { tag: 'Hotel Ops' }),
  route('/api/ops/tasks/{id}/deny', ['POST'], { tag: 'Hotel Ops' }),
  route('/api/ops/tasks/{id}/cancel', ['POST'], { tag: 'Hotel Ops' }),
  route('/api/ops/tasks/{id}/run', ['POST'], { tag: 'Hotel Ops' }),
  route('/api/ops/tasks/{id}/resolve-human', ['POST'], { tag: 'Hotel Ops' }),
  route('/api/ops/approvals', ['GET'], { tag: 'Hotel Ops' }),
  route('/api/ops/notifications', ['GET'], { tag: 'Hotel Ops' }),
  route('/api/ops/notifications/{id}/read', ['POST'], { tag: 'Hotel Ops' }),
  route('/api/ops/notifications/{id}/dismiss', ['POST'], { tag: 'Hotel Ops' }),
  route('/api/ops/intelligence/alerts', ['GET'], { tag: 'Hotel Ops' }),
  route('/api/ops/intelligence/scans', ['GET'], { tag: 'Hotel Ops' }),
  route('/api/ops/intelligence/alerts/{id}/approve-recommendation', ['POST'], { tag: 'Hotel Ops' }),
  route('/api/ops/intelligence/alerts/{id}/acknowledge', ['POST'], { tag: 'Hotel Ops' }),
  route('/api/ops/intelligence/alerts/{id}/resolve', ['POST'], { tag: 'Hotel Ops' }),
  route('/api/ops/emergency-stop', ['GET', 'POST'], { tag: 'Hotel Ops' }),
  route('/api/ops/ota/status', ['GET'], { tag: 'Hotel Ops' }),
  route('/api/ops/policy', ['GET'], { tag: 'Hotel Ops' }),
  route('/api/ops/scan/run', ['POST'], { tag: 'Hotel Ops' }),
  route('/api/ops/analyzers', ['POST'], { tag: 'Hotel Ops', summary: 'Run deterministic suggest-only operational analyzers' }),
  route('/api/internal/ops/worker/tasks', ['POST'], { tag: 'Internal', internal: true, public: true }),
  route('/api/today', ['GET'], { tag: 'Operations' }),
  route('/api/front-desk/board', ['GET'], {
    tag: 'Front Desk',
    summary: 'Property-scoped booking board with an optional bounded date window',
    parameters: [
      {
        name: 'from',
        in: 'query',
        required: false,
        description: 'Inclusive board window start. Must be supplied with to.',
        schema: { type: 'string', format: 'date' },
      },
      {
        name: 'to',
        in: 'query',
        required: false,
        description: 'Exclusive board window end, at most 93 days after from. Must be supplied with from.',
        schema: { type: 'string', format: 'date' },
      },
    ],
  }),
  route('/api/front-desk/walk-in', ['POST'], { tag: 'Front Desk' }),
  route('/api/booking-email/status', ['GET'], { tag: 'Booking Inbox' }),
  route('/api/booking-email/sync', ['POST'], { tag: 'Booking Inbox' }),
  route('/api/booking-email/events', ['GET'], { tag: 'Booking Inbox' }),
  route('/api/booking-email/events/{id}', ['GET'], { tag: 'Booking Inbox' }),
  route('/api/booking-email/events/{id}/approve', ['POST'], { tag: 'Booking Inbox' }),
  route('/api/booking-email/events/{id}/reject', ['POST'], { tag: 'Booking Inbox' }),
  route('/api/booking-email/events/{id}/reprocess', ['POST'], { tag: 'Booking Inbox' }),
  route('/api/booking-email/sources', ['GET', 'POST'], { tag: 'Booking Inbox' }),
  route('/api/booking-email/sources/{id}', ['PATCH'], { tag: 'Booking Inbox' }),
  route('/api/rooms', ['GET'], { tag: 'Rooms' }),
  route('/api/rooms/{id}/operational-status', ['POST'], { tag: 'Rooms' }),
  route('/api/channels/ical', ['GET'], { tag: 'Channels' }),
  route('/api/channels/ical/{provider}', ['POST', 'DELETE'], { tag: 'Channels' }),
  route('/api/channels/mappings', ['GET', 'POST'], { tag: 'Channels', summary: 'Property-scoped channel room mappings' }),
  route('/api/channels/mappings/{id}', ['PATCH', 'DELETE'], { tag: 'Channels', summary: 'Update or delete a channel room mapping' }),
  route('/api/settings/room-setup', ['GET'], { tag: 'Settings' }),
  route('/api/settings/property', ['GET', 'PATCH'], { tag: 'Settings' }),
  route('/api/settings/tax', ['PUT'], { tag: 'Settings' }),
  route('/api/settings/status', ['GET'], { tag: 'Settings' }),
  route('/api/settings/room-types', ['POST'], { tag: 'Settings' }),
  route('/api/settings/room-types/{id}', ['PATCH', 'DELETE'], { tag: 'Settings' }),
  route('/api/settings/rooms', ['POST'], { tag: 'Settings' }),
  route('/api/settings/rooms/{id}', ['PATCH', 'DELETE'], { tag: 'Settings' }),
  route('/api/reservations', ['GET', 'POST'], { tag: 'Reservations' }),
  route('/api/reservations/{id}', ['PATCH'], {
    tag: 'Reservations',
    summary: 'Update a property-scoped reservation; expectedUpdatedAt may be supplied for optimistic concurrency',
    parameters: [optionalIdempotencyKeyParameter, ...optionalReservationVersionParameters],
  }),
  route('/api/reservations/{id}/assign-room', ['POST'], {
    tag: 'Reservations',
    summary: 'Assign or move a reservation room',
    parameters: [optionalIdempotencyKeyParameter, ...optionalReservationVersionParameters],
  }),
  route('/api/reservations/{id}/check-in', ['POST'], {
    tag: 'Reservations',
    summary: 'Check in a property-scoped reservation with retry and stale-write protection',
    parameters: [requiredIdempotencyKeyParameter, ...optionalReservationVersionParameters],
  }),
  route('/api/reservations/{id}/check-out', ['POST'], {
    tag: 'Reservations',
    summary: 'Check out a property-scoped reservation with retry and stale-write protection',
    parameters: [requiredIdempotencyKeyParameter, ...optionalReservationVersionParameters],
  }),
  route('/api/reservations/{id}/guest', ['PATCH'], {
    tag: 'Reservations',
    summary: 'Update the guest attached to a property-scoped reservation',
    parameters: [optionalIdempotencyKeyParameter, ...optionalGuestVersionParameters],
  }),
  route('/api/reservations/{id}/cancel', ['POST'], {
    tag: 'Reservations',
    summary: 'Cancel a reservation with an operational reason',
    parameters: [optionalIdempotencyKeyParameter, ...optionalReservationVersionParameters],
  }),
  route('/api/reservations/{id}/no-show', ['POST'], {
    tag: 'Reservations',
    summary: 'Mark a reservation no-show with an operational reason',
    parameters: [optionalIdempotencyKeyParameter, ...optionalReservationVersionParameters],
  }),
  route('/api/housekeeping/rooms/{id}/status', ['POST'], { tag: 'Housekeeping' }),
  route('/api/housekeeping/tasks', ['GET', 'POST'], { tag: 'Housekeeping' }),
  route('/api/housekeeping/tasks/{id}/assign', ['POST'], { tag: 'Housekeeping' }),
  route('/api/housekeeping/tasks/{id}/status', ['POST'], { tag: 'Housekeeping' }),
  route('/api/housekeeping/issues', ['GET', 'POST'], { tag: 'Housekeeping' }),
  route('/api/housekeeping/issues/{id}/status', ['POST'], { tag: 'Housekeeping' }),
  route('/api/night-audit/runs', ['GET'], { tag: 'Night Audit' }),
  route('/api/night-audit/close', ['POST'], { tag: 'Night Audit' }),
  route('/api/accounting/v2/folios', ['POST'], { tag: 'Accounting V2' }),
  route('/api/accounting/v2/folios/{id}/balance', ['GET'], { tag: 'Accounting V2' }),
  route('/api/accounting/v2/charges', ['POST'], { tag: 'Accounting V2' }),
  route('/api/accounting/v2/charges/{id}/reverse', ['POST'], { tag: 'Accounting V2' }),
  route('/api/accounting/v2/payments', ['POST'], { tag: 'Accounting V2' }),
  route('/api/accounting/v2/payments/{id}/reverse', ['POST'], { tag: 'Accounting V2' }),
  route('/api/accounting/v2/cash-shifts', ['POST'], { tag: 'Accounting V2' }),
  route('/api/accounting/v2/cash-shifts/{id}/movements', ['POST'], { tag: 'Accounting V2' }),
  route('/api/accounting/v2/cash-shifts/{id}/close', ['POST'], { tag: 'Accounting V2' }),
  route('/api/accounting/v2/house-accounts', ['POST'], { tag: 'Accounting V2' }),
  route('/api/accounting/v2/receivables', ['POST'], { tag: 'Accounting V2' }),
  route('/api/accounting/v2/journals', ['POST'], { tag: 'Accounting V2' }),
  route('/api/accounting/v2/trial-balance', ['GET'], { tag: 'Accounting V2' }),
  route('/api/payments', ['POST'], { tag: 'Finance' }),
  route('/api/charges', ['POST'], { tag: 'Finance' }),
  route('/api/guests', ['GET', 'POST'], { tag: 'Guests' }),
  route('/api/guests/{id}', ['PATCH'], { tag: 'Guests' }),
]

export function listApiRouteContracts({ includeInternal = false } = {}) {
  return API_ROUTE_CONTRACTS
    .filter((contract) => includeInternal || !contract.internal)
    .map((contract) => ({
      path: contract.path,
      methods: [...contract.methods],
      tag: contract.tag,
      summary: contract.summary,
      parameters: contract.parameters.map((parameter) => ({ ...parameter })),
      public: contract.public,
      internal: contract.internal,
    }))
}

export function resolveApiRouteContract(pathname) {
  const contract = API_ROUTE_CONTRACTS.find((candidate) => candidate.pattern.test(pathname))
  if (!contract) return null
  return {
    path: contract.path,
    methods: [...contract.methods],
    allow: contract.methods.join(', '),
    tag: contract.tag,
    summary: contract.summary,
    parameters: contract.parameters.map((parameter) => ({ ...parameter })),
    public: contract.public,
    internal: contract.internal,
  }
}
