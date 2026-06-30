import type { User, UserRole } from '@/types/auth'
import type { OnboardingState } from '@/types/onboarding'
import { SERVER_AUTH_ENABLED, normalizeAuthEmail } from '@/lib/auth-mode'

type ServerUser = {
  id: string
  email?: string | null
  username: string
  role: string
  displayName: string
  active?: boolean
  createdAt?: string | null
}

export type ServerSetupStatus = {
  needsSetup: boolean
  hasProperty: boolean
  hasUsers: boolean
  propertyName?: string | null
  setupTokenRequired?: boolean
}

function mapRole(role: string): UserRole {
  const normalized = role.toUpperCase()
  if (normalized === 'ADMIN') return 'admin'
  if (normalized === 'MANAGER') return 'manager'
  if (normalized === 'HOUSEKEEPING') return 'housekeeping'
  if (normalized === 'CASHIER') return 'cashier'
  return 'front-desk'
}

function mapUser(user: ServerUser): User {
  const email = user.email ? normalizeAuthEmail(user.email) : null
  const username = normalizeAuthEmail(user.username || user.email)
  return {
    id: user.id,
    email,
    username,
    role: mapRole(user.role),
    displayName: user.displayName,
    active: user.active,
    createdAt: user.createdAt || '',
  }
}

async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...options,
    credentials: 'same-origin',
    headers: {
      'content-type': 'application/json',
      ...(options.headers || {}),
    },
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(payload?.error || 'Request failed.')
  }
  return payload as T
}

export function isServerAuthEnabled() {
  return SERVER_AUTH_ENABLED
}

export function mapServerUser(user: ServerUser): User {
  return mapUser(user)
}

export async function serverLogin(identity: string, password: string): Promise<{ user: User }> {
  const payload = await apiRequest<{ ok: true; user: ServerUser }>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ identity: normalizeAuthEmail(identity), password }),
  })
  return { user: mapUser(payload.user) }
}

export async function serverMe(): Promise<User> {
  const payload = await apiRequest<{ ok: true; user: ServerUser }>('/api/auth/me')
  return mapUser(payload.user)
}

export async function serverLogout() {
  await apiRequest('/api/auth/logout', {
    method: 'POST',
  }).catch(() => undefined)
}

export async function getServerSetupStatus(): Promise<ServerSetupStatus> {
  if (!SERVER_AUTH_ENABLED) {
    return { needsSetup: false, hasProperty: true, hasUsers: true }
  }

  const payload = await apiRequest<{ ok: true; data: ServerSetupStatus }>('/api/setup/status')
  return payload.data
}

export async function completeServerSetup(data: OnboardingState['data'], setupToken?: string): Promise<void> {
  await apiRequest('/api/setup/complete', {
    method: 'POST',
    headers: setupToken ? { 'x-setup-token': setupToken } : undefined,
    body: JSON.stringify(data),
  })
}

export type ServerUserCreateInput = {
  username?: string
  email?: string | null
  password: string
  displayName?: string
  firstName?: string
  lastName?: string
  role: string
  active?: boolean
}

export type ServerUserUpdateInput = Partial<Omit<ServerUserCreateInput, 'password'>> & {
  password?: string
}

export async function listServerUsers(): Promise<User[]> {
  const payload = await apiRequest<{ ok: true; data: ServerUser[] }>('/api/users')
  return payload.data.map(mapUser)
}

export async function createServerUser(input: ServerUserCreateInput): Promise<User> {
  const payload = await apiRequest<{ ok: true; data: ServerUser }>('/api/users', {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return mapUser(payload.data)
}

export async function updateServerUser(userId: string, input: ServerUserUpdateInput): Promise<User> {
  const payload = await apiRequest<{ ok: true; data: ServerUser }>(`/api/users/${encodeURIComponent(userId)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
  return mapUser(payload.data)
}

export async function deactivateServerUser(userId: string): Promise<User> {
  const payload = await apiRequest<{ ok: true; data: ServerUser }>(`/api/users/${encodeURIComponent(userId)}`, {
    method: 'DELETE',
  })
  return mapUser(payload.data)
}
