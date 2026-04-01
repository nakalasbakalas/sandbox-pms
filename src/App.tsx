import { useState, useMemo } from 'react'
import { Board } from './components/board/Board'
import { 
  FrontDeskView,
  HousekeepingView,
  RatesView,
  ChannelsView,
  ReportsView,
  SettingsView,
} from './components/views/PlaceholderViews'
import { ReservationsView } from './components/views/ReservationsView'
import { GuestsView } from './components/views/GuestsView'
import { CashierView } from './components/views/CashierView'
import { MobileHousekeepingView } from './components/housekeeping/MobileHousekeepingView'
import { CommunicationCenterView } from './components/messaging/CommunicationCenterView'
import { DailySummaryReportView } from './components/settings/DailySummaryReportView'
import { Toaster } from './components/ui/sonner'
import { NavigationProvider, useNavigation } from './hooks/use-navigation'
import { useOnboarding } from './hooks/use-onboarding'
import { OnboardingWizard } from './components/onboarding/OnboardingWizard'
import { AppLayout } from './components/navigation/AppLayout'
import { KeyboardShortcutsDialog } from './components/help/KeyboardShortcutsDialog'
import { KeyboardShortcutsWelcome } from './components/help/KeyboardShortcutsWelcome'
import { useKeyboardShortcuts, globalShortcuts } from './hooks/use-keyboard-shortcuts'
import { useCommandPalette } from './hooks/use-command-palette'
import { createPMSCommands } from './lib/pms-commands'

function AppRouter() {
  const { currentRoute } = useNavigation()

  switch (currentRoute) {
    case 'board':
      return <Board />
    case 'front-desk':
      return <FrontDeskView />
    case 'reservations':
      return <ReservationsView />
    case 'guests':
      return <GuestsView />
    case 'housekeeping':
      return <MobileHousekeepingView />
    case 'cashier':
      return <CashierView />
    case 'rates':
      return <RatesView />
    case 'channels':
      return <ChannelsView />
    case 'reports':
      return <ReportsView />
    case 'settings':
      return <SettingsView />
    case 'messaging':
      return <CommunicationCenterView />
    case 'daily-summary':
      return <DailySummaryReportView />
    default:
      return <Board />
  }
}

function AppContent() {
    const { completed } = useOnboarding()
    const [shortcutsDialogOpen, setShortcutsDialogOpen] = useState(false)
    const { navigate } = useNavigation()
    const commands = useMemo(() => createPMSCommands(navigate), [navigate])
    const commandPalette = useCommandPalette(commands)
    
    const shortcuts = useMemo(
        () => globalShortcuts(navigate, commandPalette.open, () => setShortcutsDialogOpen(true)),
        [navigate, commandPalette.open]
    )
    
    useKeyboardShortcuts(shortcuts, completed)
    
    return (
        <>
            {!completed ? (
                <OnboardingWizard />
            ) : (
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
                </>
            )}
            <Toaster />
        </>
    )
}

function App() {
    return (
        <NavigationProvider>
            <AppContent />
        </NavigationProvider>
    )
}

export default App