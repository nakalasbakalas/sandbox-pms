import type { User, UserRole } from '@/types/auth'
import { SERVER_AUTH_ENABLED, normalizeAuthEmail } from '@/lib/auth-mode'

type ServerUser = {
  id: string
  email: string
  role: string
  displayName: string
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
  const email = normalizeAuthEmail(user.email)
  return {
    id: user.id,
    email,
    username: email,
    role: mapRole(user.role),
    displayName: user.displayName,
    createdAt: new Date().toISOString(),
  }
}

async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...options,
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

export async function serverLogin(email: string, password: string): Promise<{ user: User; token: string }> {
  const payload = await apiRequest<{ ok: true; user: ServerUser; token: string }>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: normalizeAuthEmail(email), password }),
  })
  return { user: mapUser(payload.user), token: payload.token }
}

export async function serverMe(token: string): Promise<User> {
  const payload = await apiRequest<{ ok: true; user: ServerUser }>('/api/auth/me', {
    headers: { authorization: `Bearer ${token}` },
  })
  return mapUser(payload.user)
}

export async function serverLogout(token?: string) {
  await apiRequest('/api/auth/logout', {
    method: 'POST',
    headers: token ? { authorization: `Bearer ${token}` } : undefined,
  }).catch(() => undefined)
}
