import { ReactNode } from 'react'
import { useAuth } from '@/hooks/use-auth'
import type { Permission } from '@/types/auth'

interface PermissionGateProps {
  children: ReactNode
  permission?: Permission
  anyOf?: Permission[]
  allOf?: Permission[]
  fallback?: ReactNode
}

export function PermissionGate({ 
  children, 
  permission, 
  anyOf, 
  allOf, 
  fallback = null 
}: PermissionGateProps) {
  const { hasPermission, hasAnyPermission, hasAllPermissions } = useAuth()

  let hasAccess = true

  if (permission) {
    hasAccess = hasPermission(permission)
  } else if (anyOf) {
    hasAccess = hasAnyPermission(anyOf)
  } else if (allOf) {
    hasAccess = hasAllPermissions(allOf)
  }

  if (!hasAccess) {
    return <>{fallback}</>
  }

  return <>{children}</>
}
