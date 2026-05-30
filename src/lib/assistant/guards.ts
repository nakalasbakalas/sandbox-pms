import type { AssistantAction } from './types'
import type { Permission, User, UserRole } from '@/types/auth'
import { ROLE_PERMISSIONS } from '@/types/auth'

export function hasAssistantPermission(user: Pick<User, 'role'> | null | undefined, permission?: Permission) {
  if (!permission) return true
  if (!user?.role) return false
  return ROLE_PERMISSIONS[user.role]?.includes(permission) ?? false
}

export function canSeeFinancialDetails(role?: UserRole | null) {
  if (!role) return false
  return role !== 'housekeeping'
}

export function withPermissionState(actions: AssistantAction[], user: Pick<User, 'role'> | null | undefined) {
  return actions.map((action) => {
    if (action.disabled || hasAssistantPermission(user, action.permission)) return action
    return {
      ...action,
      disabled: true,
      disabledReason: 'Your role does not have permission for this action.',
    }
  })
}
