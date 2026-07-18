export type AuthoritativeWorkflowIntent =
  | 'assignment'
  | 'cashier'
  | 'check-in'
  | 'check-out'
  | 'walk-in'

export type AuthoritativeWorkflowRoute = 'board' | 'cashier' | 'front-desk'

export interface AuthoritativeWorkflowQuery {
  workflow: AuthoritativeWorkflowIntent
  reservationId?: string
  folioId?: string
}

const VALID_WORKFLOWS = new Set<AuthoritativeWorkflowIntent>([
  'assignment',
  'cashier',
  'check-in',
  'check-out',
  'walk-in',
])

const ROUTE_WORKFLOWS: Record<AuthoritativeWorkflowRoute, ReadonlySet<AuthoritativeWorkflowIntent>> = {
  board: new Set(['assignment', 'check-in', 'check-out']),
  cashier: new Set(['cashier']),
  'front-desk': new Set(['check-in', 'check-out', 'walk-in']),
}

const SAFE_ENTITY_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/

export function sanitizeWorkflowEntityId(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim()
  return SAFE_ENTITY_ID.test(trimmed) ? trimmed : null
}

export function readAuthoritativeWorkflowQuery(
  search = typeof window === 'undefined' ? '' : window.location.search,
): AuthoritativeWorkflowQuery | null {
  const params = new URLSearchParams(search)
  const workflow = params.get('workflow')
  if (!workflow || !VALID_WORKFLOWS.has(workflow as AuthoritativeWorkflowIntent)) return null

  const reservationId = sanitizeWorkflowEntityId(params.get('reservationId'))
  const folioId = sanitizeWorkflowEntityId(params.get('folioId'))
  if (workflow !== 'walk-in' && !reservationId) return null
  if (workflow === 'cashier' && !folioId) return null

  return {
    workflow: workflow as AuthoritativeWorkflowIntent,
    ...(reservationId ? { reservationId } : {}),
    ...(folioId ? { folioId } : {}),
  }
}

export function buildAuthoritativeWorkflowUrl(
  route: AuthoritativeWorkflowRoute,
  query: AuthoritativeWorkflowQuery,
): string | null {
  if (!ROUTE_WORKFLOWS[route].has(query.workflow)) return null

  const reservationId = sanitizeWorkflowEntityId(query.reservationId)
  const folioId = sanitizeWorkflowEntityId(query.folioId)
  if (query.workflow !== 'walk-in' && !reservationId) return null
  if (query.workflow === 'cashier' && !folioId) return null

  const params = new URLSearchParams()
  if (reservationId) params.set('reservationId', reservationId)
  params.set('workflow', query.workflow)
  if (folioId) params.set('folioId', folioId)
  return `/${route}?${params.toString()}`
}

export function navigateToAuthoritativeWorkflow(
  route: AuthoritativeWorkflowRoute,
  query: AuthoritativeWorkflowQuery,
  mode: 'push' | 'replace' = 'push',
): boolean {
  if (typeof window === 'undefined') return false
  const nextUrl = buildAuthoritativeWorkflowUrl(route, query)
  if (!nextUrl) return false

  window.history[mode === 'replace' ? 'replaceState' : 'pushState']({}, '', nextUrl)
  window.dispatchEvent(new PopStateEvent('popstate'))
  return true
}

export function clearAuthoritativeWorkflowQuery(mode: 'push' | 'replace' = 'replace'): void {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  url.searchParams.delete('reservationId')
  url.searchParams.delete('workflow')
  url.searchParams.delete('folioId')
  window.history[mode === 'replace' ? 'replaceState' : 'pushState']({}, '', `${url.pathname}${url.search}${url.hash}`)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

export function useAuthoritativeWorkflowNavigationVersion(): number {
  const [version, setVersion] = useState(0)

  useEffect(() => {
    const handleNavigation = () => setVersion((current) => current + 1)
    window.addEventListener('popstate', handleNavigation)
    return () => window.removeEventListener('popstate', handleNavigation)
  }, [])

  return version
}
import { useEffect, useState } from 'react'
