export type NavigationRoute = 
  | 'board'
  | 'front-desk'
  | 'reservations'
  | 'guests'
  | 'housekeeping'
  | 'cashier'
  | 'rates'
  | 'channels'
  | 'reports'
  | 'settings'
  | 'messaging'
  | 'internal-comms'
  | 'daily-summary'

export interface NavigationState {
  currentRoute: NavigationRoute
  navigate: (route: NavigationRoute) => void
}
