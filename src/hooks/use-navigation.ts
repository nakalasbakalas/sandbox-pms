import { createContext, useContext, useEffect, useMemo, useState, createElement, type ReactNode } from 'react'
import type { NavigationRoute } from '@/types/navigation'

interface NavigationContextValue {
  currentRoute: NavigationRoute
  requestedPath: string | null
  isKnownRoute: boolean
  navigate: (route: NavigationRoute) => void
}

const NavigationContext = createContext<NavigationContextValue | undefined>(undefined)

const VALID_ROUTES = new Set<NavigationRoute>([
  'today',
  'board',
  'rooms',
  'booking-inbox',
  'front-desk',
  'reservations',
  'guests',
  'housekeeping',
  'tablet-housekeeping',
  'cashier',
  'rates',
  'channels',
  'growth-suite',
  'reports',
  'settings',
  'messaging',
  'internal-comms',
  'daily-summary',
  'guest-communications',
  'night-audit',
  'revenue-analytics',
  'predictive-analytics',
  'system-status',
  'user-management',
  'data-backup',
  'ops-chat',
  'ops-approvals',
  'ops-tasks',
  'ops-intelligence',
  'ops-settings',
])

const PATH_ALIASES: Record<string, NavigationRoute> = {
  'ops/chat': 'ops-chat',
  'ops/approvals': 'ops-approvals',
  'ops/tasks': 'ops-tasks',
  'ops/intelligence': 'ops-intelligence',
  'ops/settings': 'ops-settings',
}

const CANONICAL_ROUTE_PATHS: Partial<Record<NavigationRoute, string>> = {
  'ops-chat': '/ops/chat',
  'ops-approvals': '/ops/approvals',
  'ops-tasks': '/ops/tasks',
  'ops-intelligence': '/ops/intelligence',
  'ops-settings': '/ops/settings',
}

function normalizePathname(pathname: string): string {
  const trimmed = pathname.replace(/^\/+|\/+$/g, '')
  return trimmed === '' ? 'today' : trimmed
}

function readRouteFromLocation() {
  if (typeof window === 'undefined') {
    return {
      currentRoute: 'today' as NavigationRoute,
      requestedPath: null as string | null,
      isKnownRoute: true,
    }
  }

  const pathname = normalizePathname(window.location.pathname)
  const aliasedRoute = PATH_ALIASES[pathname]
  if (aliasedRoute) {
    return {
      currentRoute: aliasedRoute,
      requestedPath: null,
      isKnownRoute: true,
    }
  }

  if (VALID_ROUTES.has(pathname as NavigationRoute)) {
    return {
      currentRoute: pathname as NavigationRoute,
      requestedPath: null,
      isKnownRoute: true,
    }
  }

  return {
    currentRoute: 'today' as NavigationRoute,
    requestedPath: pathname || null,
    isKnownRoute: pathname === 'today',
  }
}

function routeToPath(route: NavigationRoute) {
  if (CANONICAL_ROUTE_PATHS[route]) return CANONICAL_ROUTE_PATHS[route]
  return route === 'today' ? '/' : `/${route}`
}

interface NavigationProviderProps {
  children: ReactNode
}

export function NavigationProvider(props: NavigationProviderProps) {
  const initialRoute = useMemo(() => readRouteFromLocation(), [])
  const [routeState, setRouteState] = useState(initialRoute)

  const navigate = (route: NavigationRoute) => {
    if (typeof window === 'undefined') return
    const nextPath = routeToPath(route)
    if (window.location.pathname !== nextPath) {
      window.history.pushState({}, '', nextPath)
    }
    setRouteState({
      currentRoute: route,
      requestedPath: null,
      isKnownRoute: true,
    })
  }

  useEffect(() => {
    if (typeof window === 'undefined') return

    const syncRoute = () => {
      setRouteState(readRouteFromLocation())
    }

    window.addEventListener('popstate', syncRoute)
    window.addEventListener('hashchange', syncRoute)
    syncRoute()

    return () => {
      window.removeEventListener('popstate', syncRoute)
      window.removeEventListener('hashchange', syncRoute)
    }
  }, [])

  const value = {
    currentRoute: routeState.currentRoute,
    requestedPath: routeState.requestedPath,
    isKnownRoute: routeState.isKnownRoute,
    navigate,
  }

  return createElement(NavigationContext.Provider, { value }, props.children)
}

export function useNavigation() {
  const context = useContext(NavigationContext)
  if (!context) {
    throw new Error('useNavigation must be used within NavigationProvider')
  }
  return context
}
