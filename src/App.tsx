import { Board } from './components/board/Board'
import { 
  FrontDeskView,
  ReservationsView,
  GuestsView,
  HousekeepingView,
  CashierView,
  RatesView,
  ChannelsView,
  ReportsView,
  SettingsView,
} from './components/views/PlaceholderViews'
import { MobileHousekeepingView } from './components/housekeeping/MobileHousekeepingView'
import { CommunicationCenterView } from './components/messaging/CommunicationCenterView'
import { Toaster } from './components/ui/sonner'
import { NavigationProvider, useNavigation } from './hooks/use-navigation'
import { useOnboarding } from './hooks/use-onboarding'
import { OnboardingWizard } from './components/onboarding/OnboardingWizard'

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
    default:
      return <Board />
  }
}

function App() {
    const { completed } = useOnboarding()
    
    if (!completed) {
      return <OnboardingWizard />
    }
    
    return (
        <NavigationProvider>
            <AppRouter />
            <Toaster />
        </NavigationProvider>
    )
}

export default App