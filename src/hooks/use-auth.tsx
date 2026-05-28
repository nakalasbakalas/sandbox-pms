import { createContext, useContext, ReactNode, useEffect } from 'react'
import { useKV } from '@github/spark/hooks'
import type { User, AuthState, UserRole, Permission } from '@/types/auth'
import { ROLE_PERMISSIONS } from '@/types/auth'
import { hashPassword, type PasswordCredential } from '@/lib/auth-passwords'
import { isServerAuthEnabled, serverLogin, serverLogout, serverMe } from '@/lib/server-auth-client'

interface AuthContextType extends AuthState {
  login: (username: string, password: string) => Promise<boolean>
  logout: () => void
  hasPermission: (permission: Permission) => boolean
  hasAnyPermission: (permissions: Permission[]) => boolean
  hasAllPermissions: (permissions: Permission[]) => boolean
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

type StoredUser = User & PasswordCredential

const AUTH_USER_STORAGE_KEY = 'auth:current-user'
const AUTH_TOKEN_STORAGE_KEY = 'auth:pms-token'

function readBrowserStorage<T>(key: string): T | null {
  if (typeof window === 'undefined') return null
  const raw = window.localStorage.getItem(key)
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

function writeBrowserStorage(key: string, value: unknown) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(key, JSON.stringify(value))
}

function removeBrowserStorage(key: string) {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(key)
}

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
  const [authToken, setAuthToken, deleteAuthToken] = useKV<string | null>('auth:pms-token', null)
  const [customUsers] = useKV<StoredUser[]>('system:users', [])
  const isAuthenticated = Boolean(currentUser)

  const login = async (username: string, password: string): Promise<boolean> => {
    if (isServerAuthEnabled()) {
      const result = await serverLogin(username, password)
      setCurrentUser(result.user)
      setAuthToken(result.token)
      writeBrowserStorage(AUTH_USER_STORAGE_KEY, result.user)
      writeBrowserStorage(AUTH_TOKEN_STORAGE_KEY, result.token)
      return true
    }

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
      writeBrowserStorage(AUTH_USER_STORAGE_KEY, user)
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
      writeBrowserStorage(AUTH_USER_STORAGE_KEY, user)
      return true
    }

    return false
  }

  const logout = () => {
    const token = authToken || undefined
    if (isServerAuthEnabled()) {
      void serverLogout(token)
    }
    deleteAuthToken()
    deleteCurrentUser()
    removeBrowserStorage(AUTH_USER_STORAGE_KEY)
    removeBrowserStorage(AUTH_TOKEN_STORAGE_KEY)
  }

  useEffect(() => {
    if (currentUser || authToken) return

    const storedUser = readBrowserStorage<User>(AUTH_USER_STORAGE_KEY)
    const storedToken = readBrowserStorage<string>(AUTH_TOKEN_STORAGE_KEY)

    if (storedUser) {
      setCurrentUser(storedUser)
    }
    if (storedToken) {
      setAuthToken(storedToken)
    }
  }, [authToken, currentUser, setAuthToken, setCurrentUser])

  useEffect(() => {
    if (!currentUser) return
    writeBrowserStorage(AUTH_USER_STORAGE_KEY, currentUser)
  }, [currentUser])

  useEffect(() => {
    if (!authToken) return
    writeBrowserStorage(AUTH_TOKEN_STORAGE_KEY, authToken)
  }, [authToken])

  useEffect(() => {
    if (!isServerAuthEnabled() || !authToken) return

    let cancelled = false
    serverMe(authToken)
      .then((user) => {
        if (!cancelled) setCurrentUser(user)
      })
      .catch(() => {
        if (!cancelled) {
          deleteAuthToken()
          deleteCurrentUser()
        }
      })

    return () => {
      cancelled = true
    }
  }, [authToken, deleteAuthToken, deleteCurrentUser, setCurrentUser])

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
