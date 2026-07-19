import { AuthorizationError, canPerformAction } from './rbac.mjs'

const CASHIER_EVENT_AGGREGATES = new Set(['charge', 'folio', 'payment', 'reservation'])

export function requireOperationalEventPermission(actor) {
  if (canPerformAction(actor, 'view:board') || canPerformAction(actor, 'view:cashier')) return
  throw new AuthorizationError('Operational event access requires board or cashier permission.')
}

export function canReadOperationalEvent(actor, event) {
  if (canPerformAction(actor, 'view:board')) return true
  if (!canPerformAction(actor, 'view:cashier')) return false
  return CASHIER_EVENT_AGGREGATES.has(String(event?.aggregateType || '').toLowerCase())
}
