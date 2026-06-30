export type NavigationRoute = 
  | 'today'
  | 'board'
  | 'rooms'
  | 'booking-inbox'
  | 'front-desk'
  | 'reservations'
  | 'guests'
  | 'housekeeping'
  | 'tablet-housekeeping'
  | 'cashier'
  | 'rates'
  | 'channels'
  | 'growth-suite'
  | 'reports'
  | 'settings'
  | 'messaging'
  | 'internal-comms'
  | 'daily-summary'
  | 'guest-communications'
  | 'night-audit'
  | 'revenue-analytics'
  | 'predictive-analytics'
  | 'system-status'
  | 'user-management'
  | 'data-backup'
  | 'ops-chat'
  | 'ops-approvals'
  | 'ops-tasks'
  | 'ops-intelligence'
  | 'ops-settings'

export interface NavigationState {
  currentRoute: NavigationRoute
  requestedPath: string | null
  isKnownRoute: boolean
  navigate: (route: NavigationRoute) => void
}
