import { lazy, Suspense, useMemo, useState } from 'react'
import { Toaster } from './components/ui/sonner'
import { NavigationProvider, useNavigation } from './hooks/use-navigation'
import { AppLayout } from './components/navigation/AppLayout'
import { KeyboardShortcutsDialog } from './components/help/KeyboardShortcutsDialog'
import { KeyboardShortcutsWelcome } from './components/help/KeyboardShortcutsWelcome'
import { useKeyboardShortcuts, globalShortcuts } from './hooks/use-keyboard-shortcuts'
import { useCommandPalette } from './hooks/use-command-palette'
import { CommandPalette } from './components/CommandPalette'
import { createPMSCommands } from './lib/pms-commands'
import { useDensity } from './hooks/use-density'
import { AuthProvider, useAuth } from './hooks/use-auth'
import { LoginScreen } from './components/auth/LoginScreen'
import { LanguageProvider } from './lib/i18n'
import type { NavigationRoute } from './types/navigation'
import type { Permission } from './types/auth'
import { Button } from './components/ui/button'

const TodayView = lazy(() => import('./components/today/TodayView').then((module) => ({ default: module.TodayView })))
const Board = lazy(() => import('./components/board/Board').then((module) => ({ default: module.Board })))
const RoomsView = lazy(() => import('./components/rooms/RoomsView').then((module) => ({ default: module.RoomsView })))
const FrontDeskView = lazy(() => import('./components/front-desk/FrontDeskView').then((module) => ({ default: module.FrontDeskView })))
const ReservationsView = lazy(() => import('./components/views/ReservationsView').then((module) => ({ default: module.ReservationsView })))
const GuestsView = lazy(() => import('./components/views/GuestsView').then((module) => ({ default: module.GuestsView })))
const HousekeepingBoardView = lazy(() => import('./components/housekeeping/HousekeepingBoardView').then((module) => ({ default: module.HousekeepingBoardView })))
const TabletHousekeepingApp = lazy(() => import('./components/housekeeping/TabletHousekeepingApp').then((module) => ({ default: module.TabletHousekeepingApp })))
const CashierView = lazy(() => import('./components/views/CashierView').then((module) => ({ default: module.CashierView })))
const RatesView = lazy(() => import('./components/rates/RatesView').then((module) => ({ default: module.RatesView })))
const ChannelsView = lazy(() => import('./components/channels/ChannelsView').then((module) => ({ default: module.ChannelsView })))
const GrowthSuiteView = lazy(() => import('./components/growth/GrowthSuiteView').then((module) => ({ default: module.GrowthSuiteView })))
const ReportsView = lazy(() => import('./components/reports/ReportsView').then((module) => ({ default: module.ReportsView })))
const SettingsView = lazy(() => import('./components/settings/SettingsView').then((module) => ({ default: module.SettingsView })))
const CommunicationCenterView = lazy(() => import('./components/messaging/CommunicationCenterView').then((module) => ({ default: module.CommunicationCenterView })))
const InternalCommunicationsView = lazy(() => import('./components/messaging/InternalCommunicationsView').then((module) => ({ default: module.InternalCommunicationsView })))
const GuestCommunicationsView = lazy(() => import('./components/messaging/GuestCommunicationsView').then((module) => ({ default: module.GuestCommunicationsView })))
const DailySummaryReportView = lazy(() => import('./components/settings/DailySummaryReportView').then((module) => ({ default: module.DailySummaryReportView })))
const NightAuditView = lazy(() => import('./components/views/NightAuditView').then((module) => ({ default: module.NightAuditView })))
const AdvancedRevenueAnalyticsView = lazy(() => import('./components/reports/AdvancedRevenueAnalyticsView').then((module) => ({ default: module.AdvancedRevenueAnalyticsView })))
const PredictiveAnalyticsDashboard = lazy(() => import('./components/reports/PredictiveAnalyticsDashboard').then((module) => ({ default: module.PredictiveAnalyticsDashboard })))
const SystemStatusView = lazy(() => import('./components/views/SystemStatusView').then((module) => ({ default: module.SystemStatusView })))
const UserManagementView = lazy(() => import('./components/settings/UserManagementView').then((module) => ({ default: module.UserManagementView })))
const DataBackupView = lazy(() => import('./components/views/DataBackupView').then((module) => ({ default: module.DataBackupView })))

function RouteLoading() {
  return (
    <div className="flex min-h-full items-center justify-center bg-muted/20 p-6">
      <div className="rounded-lg border bg-background px-4 py-3 text-sm text-muted-foreground shadow-sm">
        Loading PMS workspace...
      </div>
    </div>
  )
}

function RouteAccessDenied() {
  const { navigate } = useNavigation()

  return (
    <div className="flex min-h-full items-center justify-center bg-muted/20 p-6">
      <div className="max-w-md rounded-lg border bg-background p-6 text-center shadow-sm">
        <h1 className="text-lg font-semibold">Access restricted</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your role does not have permission to open this PMS area.
        </p>
        <div className="mt-4 flex justify-center">
          <Button onClick={() => navigate('today')}>
            Go to Today
          </Button>
        </div>
      </div>
    </div>
  )
}

function RouteNotFound({ path }: { path: string }) {
  const { navigate } = useNavigation()

  return (
    <div className="flex min-h-full items-center justify-center bg-muted/20 p-6">
      <div className="max-w-md rounded-lg border bg-background p-6 text-center shadow-sm">
        <h1 className="text-lg font-semibold">Page not found</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The path <span className="font-mono text-foreground">{path}</span> does not match a known PMS route.
        </p>
        <div className="mt-4 flex justify-center">
          <Button onClick={() => navigate('today')}>
            Go to Today
          </Button>
        </div>
      </div>
    </div>
  )
}

const routePermissions: Partial<Record<NavigationRoute, Permission[]>> = {
  today: ['view:board', 'create:reservation', 'view:housekeeping'],
  board: ['view:board'],
  rooms: ['view:board', 'view:housekeeping'],
  'front-desk': ['view:board', 'check-in:guest', 'check-out:guest'],
  reservations: ['view:reservations'],
  guests: ['view:guests'],
  housekeeping: ['view:housekeeping'],
  'tablet-housekeeping': ['view:housekeeping'],
  cashier: ['view:cashier'],
  rates: ['view:rates'],
  channels: ['view:channels'],
  'growth-suite': ['view:channels', 'view:rates', 'view:analytics'],
  reports: ['view:reports'],
  settings: ['view:settings'],
  messaging: ['view:messaging'],
  'internal-comms': ['view:messaging'],
  'guest-communications': ['view:messaging'],
  'daily-summary': ['view:reports', 'view:settings'],
  'night-audit': ['view:night-audit'],
  'revenue-analytics': ['view:analytics'],
  'predictive-analytics': ['view:analytics'],
  'system-status': ['view:settings'],
  'user-management': ['manage:users'],
  'data-backup': ['view:settings'],
}

function AppRouter() {
  const { currentRoute, isKnownRoute, requestedPath } = useNavigation()
  const { hasAnyPermission } = useAuth()

  if (!isKnownRoute) {
    return <RouteNotFound path={`/${requestedPath || ''}`} />
  }

  const requiredPermissions = routePermissions[currentRoute]

  if (requiredPermissions && !hasAnyPermission(requiredPermissions)) {
    return <RouteAccessDenied />
  }

  switch (currentRoute) {
    case 'today':
      return <TodayView />
    case 'board':
      return <Board />
    case 'rooms':
      return <RoomsView />
    case 'front-desk':
      return <FrontDeskView />
    case 'reservations':
      return <ReservationsView />
    case 'guests':
      return <GuestsView />
    case 'housekeeping':
      return <HousekeepingBoardView />
    case 'tablet-housekeeping':
      return <TabletHousekeepingApp />
    case 'cashier':
      return <CashierView />
    case 'rates':
      return <RatesView />
    case 'channels':
      return <ChannelsView />
    case 'growth-suite':
      return <GrowthSuiteView />
    case 'reports':
      return <ReportsView />
    case 'settings':
      return <SettingsView />
    case 'messaging':
      return <CommunicationCenterView />
    case 'internal-comms':
      return <InternalCommunicationsView />
    case 'guest-communications':
      return <GuestCommunicationsView />
    case 'daily-summary':
      return <DailySummaryReportView />
    case 'night-audit':
      return <NightAuditView />
    case 'revenue-analytics':
      return <AdvancedRevenueAnalyticsView />
    case 'predictive-analytics':
      return <PredictiveAnalyticsDashboard />
    case 'system-status':
      return <SystemStatusView />
    case 'user-management':
      return <UserManagementView />
    case 'data-backup':
      return <DataBackupView />
    default:
      return <TodayView />
  }
}

function AppContent() {
    const { isAuthenticated } = useAuth()
    const { isKnownRoute } = useNavigation()

    if (!isKnownRoute) {
      return <RouteNotFound path={window.location.pathname} />
    }

    if (!isAuthenticated) {
        return <LoginScreen />
    }

    return <AuthenticatedAppContent />
}

function AuthenticatedAppContent() {
    const [shortcutsDialogOpen, setShortcutsDialogOpen] = useState(false)
    const { navigate } = useNavigation()
    const { toggleDensity } = useDensity()
    const commands = useMemo(() => createPMSCommands(navigate), [navigate])
    const commandPalette = useCommandPalette(commands)
    
    const shortcuts = useMemo(
        () => globalShortcuts(navigate, commandPalette.open, () => setShortcutsDialogOpen(true), toggleDensity),
        [navigate, commandPalette.open, toggleDensity]
    )
    
    useKeyboardShortcuts(shortcuts, true)
    
    return (
        <>
        <AppLayout onOpenShortcuts={() => setShortcutsDialogOpen(true)}>
          <Suspense fallback={<RouteLoading />}>
            <AppRouter />
          </Suspense>
        </AppLayout>
        <KeyboardShortcutsDialog
          open={shortcutsDialogOpen}
          onOpenChange={setShortcutsDialogOpen}
          shortcuts={shortcuts}
        />
        <CommandPalette
          open={commandPalette.isOpen}
          onOpenChange={(open) => open ? commandPalette.open() : commandPalette.close()}
          commands={commands}
        />
        <KeyboardShortcutsWelcome />
            <Toaster />
        </>
    )
}

function App() {
    return (
        <AuthProvider>
          <LanguageProvider>
            <NavigationProvider>
                <AppContent />
            </NavigationProvider>
          </LanguageProvider>
        </AuthProvider>
    )
}

export default App
