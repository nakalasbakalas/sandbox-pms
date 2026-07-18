import { createContext, useContext, ReactNode, useEffect, useRef, useState } from 'react'
import { useKV } from '@github/spark/hooks'
import type { User, AuthState, Permission } from '@/types/auth'
import { ROLE_PERMISSIONS } from '@/types/auth'
import { hashPassword, type PasswordCredential } from '@/lib/auth-passwords'
import { LOCAL_AUTH_FALLBACK_ENABLED, SERVER_AUTH_ENABLED, normalizeAuthEmail } from '@/lib/auth-mode'
import { serverLogin, serverLogout, serverMe } from '@/lib/server-auth-client'

interface AuthContextType extends AuthState {
  login: (identity: string, password: string) => Promise<boolean>
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
    currentUser.username === nextUser.username &&
    currentUser.role === nextUser.role &&
    currentUser.displayName === nextUser.displayName &&
    currentUser.createdAt === nextUser.createdAt,
  )
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [localCurrentUser, setLocalCurrentUser, deleteLocalCurrentUser] = useKV<User | null>('auth:current-user', null)
  const [serverCurrentUser, setServerCurrentUser] = useState<User | null>(null)
  const [customUsers] = useKV<StoredUser[]>('system:users', [])
  const [serverSessionReady, setServerSessionReady] = useState(!SERVER_AUTH_ENABLED)
  const serverAuthGeneration = useRef(0)
  const currentUser = SERVER_AUTH_ENABLED ? serverCurrentUser : localCurrentUser
  const isAuthenticated = Boolean(currentUser && (!SERVER_AUTH_ENABLED || serverSessionReady))

  const login = async (identity: string, password: string): Promise<boolean> => {
    const normalizedIdentity = normalizeAuthEmail(identity)

    if (SERVER_AUTH_ENABLED) {
      const generation = serverAuthGeneration.current + 1
      serverAuthGeneration.current = generation
      const result = await serverLogin(normalizedIdentity, password)
      if (generation !== serverAuthGeneration.current) return false
      setServerCurrentUser(result.user)
      setServerSessionReady(true)
      removeBrowserStorage(AUTH_USER_STORAGE_KEY)
      removeBrowserStorage(LEGACY_AUTH_TOKEN_STORAGE_KEY)
      return true
    }

    if (!LOCAL_AUTH_FALLBACK_ENABLED) {
      return false
    }

    const matchingUser = customUsers.find((u) => normalizeAuthEmail(u.username || u.email) === normalizedIdentity || normalizeAuthEmail(u.email) === normalizedIdentity)
    const customUser = matchingUser && await hashPassword(password, matchingUser.passwordSalt) === matchingUser.passwordHash
      ? matchingUser
      : null

    if (customUser) {
      const user: User = {
        id: customUser.id,
        email: customUser.email ? normalizeAuthEmail(customUser.email) : null,
        username: normalizeAuthEmail(customUser.username || customUser.email),
        role: customUser.role,
        displayName: customUser.displayName,
        createdAt: customUser.createdAt,
      }
      setLocalCurrentUser(user)
      writeBrowserStorage(AUTH_USER_STORAGE_KEY, user)
      return true
    }

    return false
  }

  const logout = () => {
    if (SERVER_AUTH_ENABLED) {
      serverAuthGeneration.current += 1
      void serverLogout()
      setServerSessionReady(false)
      setServerCurrentUser(null)
    } else {
      deleteLocalCurrentUser()
    }
    removeBrowserStorage(AUTH_USER_STORAGE_KEY)
    removeBrowserStorage(LEGACY_AUTH_TOKEN_STORAGE_KEY)
  }

  useEffect(() => {
    if (!SERVER_AUTH_ENABLED) return

    removeBrowserStorage(AUTH_USER_STORAGE_KEY)
    removeBrowserStorage(LEGACY_AUTH_TOKEN_STORAGE_KEY)

    const generation = serverAuthGeneration.current + 1
    serverAuthGeneration.current = generation
    let active = true
    serverMe()
      .then((user) => {
        if (!active || generation !== serverAuthGeneration.current) return
        setServerCurrentUser((existingUser) => sameAuthUser(existingUser, user) ? existingUser : user)
        setServerSessionReady(true)
        removeBrowserStorage(AUTH_USER_STORAGE_KEY)
      })
      .catch(() => {
        if (!active || generation !== serverAuthGeneration.current) return
        setServerSessionReady(false)
        setServerCurrentUser(null)
        removeBrowserStorage(AUTH_USER_STORAGE_KEY)
        removeBrowserStorage(LEGACY_AUTH_TOKEN_STORAGE_KEY)
      })

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (SERVER_AUTH_ENABLED || localCurrentUser) return

    const storedUser = readBrowserStorage<User>(AUTH_USER_STORAGE_KEY)
    if (storedUser) setLocalCurrentUser(storedUser)
  }, [localCurrentUser, setLocalCurrentUser])

  useEffect(() => {
    if (SERVER_AUTH_ENABLED || !localCurrentUser) return
    writeBrowserStorage(AUTH_USER_STORAGE_KEY, localCurrentUser)
  }, [localCurrentUser])

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
