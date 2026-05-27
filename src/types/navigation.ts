export type NavigationRoute = 
  | 'today'
  | 'board'
  | 'rooms'
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

export interface NavigationState {
  currentRoute: NavigationRoute
  navigate: (route: NavigationRoute) => void
}
