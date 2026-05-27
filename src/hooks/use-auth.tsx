import { createContext, useContext, ReactNode } from 'react'
import { useKV } from '@github/spark/hooks'
import type { User, AuthState, UserRole, Permission } from '@/types/auth'
import { ROLE_PERMISSIONS } from '@/types/auth'
import { hashPassword, type PasswordCredential } from '@/lib/auth-passwords'

interface AuthContextType extends AuthState {
  login: (username: string, password: string) => Promise<boolean>
  logout: () => void
  hasPermission: (permission: Permission) => boolean
  hasAnyPermission: (permissions: Permission[]) => boolean
  hasAllPermissions: (permissions: Permission[]) => boolean
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

type StoredUser = User & PasswordCredential

const DEFAULT_USERS: Record<string, PasswordCredential & { role: UserRole; displayName: string }> = {
  'Neeq': {
    passwordSalt: 'sandbox-default-admin',
    passwordHash: '2c9e6839772858382ba81216d3d0e477f0a7d1e08be2349826d1d0a7a2e4bee2',
    role: 'admin',
    displayName: 'Admin User',
  },
  'manager': {
    passwordSalt: 'sandbox-default-manager',
    passwordHash: '07caa33ad436e4a0b1ca91e97cb790cb7183cb3c5fd5ade1faa63b0945d17204',
    role: 'manager',
    displayName: 'Hotel Manager',
  },
  'frontdesk': {
    passwordSalt: 'sandbox-default-frontdesk',
    passwordHash: 'b5df4309e1896f858e499ee4d9b71cf52c6e10d66c13312e8da3accba91700b5',
    role: 'front-desk',
    displayName: 'Front Desk Staff',
  },
  'housekeeping': {
    passwordSalt: 'sandbox-default-housekeeping',
    passwordHash: '9ca00784f1fd0d513b027804737de213d212e605b81d6d5541cb88bba6d0f63c',
    role: 'housekeeping',
    displayName: 'Housekeeping Staff',
  },
  'cashier': {
    passwordSalt: 'sandbox-default-cashier',
    passwordHash: 'b04e781e99a088cc7c6f4f48a7a444b9136952717cabd0f99e0d6993dcdda28b',
    role: 'cashier',
    displayName: 'Cashier',
  },
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [currentUser, setCurrentUser, deleteCurrentUser] = useKV<User | null>('auth:current-user', null)
  const [customUsers] = useKV<StoredUser[]>('system:users', [])
  const isAuthenticated = Boolean(currentUser)

  const login = async (username: string, password: string): Promise<boolean> => {
    const defaultUser = DEFAULT_USERS[username]
    
    if (defaultUser && await hashPassword(password, defaultUser.passwordSalt) === defaultUser.passwordHash) {
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

    const matchingUser = customUsers.find(u => u.username === username)
    const customUser = matchingUser && await hashPassword(password, matchingUser.passwordSalt) === matchingUser.passwordHash
      ? matchingUser
      : null

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
