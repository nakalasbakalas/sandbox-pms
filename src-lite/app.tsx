import { lazy, Suspense, useEffect, useMemo, useState, type CSSProperties, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import { liteApi, SESSION_EXPIRED_EVENT } from './api'
import { ErrorBlock, LoadingBlock } from './components'
import { I18nProvider, statusLabel, useI18n } from './i18n'
import type { Language, LiteRole, LiteUser } from './types'
import { FrontDeskView } from './views/FrontDeskView'

const BookingsView = lazy(() => import('./views/BookingsView').then((module) => ({ default: module.BookingsView })))
const BoardView = lazy(() => import('./views/BoardView').then((module) => ({ default: module.BoardView })))
const HousekeepingView = lazy(() => import('./views/HousekeepingView').then((module) => ({ default: module.HousekeepingView })))
const ChannelDeskView = lazy(() => import('./views/ChannelDeskView').then((module) => ({ default: module.ChannelDeskView })))
const SettingsView = lazy(() => import('./views/SettingsView').then((module) => ({ default: module.SettingsView })))

type RouteKey = 'front-desk' | 'bookings' | 'board' | 'housekeeping' | 'channel-desk' | 'settings'

const routeAccess: Record<RouteKey, LiteRole[]> = {
  'front-desk': ['ADMIN', 'MANAGER', 'FRONT_DESK'],
  bookings: ['ADMIN', 'MANAGER', 'FRONT_DESK', 'CASHIER'],
  board: ['ADMIN', 'MANAGER', 'FRONT_DESK'],
  housekeeping: ['ADMIN', 'MANAGER', 'FRONT_DESK', 'HOUSEKEEPING'],
  'channel-desk': ['ADMIN', 'MANAGER', 'FRONT_DESK'],
  settings: ['ADMIN', 'MANAGER'],
}

function readRoute(): RouteKey {
  const value = window.location.pathname.replace(/^\/+|\/+$/g, '') as RouteKey
  return Object.hasOwn(routeAccess, value) ? value : 'front-desk'
}

function useRoute(user: LiteUser) {
  const [route, setRoute] = useState<RouteKey>(readRoute())
  useEffect(() => {
    const listener = () => setRoute(readRoute())
    window.addEventListener('popstate', listener)
    return () => window.removeEventListener('popstate', listener)
  }, [])
  const allowed = routeAccess[route].includes(user.role)
  const effective = allowed ? route : (Object.keys(routeAccess) as RouteKey[]).find((candidate) => routeAccess[candidate].includes(user.role)) || null
  const navigate = (next: RouteKey) => {
    window.history.pushState({}, '', `/${next}`)
    setRoute(next)
  }
  return { route: effective, navigate }
}

function Login({ login, busy, error }: { login: (identity: string, password: string) => void; busy: boolean; error: string | null }) {
  const { language, setLanguage } = useI18n()
  const [identity, setIdentity] = useState('')
  const [password, setPassword] = useState('')
  const submit = (event: FormEvent) => {
    event.preventDefault()
    login(identity, password)
  }
  return (
    <main className="login-page">
      <button className="language-button login-language" onClick={() => setLanguage(language === 'en' ? 'th' : 'en')}>{language === 'en' ? 'ภาษาไทย' : 'English'}</button>
      <section className="login-card">
        <div className="brand-mark">S</div>
        <p className="eyebrow">Sandbox Hotel</p>
        <h1>PMS Lite</h1>
        <p>{language === 'th' ? 'เข้าสู่ระบบสำหรับพนักงานโรงแรม' : 'Secure staff access for hotel operations'}</p>
        <form onSubmit={submit}>
          <label>{language === 'th' ? 'ชื่อผู้ใช้หรืออีเมล' : 'Username or email'}<input autoComplete="username" required value={identity} onChange={(event) => setIdentity(event.target.value)} /></label>
          <label>{language === 'th' ? 'รหัสผ่าน' : 'Password'}<input autoComplete="current-password" required type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          {error ? <div className="form-error" role="alert">{error}</div> : null}
          <button className="button button--primary button--full" disabled={busy}>{busy ? '…' : language === 'th' ? 'เข้าสู่ระบบ' : 'Log in'}</button>
        </form>
      </section>
    </main>
  )
}

function LiveInvalidation({ setConnected }: { setConnected: (value: boolean) => void }) {
  const queryClient = useQueryClient()
  useEffect(() => {
    const stream = new EventSource('/api/realtime/events')
    const refresh = () => queryClient.invalidateQueries({ queryKey: ['lite'] })
    const events = ['sync-required', 'booking-email.received', 'booking-email.changed', 'reservation.changed', 'manual-channel-tasks.changed']
    stream.onopen = () => setConnected(true)
    stream.onerror = () => setConnected(false)
    stream.onmessage = refresh
    for (const name of events) stream.addEventListener(name, refresh)
    return () => {
      for (const name of events) stream.removeEventListener(name, refresh)
      stream.close()
      setConnected(false)
    }
  }, [queryClient, setConnected])
  return null
}

function Shell({ user, logout }: { user: LiteUser; logout: () => void }) {
  const { t, language, setLanguage } = useI18n()
  const { route, navigate } = useRoute(user)
  const [connected, setConnected] = useState(false)
  const nav = useMemo(() => ([
    ['front-desk', t('frontDesk'), '01'],
    ['bookings', t('bookings'), '02'],
    ['board', t('board'), '03'],
    ['housekeeping', t('housekeeping'), '04'],
    ['channel-desk', t('channelDesk'), '05'],
    ['settings', t('settings'), '06'],
  ] as Array<[RouteKey, string, string]>).filter(([key]) => routeAccess[key].includes(user.role)), [t, user.role])

  const currentView = route === null
    ? <ErrorBlock error={language === 'th' ? 'ยังไม่มีหน้าจอ PMS Lite สำหรับสิทธิ์ผู้ใช้นี้' : 'No PMS Lite workspace is assigned to this role.'} />
    : route === 'front-desk'
    ? <FrontDeskView role={user.role} />
    : route === 'bookings'
      ? <BookingsView role={user.role} />
      : route === 'board'
        ? <BoardView role={user.role} />
        : route === 'housekeeping'
          ? <HousekeepingView />
          : route === 'channel-desk'
            ? <ChannelDeskView role={user.role} />
            : <SettingsView user={user} />

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar__brand"><div className="brand-mark">S</div><div><strong>Sandbox</strong><span>PMS Lite</span></div></div>
        <nav style={{ '--lite-nav-count': nav.length } as CSSProperties}>
          {nav.map(([key, label, index]) => (
            <button key={key} aria-current={route === key ? 'page' : undefined} className={route === key ? 'is-active' : ''} onClick={() => navigate(key)}><span>{index}</span>{label}</button>
          ))}
        </nav>
        <div className="sidebar__footer">
          <div className="staff-card"><span>{user.displayName}</span><small>{statusLabel(user.role, language)}</small></div>
          <button className="sidebar-logout" onClick={logout}>{t('logout')}</button>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className={`live-state ${connected ? 'is-connected' : ''}`} role="status" aria-live="polite"><span />{connected ? t('networkOnline') : t('networkFallback')}</div>
          <button className="language-button" onClick={() => setLanguage(language === 'en' ? 'th' : 'en')}>{t('language')}</button>
          <button className="topbar-logout" onClick={logout}>{t('logout')}</button>
        </header>
        <main className="workspace__main"><Suspense fallback={<LoadingBlock />}>{currentView}</Suspense></main>
      </div>
      {route ? <LiveInvalidation setConnected={setConnected} /> : null}
    </div>
  )
}

function AppSession() {
  const { language } = useI18n()
  const queryClient = useQueryClient()
  const [user, setUser] = useState<LiteUser | null>(null)
  const [checking, setChecking] = useState(true)
  const [loginBusy, setLoginBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const expireSession = () => {
      queryClient.clear()
      setUser(null)
      setChecking(false)
      setLoginBusy(false)
      setError(language === 'th' ? 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง' : 'Your session has expired. Please sign in again.')
    }
    window.addEventListener(SESSION_EXPIRED_EVENT, expireSession)
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, expireSession)
  }, [language, queryClient])

  useEffect(() => {
    let current = true
    liteApi.me().then((value) => current && setUser(value)).catch(() => undefined).finally(() => current && setChecking(false))
    return () => { current = false }
  }, [])

  if (checking) return <div className="boot-screen"><LoadingBlock /></div>
  if (!user) {
    return <Login busy={loginBusy} error={error} login={async (identity, password) => {
      setLoginBusy(true)
      setError(null)
      try {
        const authenticatedUser = await liteApi.login(identity, password)
        queryClient.clear()
        setUser(authenticatedUser)
      } catch (loginError) {
        setError(language === 'th' ? 'ไม่สามารถเข้าสู่ระบบได้ กรุณาตรวจสอบชื่อผู้ใช้และรหัสผ่าน' : loginError instanceof Error ? loginError.message : String(loginError))
      } finally {
        setLoginBusy(false)
      }
    }} />
  }
  return <Shell user={user} logout={async () => {
    await liteApi.logout()
    queryClient.clear()
    setUser(null)
  }} />
}

export function LiteApp() {
  const [language, setLanguageState] = useState<Language>(() => window.localStorage.getItem('pms-lite-language') === 'th' ? 'th' : 'en')
  useEffect(() => {
    document.documentElement.lang = language
  }, [language])
  const setLanguage = (next: Language) => {
    setLanguageState(next)
    window.localStorage.setItem('pms-lite-language', next)
    document.documentElement.lang = next
  }
  return (
    <I18nProvider language={language} setLanguage={setLanguage}>
      <AppSession />
    </I18nProvider>
  )
}
