import { createContext, useContext, ReactNode, useEffect, useState } from 'react'
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
const LEGACY_AUTH_TOKEN_STORAGE_KEY = ['auth', 'pms-token'].join(':')

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
  const [customUsers] = useKV<StoredUser[]>('system:users', [])
  const [serverSessionReady, setServerSessionReady] = useState(!SERVER_AUTH_ENABLED)
  const isAuthenticated = Boolean(currentUser && (!SERVER_AUTH_ENABLED || serverSessionReady))

  const login = async (email: string, password: string): Promise<boolean> => {
    const normalizedEmail = normalizeAuthEmail(email)

    if (SERVER_AUTH_ENABLED) {
      const result = await serverLogin(normalizedEmail, password)
      setCurrentUser(result.user)
      setServerSessionReady(true)
      writeBrowserStorage(AUTH_USER_STORAGE_KEY, result.user)
      removeBrowserStorage(LEGACY_AUTH_TOKEN_STORAGE_KEY)
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
    if (SERVER_AUTH_ENABLED) {
      void serverLogout()
      setServerSessionReady(false)
    }
    deleteCurrentUser()
    removeBrowserStorage(AUTH_USER_STORAGE_KEY)
    removeBrowserStorage(LEGACY_AUTH_TOKEN_STORAGE_KEY)
  }

  useEffect(() => {
    if (SERVER_AUTH_ENABLED) {
      removeBrowserStorage(LEGACY_AUTH_TOKEN_STORAGE_KEY)

      if (!currentUser) {
        const storedUser = readBrowserStorage<User>(AUTH_USER_STORAGE_KEY)

        if (storedUser) {
          setCurrentUser(storedUser)
        }
      }

      let cancelled = false
      serverMe()
        .then((user) => {
          if (!cancelled) {
            setCurrentUser((existingUser) => sameAuthUser(existingUser, user) ? existingUser : user)
            setServerSessionReady(true)
            writeBrowserStorage(AUTH_USER_STORAGE_KEY, user)
          }
        })
        .catch(() => {
          if (!cancelled) {
            setServerSessionReady(false)
            deleteCurrentUser()
            removeBrowserStorage(AUTH_USER_STORAGE_KEY)
            removeBrowserStorage(LEGACY_AUTH_TOKEN_STORAGE_KEY)
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
  }, [currentUser?.id, deleteCurrentUser, setCurrentUser])

  useEffect(() => {
    if (!currentUser) return
    writeBrowserStorage(AUTH_USER_STORAGE_KEY, currentUser)
  }, [currentUser])

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
