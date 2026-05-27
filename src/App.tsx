import { useState, useMemo } from 'react'
import { Board } from './components/board/Board'
import { 
  FrontDeskView,
  RatesView,
  ChannelsView,
  ReportsView,
  SettingsView,
} from './components/views/ProductViews'
import { TodayView } from './components/today/TodayView'
import { RoomsView } from './components/rooms/RoomsView'
import { ReservationsView } from './components/views/ReservationsView'
import { GuestsView } from './components/views/GuestsView'
import { CashierView } from './components/views/CashierView'
import { NightAuditView } from './components/views/NightAuditView'
import { MobileHousekeepingView } from './components/housekeeping/MobileHousekeepingView'
import { TabletHousekeepingApp } from './components/housekeeping/TabletHousekeepingApp'
import { HousekeepingModeSwitcher } from './components/housekeeping/HousekeepingModeSwitcher'
import { HousekeepingBoardView } from './components/housekeeping/HousekeepingBoardView'
import { CommunicationCenterView } from './components/messaging/CommunicationCenterView'
import { InternalCommunicationsView } from './components/messaging/InternalCommunicationsView'
import { GuestCommunicationsView } from './components/messaging/GuestCommunicationsView'
import { GrowthSuiteView } from './components/growth/GrowthSuiteView'
import { DailySummaryReportView } from './components/settings/DailySummaryReportView'
import { AdvancedRevenueAnalyticsView } from './components/reports/AdvancedRevenueAnalyticsView'
import { PredictiveAnalyticsDashboard } from './components/reports/PredictiveAnalyticsDashboard'
import { SystemStatusView } from './components/views/SystemStatusView'
import { UserManagementView } from './components/settings/UserManagementView'
import { DataBackupView } from './components/views/DataBackupView'
import { Toaster } from './components/ui/sonner'
import { NavigationProvider, useNavigation } from './hooks/use-navigation'
import { AppLayout } from './components/navigation/AppLayout'
import { KeyboardShortcutsDialog } from './components/help/KeyboardShortcutsDialog'
import { KeyboardShortcutsWelcome } from './components/help/KeyboardShortcutsWelcome'
import { useKeyboardShortcuts, globalShortcuts } from './hooks/use-keyboard-shortcuts'
import { useCommandPalette } from './hooks/use-command-palette'
import { createPMSCommands } from './lib/pms-commands'
import { useDensity } from './hooks/use-density'
import { AuthProvider, useAuth } from './hooks/use-auth'
import { LoginScreen } from './components/auth/LoginScreen'
import { LanguageProvider } from './lib/i18n'

function AppRouter() {
  const { currentRoute } = useNavigation()

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
          <AppRouter />
        </AppLayout>
        <KeyboardShortcutsDialog
          open={shortcutsDialogOpen}
          onOpenChange={setShortcutsDialogOpen}
          shortcuts={shortcuts}
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
