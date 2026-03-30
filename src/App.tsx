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
import { Toaster } from './components/ui/sonner'
import { NavigationProvider, useNavigation } from './hooks/use-navigation'

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
      return <HousekeepingView />
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
    default:
      return <Board />
  }
}

function App() {
    return (
        <NavigationProvider>
            <AppRouter />
            <Toaster />
        </NavigationProvider>
    )
}

export default App