import type { Command } from '@/types/command-palette'
import type { NavigationRoute } from '@/types/navigation'
import {
  HouseLine,
  Calendar,
  Users,
  Bed,
  Broom,
  CurrencyCircleDollar,
  ChartBar,
  Receipt,
  MagnifyingGlass,
  Plus,
  ArrowsClockwise,
  SignOut,
  Bell,
  Gear,
  Database,
  ChatCircle,
  ChatCenteredDots,
  EnvelopeSimple,
  ChartLineUp,
  ListChecks,
  UserCirclePlus,
  Moon,
  Envelope,
  Brain,
  Storefront,
} from '@phosphor-icons/react'
import { toast } from 'sonner'

export function createPMSCommands(navigate?: (route: NavigationRoute) => void): Command[] {
  return [
    {
      id: 'nav-today',
      label: 'Go to Today',
      description: 'Open daily operations control',
      category: 'navigation',
      keywords: ['today', 'mission control', 'daily', 'operations'],
      shortcut: 'cmd+1',
      icon: ListChecks,
      action: () => {
        navigate?.('today')
      },
    },
    {
      id: 'nav-board',
      label: 'Go to Front Desk Board',
      description: 'View the compact room board',
      category: 'navigation',
      keywords: ['board', 'rooms', 'home', 'overview', 'calendar'],
      shortcut: 'cmd+2',
      icon: HouseLine,
      action: () => {
        navigate?.('board')
      },
    },
    {
      id: 'nav-front-desk',
      label: 'Go to Front Desk',
      description: 'Access arrivals, departures, and check-ins',
      category: 'navigation',
      keywords: ['front desk', 'reception', 'arrivals', 'departures'],
      shortcut: 'cmd+3',
      icon: Calendar,
      action: () => {
        navigate?.('front-desk')
      },
    },
    {
      id: 'nav-reservations',
      label: 'Go to Reservations',
      description: 'Manage bookings and reservation pipeline',
      category: 'navigation',
      keywords: ['reservations', 'bookings', 'schedule'],
      shortcut: 'cmd+4',
      icon: Calendar,
      action: () => {
        navigate?.('reservations')
      },
    },
    {
      id: 'nav-rooms',
      label: 'Go to Rooms',
      description: 'Review all 30 sellable rooms and room readiness',
      category: 'navigation',
      keywords: ['rooms', 'inventory', 'readiness', 'status'],
      icon: Bed,
      action: () => {
        navigate?.('rooms')
      },
    },
    {
      id: 'nav-guests',
      label: 'Go to Guests',
      description: 'View guest profiles and stay history',
      category: 'navigation',
      keywords: ['guests', 'profiles', 'customers'],
      shortcut: 'cmd+4',
      icon: Users,
      action: () => {
        navigate?.('guests')
      },
    },
    {
      id: 'nav-housekeeping',
      label: 'Go to Housekeeping',
      description: 'Room status and cleaning operations',
      category: 'navigation',
      keywords: ['housekeeping', 'cleaning', 'room status'],
      shortcut: 'cmd+5',
      icon: Broom,
      action: () => {
        navigate?.('housekeeping')
      },
    },
    {
      id: 'nav-cashier',
      label: 'Go to Payments',
      description: 'Payments, folios, and invoices',
      category: 'navigation',
      keywords: ['cashier', 'payments', 'billing', 'folio'],
      shortcut: 'cmd+6',
      icon: CurrencyCircleDollar,
      action: () => {
        navigate?.('cashier')
      },
    },
    {
      id: 'nav-rates',
      label: 'Go to Rates',
      description: 'Pricing rules and rate management',
      category: 'navigation',
      keywords: ['rates', 'pricing', 'revenue'],
      icon: ChartLineUp,
      action: () => {
        navigate?.('rates')
      },
    },
    {
      id: 'nav-channels',
      label: 'Go to Channel Manager',
      description: 'OTA integrations and channel manager',
      category: 'navigation',
      keywords: ['channels', 'ota', 'booking.com', 'agoda'],
      icon: ArrowsClockwise,
      action: () => {
        navigate?.('channels')
      },
    },
    {
      id: 'nav-growth-suite',
      label: 'Go to Direct Booking',
      description: 'Manage booking engine, website, metasearch, mobile, and marketplace tools',
      category: 'navigation',
      keywords: ['direct booking', 'booking engine', 'website', 'metasearch', 'mobile', 'marketplace'],
      icon: Storefront,
      action: () => {
        navigate?.('growth-suite')
      },
    },
    {
      id: 'nav-reports',
      label: 'Go to Insights',
      description: 'Analytics and operational reports',
      category: 'navigation',
      keywords: ['reports', 'analytics', 'metrics'],
      shortcut: 'cmd+r',
      icon: ChartBar,
      action: () => {
        navigate?.('reports')
      },
    },
    {
      id: 'nav-settings',
      label: 'Go to Settings',
      description: 'System configuration and preferences',
      category: 'navigation',
      keywords: ['settings', 'admin', 'config'],
      icon: Gear,
      action: () => {
        navigate?.('settings')
      },
    },
    {
      id: 'search-room',
      label: 'Search Rooms',
      description: 'Quick search for room by number',
      category: 'operations',
      keywords: ['search', 'find', 'room', 'number'],
      shortcut: 'cmd+f',
      icon: MagnifyingGlass,
      action: () => {
        toast.info('Search rooms')
      },
    },
    {
      id: 'search-guest',
      label: 'Search Guests',
      description: 'Find guest by name or reservation',
      category: 'guests',
      keywords: ['search', 'find', 'guest', 'customer'],
      shortcut: 'cmd+shift+f',
      icon: MagnifyingGlass,
      action: () => {
        toast.info('Search guests')
      },
    },
    {
      id: 'checkin',
      label: 'Check In Guest',
      description: 'Process guest arrival and room assignment',
      category: 'operations',
      keywords: ['check in', 'arrival', 'assign room'],
      shortcut: 'cmd+i',
      icon: SignOut,
      action: () => {
        toast.info('Open check-in workflow')
      },
    },
    {
      id: 'checkout',
      label: 'Check Out Guest',
      description: 'Process guest departure and payment',
      category: 'operations',
      keywords: ['check out', 'departure', 'payment'],
      shortcut: 'cmd+o',
      icon: SignOut,
      action: () => {
        toast.info('Open check-out workflow')
      },
    },
    {
      id: 'new-reservation',
      label: 'New Reservation',
      description: 'Create a new booking or walk-in',
      category: 'reservations',
      keywords: ['new', 'booking', 'reservation', 'walk-in'],
      shortcut: 'cmd+n',
      icon: Plus,
      action: () => {
        toast.info('Create new reservation')
      },
    },
    {
      id: 'new-guest',
      label: 'New Guest Profile',
      description: 'Add a new guest to the system',
      category: 'guests',
      keywords: ['new', 'guest', 'profile', 'customer'],
      icon: UserCirclePlus,
      action: () => {
        toast.info('Create new guest profile')
      },
    },
    {
      id: 'move-guest',
      label: 'Move Guest',
      description: 'Transfer guest to different room',
      category: 'operations',
      keywords: ['move', 'transfer', 'room change'],
      shortcut: 'cmd+m',
      icon: ArrowsClockwise,
      action: () => {
        toast.info('Move guest to another room')
      },
    },
    {
      id: 'add-charge',
      label: 'Add Charge',
      description: 'Post charge to guest folio',
      category: 'operations',
      keywords: ['charge', 'folio', 'post', 'billing'],
      shortcut: 'cmd+shift+c',
      icon: Receipt,
      action: () => {
        toast.info('Add charge to folio')
      },
    },
    {
      id: 'room-clean',
      label: 'Mark Room Clean',
      description: 'Update room status to clean',
      category: 'housekeeping',
      keywords: ['clean', 'ready', 'housekeeping'],
      icon: Bed,
      action: () => {
        toast.info('Mark room as clean')
      },
    },
    {
      id: 'room-dirty',
      label: 'Mark Room Dirty',
      description: 'Update room status to dirty',
      category: 'housekeeping',
      keywords: ['dirty', 'needs cleaning', 'housekeeping'],
      icon: Bed,
      action: () => {
        toast.info('Mark room as dirty')
      },
    },
    {
      id: 'room-maintenance',
      label: 'Mark Room Maintenance',
      description: 'Set room as out of service for maintenance',
      category: 'housekeeping',
      keywords: ['maintenance', 'out of service', 'blocked'],
      icon: Gear,
      action: () => {
        toast.info('Mark room for maintenance')
      },
    },
    {
      id: 'view-arrivals',
      label: 'View Today\'s Arrivals',
      description: 'See all expected check-ins for today',
      category: 'operations',
      keywords: ['arrivals', 'check-ins', 'today'],
      shortcut: 'cmd+a',
      icon: ListChecks,
      action: () => {
        toast.info('View arrivals')
      },
    },
    {
      id: 'view-departures',
      label: 'View Today\'s Departures',
      description: 'See all expected check-outs for today',
      category: 'operations',
      keywords: ['departures', 'check-outs', 'today'],
      shortcut: 'cmd+d',
      icon: ListChecks,
      action: () => {
        toast.info('View departures')
      },
    },
    {
      id: 'refresh-board',
      label: 'Refresh Board',
      description: 'Reload room board data',
      category: 'operations',
      keywords: ['refresh', 'reload', 'sync'],
      shortcut: 'cmd+shift+r',
      icon: ArrowsClockwise,
      action: () => {
        toast.success('Board refreshed')
      },
    },
    {
      id: 'notifications',
      label: 'View Notifications',
      description: 'Check alerts and system messages',
      category: 'operations',
      keywords: ['notifications', 'alerts', 'messages'],
      icon: Bell,
      action: () => {
        navigate?.('system-status')
      },
    },
    {
      id: 'messages',
      label: 'Guest Messages',
      description: 'View and send guest communications',
      category: 'operations',
      keywords: ['messages', 'communication', 'LINE', 'email'],
      icon: ChatCircle,
      action: () => {
        navigate?.('messaging')
      },
    },
    {
      id: 'internal-comms',
      label: 'Staff Communications',
      description: 'Internal staff messaging and channels',
      category: 'operations',
      keywords: ['staff', 'communication', 'team', 'internal', 'chat'],
      shortcut: 'cmd+shift+m',
      icon: ChatCenteredDots,
      action: () => {
        navigate?.('internal-comms')
      },
    },
    {
      id: 'guest-communications',
      label: 'Guest Communications',
      description: 'Automated guest messaging and templates',
      category: 'operations',
      keywords: ['guest', 'communication', 'email', 'SMS', 'LINE', 'templates'],
      icon: Envelope,
      action: () => {
        navigate?.('guest-communications')
      },
    },
    {
      id: 'night-audit',
      label: 'Night Audit',
      description: 'Run end-of-day processing and rollover',
      category: 'operations',
      keywords: ['night audit', 'end of day', 'rollover', 'closing'],
      icon: Moon,
      action: () => {
        navigate?.('night-audit')
      },
    },
    {
      id: 'revenue-analytics',
      label: 'Advanced Revenue Analytics',
      description: 'Detailed revenue insights and forecasting',
      category: 'reports',
      keywords: ['revenue', 'analytics', 'forecast', 'ADR', 'RevPAR'],
      icon: ChartLineUp,
      action: () => {
        navigate?.('revenue-analytics')
      },
    },
    {
      id: 'predictive-analytics',
      label: 'Predictive Analytics',
      description: 'AI-powered insights and revenue predictions',
      category: 'reports',
      keywords: ['predictive', 'AI', 'insights', 'forecast', 'machine learning'],
      shortcut: 'cmd+shift+p',
      icon: Brain,
      action: () => {
        navigate?.('predictive-analytics')
      },
    },
    {
      id: 'send-email',
      label: 'Send Email',
      description: 'Compose and send email to guest',
      category: 'operations',
      keywords: ['email', 'send', 'communication'],
      icon: EnvelopeSimple,
      action: () => {
        navigate?.('guest-communications')
      },
    },
    {
      id: 'report-occupancy',
      label: 'Occupancy Report',
      description: 'View occupancy metrics and trends',
      category: 'reports',
      keywords: ['occupancy', 'metrics', 'report'],
      icon: ChartBar,
      action: () => {
        navigate?.('reports')
      },
    },
    {
      id: 'report-revenue',
      label: 'Revenue Report',
      description: 'View revenue breakdown and analysis',
      category: 'reports',
      keywords: ['revenue', 'financial', 'report'],
      icon: ChartLineUp,
      action: () => {
        navigate?.('revenue-analytics')
      },
    },
    {
      id: 'backup-data',
      label: 'Data Backup & Export',
      description: 'Export and import system data backups',
      category: 'settings',
      keywords: ['backup', 'export', 'data', 'import', 'restore'],
      icon: Database,
      action: () => {
        navigate?.('data-backup')
      },
    },
  ]
}
