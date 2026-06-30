export type UserRole = 'admin' | 'manager' | 'front-desk' | 'housekeeping' | 'cashier'

export interface User {
  id: string
  email?: string | null
  role: UserRole
  displayName: string
  createdAt: string
  username?: string
  active?: boolean
}

export interface AuthState {
  user: User | null
  isAuthenticated: boolean
}

export type Permission =
  | 'view:board'
  | 'view:reservations'
  | 'view:guests'
  | 'view:reports'
  | 'view:settings'
  | 'view:cashier'
  | 'view:housekeeping'
  | 'view:rates'
  | 'view:channels'
  | 'view:analytics'
  | 'view:night-audit'
  | 'view:messaging'
  | 'create:reservation'
  | 'edit:reservation'
  | 'cancel:reservation'
  | 'check-in:guest'
  | 'check-out:guest'
  | 'override:check-in'
  | 'override:check-out'
  | 'edit:rates'
  | 'edit:room-status'
  | 'post:charges'
  | 'process:payment'
  | 'refund:payment'
  | 'run:night-audit'
  | 'edit:settings'
  | 'manage:users'
  | 'view:financial-reports'
  | 'edit:inventory'
  | 'manage:channels'
  | 'send:guest-messages'
  | 'send:staff-messages'
  | 'view:ops'
  | 'create:ops-task'
  | 'approve:ops-task'
  | 'manage:ops-settings'

export const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  admin: [
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
    'override:check-in',
    'override:check-out',
    'edit:rates',
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
    'send:guest-messages',
    'send:staff-messages',
    'view:ops',
    'create:ops-task',
    'approve:ops-task',
    'manage:ops-settings',
  ],
  manager: [
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
    'override:check-in',
    'override:check-out',
    'edit:rates',
    'edit:room-status',
    'post:charges',
    'process:payment',
    'run:night-audit',
    'view:financial-reports',
    'send:guest-messages',
    'send:staff-messages',
    'view:ops',
    'create:ops-task',
    'approve:ops-task',
  ],
  'front-desk': [
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
    'send:guest-messages',
    'send:staff-messages',
    'view:ops',
    'create:ops-task',
  ],
  housekeeping: [
    'view:board',
    'view:housekeeping',
    'view:messaging',
    'edit:room-status',
    'send:staff-messages',
    'view:ops',
  ],
  cashier: [
    'view:board',
    'view:reservations',
    'view:guests',
    'view:cashier',
    'view:reports',
    'view:messaging',
    'post:charges',
    'process:payment',
    'view:financial-reports',
    'send:staff-messages',
    'view:ops',
  ],
}

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Administrator',
  manager: 'Manager',
  'front-desk': 'Front Desk',
  housekeeping: 'Housekeeping',
  cashier: 'Cashier',
}
