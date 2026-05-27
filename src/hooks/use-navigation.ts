import { createContext, useContext, useState, createElement, type ReactNode } from 'react'
import type { NavigationRoute } from '@/types/navigation'

interface NavigationContextValue {
  currentRoute: NavigationRoute
  navigate: (route: NavigationRoute) => void
}

const NavigationContext = createContext<NavigationContextValue | undefined>(undefined)

interface NavigationProviderProps {
  children: ReactNode
}

export function NavigationProvider(props: NavigationProviderProps) {
  const [currentRoute, setCurrentRoute] = useState<NavigationRoute>('today')

  const navigate = (route: NavigationRoute) => {
    setCurrentRoute(route)
  }

  const value = { currentRoute, navigate }

  return createElement(NavigationContext.Provider, { value }, props.children)
}

export function useNavigation() {
  const context = useContext(NavigationContext)
  if (!context) {
    throw new Error('useNavigation must be used within NavigationProvider')
  }
  return context
}
