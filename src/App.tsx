import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
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
import { FrontDeskAssistantProvider } from './components/front-desk-assistant/FrontDeskAssistantProvider'
import { LanguageProvider } from './lib/i18n'
import { useOnboarding } from './hooks/use-onboarding'
import { OnboardingWizard } from './components/onboarding/OnboardingWizard'
import type { NavigationRoute } from './types/navigation'
import type { Permission } from './types/auth'
import { Button } from './components/ui/button'
import { SERVER_API_ENABLED } from './lib/pms-api-client'
import { dataSyncService, type DataSyncEvent } from './lib/data-sync'
import { capabilityEnabled, useSystemCapabilities } from './hooks/use-system-capabilities'

const TodayView = lazy(() => import('./components/today/TodayView').then((module) => ({ default: module.TodayView })))
const Board = lazy(() => import('./components/board/Board').then((module) => ({ default: module.Board })))
const ServerBookingBoard = lazy(() => import('./components/board/ServerBookingBoard').then((module) => ({ default: module.ServerBookingBoard })))
const RoomsView = lazy(() => import('./components/rooms/RoomsView').then((module) => ({ default: module.RoomsView })))
const BookingInboxView = lazy(() => import('./components/booking-email/BookingInboxView').then((module) => ({ default: module.BookingInboxView })))
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
const HotelOpsCommandCenterView = lazy(() => import('./components/hotel-ops/HotelOpsCommandCenterView').then((module) => ({ default: module.HotelOpsCommandCenterView })))

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

function CapabilityUnavailable({ title, detail }: { title: string; detail: string }) {
  const { navigate } = useNavigation()

  return (
    <div className="flex min-h-full items-center justify-center bg-muted/20 p-6">
      <div className="max-w-lg rounded-lg border bg-background p-6 text-center shadow-sm">
        <h1 className="text-lg font-semibold">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{detail}</p>
        <div className="mt-4 flex justify-center">
          <Button onClick={() => navigate('system-status')}>View system status</Button>
        </div>
      </div>
    </div>
  )
}

const serverHiddenCommandIds = new Set([
  'internal-comms',
  'guest-communications',
  'send-email',
  'daily-summary',
  'backup-data',
])

const routePermissions: Partial<Record<NavigationRoute, Permission[]>> = {
  today: ['view:board', 'create:reservation', 'view:housekeeping'],
  board: ['view:board'],
  rooms: ['view:board'],
  'booking-inbox': ['view:reservations', 'view:messaging'],
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
  'ops-chat': ['create:ops-task'],
  'ops-approvals': ['approve:ops-task'],
  'ops-tasks': ['view:ops'],
  'ops-intelligence': ['view:ops'],
  'ops-settings': ['manage:ops-settings'],
}

function AppRouter() {
  const { currentRoute, isKnownRoute, requestedPath } = useNavigation()
  const { hasAnyPermission } = useAuth()
  const { registry, loading: capabilitiesLoading, error: capabilitiesError } = useSystemCapabilities()

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
      return SERVER_API_ENABLED ? <ServerBookingBoard /> : <Board />
    case 'rooms':
      return <RoomsView />
    case 'booking-inbox':
      return <BookingInboxView />
    case 'front-desk':
      return <FrontDeskView />
    case 'reservations':
      return <ReservationsView />
    case 'guests':
      return <GuestsView />
    case 'housekeeping':
      return <HousekeepingBoardView />
    case 'tablet-housekeeping':
      return SERVER_API_ENABLED ? <HousekeepingBoardView /> : <TabletHousekeepingApp />
    case 'cashier':
      return <CashierView />
    case 'rates':
      return <RatesView />
    case 'channels':
      return <ChannelsView />
    case 'growth-suite':
      if (SERVER_API_ENABLED && capabilitiesLoading) return <RouteLoading />
      if (SERVER_API_ENABLED && !capabilityEnabled(registry?.integrations.directBooking)) {
        return (
          <CapabilityUnavailable
            title="Direct Booking is unavailable"
            detail={capabilitiesError || registry?.integrations.directBooking?.evidence || 'The server capability registry did not confirm Direct Booking.'}
          />
        )
      }
      return <GrowthSuiteView />
    case 'reports':
      return <ReportsView />
    case 'settings':
      return <SettingsView />
    case 'messaging':
      return <CommunicationCenterView />
    case 'internal-comms':
      if (SERVER_API_ENABLED) {
        return <CapabilityUnavailable title="Internal staff messaging is unavailable" detail="This legacy workspace is browser-backed. Use the server-backed Communication Center for persisted drafts and provider-gated delivery." />
      }
      return <InternalCommunicationsView />
    case 'guest-communications':
      if (SERVER_API_ENABLED) {
        return <CapabilityUnavailable title="Guest communications are unavailable" detail="This legacy workspace is browser-backed. Use the server-backed Communication Center for persisted drafts and provider-gated delivery." />
      }
      return <GuestCommunicationsView />
    case 'daily-summary':
      if (SERVER_API_ENABLED) {
        return <CapabilityUnavailable title="Daily Summary is unavailable" detail="This legacy report is browser-backed. Use Today and server-backed Reports for authoritative operational data." />
      }
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
      if (SERVER_API_ENABLED) {
        return <CapabilityUnavailable title="Browser data backup is unavailable" detail="Server mode stores operational data in PostgreSQL. Browser export, import, and reset controls are disabled." />
      }
      return <DataBackupView />
    case 'ops-chat':
      return <HotelOpsCommandCenterView tab="chat" />
    case 'ops-approvals':
      return <HotelOpsCommandCenterView tab="approvals" />
    case 'ops-tasks':
      return <HotelOpsCommandCenterView tab="tasks" />
    case 'ops-intelligence':
      return <HotelOpsCommandCenterView tab="intelligence" />
    case 'ops-settings':
      return <HotelOpsCommandCenterView tab="settings" />
    default:
      return <TodayView />
  }
}

function AppContent() {
    const { isAuthenticated } = useAuth()
    const { isKnownRoute } = useNavigation()
    const { setupRequired, setupStatusReady, setupError } = useOnboarding()

    if (!isKnownRoute) {
      return <RouteNotFound path={window.location.pathname} />
    }

    if (isAuthenticated) {
      return <AuthenticatedAppContent />
    }

    if (!setupStatusReady) {
      return <RouteLoading />
    }

    if (setupError) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-muted/20 p-6">
          <div className="max-w-md rounded-lg border bg-background p-6 text-center shadow-sm">
            <h1 className="text-lg font-semibold">Setup check failed</h1>
            <p className="mt-2 text-sm text-muted-foreground">{setupError}</p>
          </div>
        </div>
      )
    }

    if (setupRequired) {
      return <OnboardingWizard />
    }

    return <LoginScreen />
}

function AuthenticatedAppContent() {
    const [shortcutsDialogOpen, setShortcutsDialogOpen] = useState(false)
    const { navigate } = useNavigation()
    const { toggleDensity } = useDensity()
    const commands = useMemo(
      () => createPMSCommands(navigate).filter((command) => !SERVER_API_ENABLED || !serverHiddenCommandIds.has(command.id)),
      [navigate],
    )
    const commandPalette = useCommandPalette(commands)
    
    const shortcuts = useMemo(
        () => globalShortcuts(navigate, commandPalette.open, () => setShortcutsDialogOpen(true), toggleDensity),
        [navigate, commandPalette.open, toggleDensity]
    )
    
    useKeyboardShortcuts(shortcuts, true)
    
    return (
        <>
        <DomainEventBridge />
        <FrontDeskAssistantProvider>
          <AppLayout onOpenShortcuts={() => setShortcutsDialogOpen(true)}>
            <Suspense fallback={<RouteLoading />}>
              <AppRouter />
            </Suspense>
          </AppLayout>
        </FrontDeskAssistantProvider>
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
        </>
    )
}

interface ServerDomainEvent {
  id: string
  type: string
  aggregateType: string
  aggregateId: string
  occurredAt: string
}

const legacyEventTypes: Record<string, DataSyncEvent['type']> = {
  RESERVATION_CREATED: 'RESERVATION_CREATED',
  RESERVATION_UPDATED: 'RESERVATION_MODIFIED',
  RESERVATION_CANCELLED: 'RESERVATION_CANCELLED',
  RESERVATION_NO_SHOW: 'RESERVATION_CANCELLED',
  RESERVATION_CHECKED_IN: 'CHECK_IN',
  RESERVATION_CHECKED_OUT: 'CHECK_OUT',
  ROOM_HOUSEKEEPING_UPDATED: 'ROOM_STATUS_CHANGE',
  ROOM_OPERATIONAL_STATUS_UPDATED: 'ROOM_STATUS_CHANGE',
  PAYMENT_CREATED: 'PAYMENT_RECEIVED',
  CHARGE_CREATED: 'FOLIO_UPDATED',
}

function DomainEventBridge() {
  const { hasAnyPermission } = useAuth()
  const canSubscribe = SERVER_API_ENABLED && hasAnyPermission(['view:board'])

  useEffect(() => {
    if (!canSubscribe) return
    const source = new EventSource('/api/events', { withCredentials: true })
    const onDomainEvent = (message: MessageEvent<string>) => {
      try {
        const event = JSON.parse(message.data) as ServerDomainEvent
        window.dispatchEvent(new CustomEvent('pms:domain-event', { detail: event }))
        const legacyType = legacyEventTypes[event.type]
        if (legacyType) {
          dataSyncService.emit({
            type: legacyType,
            source: 'server-sse',
            timestamp: new Date(event.occurredAt),
            data: { aggregateType: event.aggregateType, aggregateId: event.aggregateId, eventId: event.id },
          })
        }
      } catch {
        // Ignore malformed/untrusted stream payloads and let authoritative views refetch.
      }
    }

    for (const eventType of Object.keys(legacyEventTypes)) source.addEventListener(eventType, onDomainEvent as EventListener)
    return () => source.close()
  }, [canSubscribe])

  return null
}

function App() {
    return (
        <AuthProvider>
          <LanguageProvider>
            <NavigationProvider>
                <AppContent />
                <Toaster />
            </NavigationProvider>
          </LanguageProvider>
        </AuthProvider>
    )
}

export default App
