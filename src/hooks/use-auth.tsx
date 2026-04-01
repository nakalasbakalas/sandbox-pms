import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { useKV } from '@github/spark/hooks'
import type { User, AuthState, UserRole, Permission } from '@/types/auth'
import { ROLE_PERMISSIONS } from '@/types/auth'

interface AuthContextType extends AuthState {
  login: (username: string, password: string) => Promise<boolean>
  logout: () => void
  hasPermission: (permission: Permission) => boolean
  hasAnyPermission: (permissions: Permission[]) => boolean
  hasAllPermissions: (permissions: Permission[]) => boolean
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

const DEFAULT_USERS: Record<string, { password: string; role: UserRole; displayName: string }> = {
  'Neeq': {
    password: 'Neeq!1234',
    role: 'admin',
    displayName: 'Admin User',
  },
  'manager': {
    password: 'manager123',
    role: 'manager',
    displayName: 'Hotel Manager',
  },
  'frontdesk': {
    password: 'frontdesk123',
    role: 'front-desk',
    displayName: 'Front Desk Staff',
  },
  'housekeeping': {
    password: 'housekeeping123',
    role: 'housekeeping',
    displayName: 'Housekeeping Staff',
  },
  'cashier': {
    password: 'cashier123',
    role: 'cashier',
    displayName: 'Cashier',
  },
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [currentUser, setCurrentUser, deleteCurrentUser] = useKV<User | null>('auth:current-user', null)
  const [customUsers] = useKV<Array<{ id: string; username: string; password: string; role: UserRole; displayName: string; createdAt: string }>>('system:users', [])
  const [isAuthenticated, setIsAuthenticated] = useState(false)

  useEffect(() => {
    setIsAuthenticated(!!currentUser)
  }, [currentUser])

  const login = async (username: string, password: string): Promise<boolean> => {
    const defaultUser = DEFAULT_USERS[username]
    
    if (defaultUser && defaultUser.password === password) {
      const user: User = {
        id: `user-${Date.now()}`,
        username,
        role: defaultUser.role,
        displayName: defaultUser.displayName,
        createdAt: new Date().toISOString(),
      }
      setCurrentUser(user)
      return true
    }

    const customUser = customUsers.find(u => u.username === username && u.password === password)
    if (customUser) {
      const user: User = {
        id: customUser.id,
        username: customUser.username,
        role: customUser.role,
        displayName: customUser.displayName,
        createdAt: customUser.createdAt,
      }
      setCurrentUser(user)
      return true
    }

    return false
  }

  const logout = () => {
    deleteCurrentUser()
    setIsAuthenticated(false)
  }

  const hasPermission = (permission: Permission): boolean => {
    if (!currentUser) return false
    return ROLE_PERMISSIONS[currentUser.role].includes(permission)
  }

  const hasAnyPermission = (permissions: Permission[]): boolean => {
    if (!currentUser) return false
    return permissions.some(permission => ROLE_PERMISSIONS[currentUser.role].includes(permission))
  }

  const hasAllPermissions = (permissions: Permission[]): boolean => {
    if (!currentUser) return false
    return permissions.every(permission => ROLE_PERMISSIONS[currentUser.role].includes(permission))
  }

  return (
    <AuthContext.Provider
      value={{
        user: currentUser,
        isAuthenticated,
        login,
        logout,
        hasPermission,
        hasAnyPermission,
        hasAllPermissions,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
