export const ROLE_PERMISSIONS = {
  ADMIN: [
    'view:board',
    'view:reservations',
    'view:guests',
    'view:reports',
    'view:settings',
    'view:cashier',
    'view:housekeeping',
    'view:rates',
    'view:channels',
    'view:analytics',
    'view:night-audit',
    'view:messaging',
    'create:reservation',
    'edit:reservation',
    'cancel:reservation',
    'check-in:guest',
    'check-out:guest',
    'edit:room-status',
    'post:charges',
    'process:payment',
    'refund:payment',
    'run:night-audit',
    'edit:settings',
    'manage:users',
    'view:financial-reports',
    'edit:inventory',
    'manage:channels',
  ],
  MANAGER: [
    'view:board',
    'view:reservations',
    'view:guests',
    'view:reports',
    'view:cashier',
    'view:housekeeping',
    'view:rates',
    'view:channels',
    'view:analytics',
    'view:night-audit',
    'view:messaging',
    'create:reservation',
    'edit:reservation',
    'cancel:reservation',
    'check-in:guest',
    'check-out:guest',
    'edit:room-status',
    'post:charges',
    'process:payment',
    'run:night-audit',
    'view:financial-reports',
  ],
  FRONT_DESK: [
    'view:board',
    'view:reservations',
    'view:guests',
    'view:cashier',
    'view:housekeeping',
    'view:messaging',
    'create:reservation',
    'edit:reservation',
    'check-in:guest',
    'check-out:guest',
    'edit:room-status',
    'post:charges',
    'process:payment',
  ],
  HOUSEKEEPING: [
    'view:board',
    'view:housekeeping',
    'view:messaging',
    'edit:room-status',
  ],
  CASHIER: [
    'view:board',
    'view:reservations',
    'view:guests',
    'view:cashier',
    'view:reports',
    'view:messaging',
    'post:charges',
    'process:payment',
    'view:financial-reports',
  ],
  CAFE_STAFF: [
    'view:cashier',
    'post:charges',
  ],
}

const ROUTE_PERMISSIONS = {
  today: ['view:board', 'create:reservation', 'view:housekeeping'],
  board: ['view:board'],
  rooms: ['view:board', 'view:housekeeping'],
  'front-desk': ['view:board', 'check-in:guest', 'check-out:guest'],
  reservations: ['view:reservations'],
  guests: ['view:guests'],
  housekeeping: ['view:housekeeping'],
  cashier: ['view:cashier'],
  reports: ['view:reports'],
  settings: ['view:settings'],
  'night-audit': ['view:night-audit'],
  'revenue-analytics': ['view:analytics'],
  'predictive-analytics': ['view:analytics'],
  'user-management': ['manage:users'],
}

export function normalizeRole(role) {
  return String(role || '').toUpperCase().replaceAll('-', '_')
}

export function canPerformAction(user, permission) {
  if (!user?.role) return false
  return Boolean(ROLE_PERMISSIONS[normalizeRole(user.role)]?.includes(permission))
}

export function canViewRoute(user, route) {
  const permissions = ROUTE_PERMISSIONS[route]
  if (!permissions) return true
  return permissions.some((permission) => canPerformAction(user, permission))
}

export class AuthorizationError extends Error {
  constructor(message = 'You do not have permission to perform this action.') {
    super(message)
    this.name = 'AuthorizationError'
    this.statusCode = 403
  }
}

export function requirePermission(user, permission) {
  if (!canPerformAction(user, permission)) {
    throw new AuthorizationError()
  }
}
