import { AuthorizationError, canPerformAction } from './rbac.mjs'

const AGGREGATE_PERMISSIONS = new Map([
  ['reservation', ['view:board', 'view:reservations', 'view:cashier', 'view:guests']],
  ['room', ['view:board']],
  ['guest', ['view:guests']],
  ['charge', ['view:cashier']],
  ['folio', ['view:cashier']],
  ['payment', ['view:cashier']],
  ['housekeepingtask', ['view:housekeeping']],
  ['housekeepingissue', ['view:housekeeping']],
  ['channel', ['view:channels']],
  ['channelmapping', ['view:channels']],
  ['raterule', ['view:rates']],
  ['ratecalendar', ['view:rates']],
  ['property', ['view:settings']],
  ['user', ['manage:users']],
  ['message', ['view:messaging']],
  ['messagetemplate', ['view:messaging']],
  ['nightauditrun', ['view:night-audit']],
  ['inventoryhold', ['view:reservations']],
  ['externalproviderevent', ['view:ops']],
  ['autonomypolicy', ['view:ops']],
  ['agentdecision', ['view:ops']],
])

export function requireOperationalEventPermission(actor) {
  if (
    canPerformAction(actor, 'view:board')
    || canPerformAction(actor, 'view:cashier')
    || canPerformAction(actor, 'view:guests')
  ) return
  throw new AuthorizationError('Operational event access requires board, cashier, or guest-directory permission.')
}

export function canReadOperationalEvent(actor, event) {
  const aggregateType = String(event?.aggregateType || '').toLowerCase()
  const permissions = AGGREGATE_PERMISSIONS.get(aggregateType)
  return Boolean(permissions?.some((permission) => canPerformAction(actor, permission)))
}
