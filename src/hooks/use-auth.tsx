import { createContext, useContext, ReactNode, useEffect } from 'react'
import { useKV } from '@github/spark/hooks'
import type { User, AuthState, Permission } from '@/types/auth'
import { ROLE_PERMISSIONS } from '@/types/auth'
import { hashPassword, type PasswordCredential } from '@/lib/auth-passwords'
import { LOCAL_AUTH_FALLBACK_ENABLED, SERVER_AUTH_ENABLED, normalizeAuthEmail } from '@/lib/auth-mode'
import { serverLogin, serverLogout, serverMe } from '@/lib/server-auth-client'

interface AuthContextType extends AuthState {
  login: (email: string, password: string) => Promise<boolean>
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

function sameAuthUser(currentUser: User | null, nextUser: User) {
  return Boolean(
    currentUser &&
    currentUser.id === nextUser.id &&
    currentUser.email === nextUser.email &&
    currentUser.role === nextUser.role &&
    currentUser.displayName === nextUser.displayName &&
    currentUser.createdAt === nextUser.createdAt,
  )
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [currentUser, setCurrentUser, deleteCurrentUser] = useKV<User | null>('auth:current-user', null)
  const [authToken, setAuthToken, deleteAuthToken] = useKV<string | null>('auth:pms-token', null)
  const [customUsers] = useKV<StoredUser[]>('system:users', [])
  const isAuthenticated = Boolean(currentUser && (!SERVER_AUTH_ENABLED || authToken))

  const login = async (email: string, password: string): Promise<boolean> => {
    const normalizedEmail = normalizeAuthEmail(email)

    if (SERVER_AUTH_ENABLED) {
      const result = await serverLogin(normalizedEmail, password)
      setCurrentUser(result.user)
      setAuthToken(result.token)
      writeBrowserStorage(AUTH_USER_STORAGE_KEY, result.user)
      writeBrowserStorage(AUTH_TOKEN_STORAGE_KEY, result.token)
      return true
    }

    if (!LOCAL_AUTH_FALLBACK_ENABLED) {
      return false
    }

    const matchingUser = customUsers.find((u) => normalizeAuthEmail(u.email || u.username) === normalizedEmail)
    const customUser = matchingUser && await hashPassword(password, matchingUser.passwordSalt) === matchingUser.passwordHash
      ? matchingUser
      : null

    if (customUser) {
      const user: User = {
        id: customUser.id,
        email: normalizeAuthEmail(customUser.email || customUser.username),
        username: normalizeAuthEmail(customUser.email || customUser.username),
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
    if (SERVER_AUTH_ENABLED) {
      void serverLogout(token)
    }
    deleteAuthToken()
    deleteCurrentUser()
    removeBrowserStorage(AUTH_USER_STORAGE_KEY)
    removeBrowserStorage(AUTH_TOKEN_STORAGE_KEY)
  }

  useEffect(() => {
    if (SERVER_AUTH_ENABLED) {
      if (!authToken && !currentUser) {
        const storedUser = readBrowserStorage<User>(AUTH_USER_STORAGE_KEY)
        const storedToken = readBrowserStorage<string>(AUTH_TOKEN_STORAGE_KEY)

        if (storedUser) {
          setCurrentUser(storedUser)
        }
        if (storedToken) {
          setAuthToken(storedToken)
        }

        if (storedUser || storedToken) {
          return
        }
      }

      if (!authToken) {
        if (currentUser) {
          deleteCurrentUser()
          removeBrowserStorage(AUTH_USER_STORAGE_KEY)
        }
        return
      }

      let cancelled = false
      serverMe(authToken)
        .then((user) => {
          if (!cancelled) {
            setCurrentUser((existingUser) => sameAuthUser(existingUser, user) ? existingUser : user)
          }
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
    }

    if (currentUser) return

    const storedUser = readBrowserStorage<User>(AUTH_USER_STORAGE_KEY)

    if (storedUser) {
      setCurrentUser(storedUser)
    }
  }, [authToken, currentUser?.id, deleteAuthToken, deleteCurrentUser, setAuthToken, setCurrentUser])

  useEffect(() => {
    if (!currentUser) return
    if (SERVER_AUTH_ENABLED && !authToken) return
    writeBrowserStorage(AUTH_USER_STORAGE_KEY, currentUser)
  }, [authToken, currentUser])

  useEffect(() => {
    if (!authToken) return
    writeBrowserStorage(AUTH_TOKEN_STORAGE_KEY, authToken)
  }, [authToken])

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
