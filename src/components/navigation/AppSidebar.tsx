import { 
  SquaresFour, 
  House, 
  CalendarBlank, 
  Users, 
  Broom, 
  CurrencyDollar, 
  Receipt, 
  Broadcast, 
  ChartBar, 
  Gear,
  ChatCircle,
} from '@phosphor-icons/react'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
} from '@/components/ui/sidebar'
import { useNavigation } from '@/hooks/use-navigation'

const primaryNavItems = [
  { id: 'board', label: 'Board', icon: SquaresFour },
  { id: 'front-desk', label: 'Front Desk', icon: House },
  { id: 'reservations', label: 'Reservations', icon: CalendarBlank },
  { id: 'guests', label: 'Guests', icon: Users },
  { id: 'housekeeping', label: 'Housekeeping', icon: Broom },
  { id: 'cashier', label: 'Cashier', icon: CurrencyDollar },
  { id: 'rates', label: 'Rates', icon: Receipt },
  { id: 'channels', label: 'Channels', icon: Broadcast },
  { id: 'reports', label: 'Reports', icon: ChartBar },
  { id: 'settings', label: 'Settings', icon: Gear },
]

const secondaryNavItems = [
  { id: 'messaging', label: 'Messaging', icon: ChatCircle },
]

export function AppSidebar() {
  const { currentRoute, navigate } = useNavigation()

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
            <SquaresFour className="w-5 h-5 text-primary-foreground" weight="bold" />
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-bold text-sidebar-foreground">Sandbox Hotel</span>
            <span className="text-xs text-sidebar-foreground/60">Property Management</span>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Primary</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {primaryNavItems.map((item) => (
                <SidebarMenuItem key={item.id}>
                  <SidebarMenuButton
                    isActive={currentRoute === item.id}
                    onClick={() => navigate(item.id as any)}
                    tooltip={item.label}
                  >
                    <item.icon className="w-4 h-4" weight={currentRoute === item.id ? 'fill' : 'regular'} />
                    <span>{item.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Communication</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {secondaryNavItems.map((item) => (
                <SidebarMenuItem key={item.id}>
                  <SidebarMenuButton
                    isActive={currentRoute === item.id}
                    onClick={() => navigate(item.id as any)}
                    tooltip={item.label}
                  >
                    <item.icon className="w-4 h-4" weight={currentRoute === item.id ? 'fill' : 'regular'} />
                    <span>{item.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border p-2">
        <div className="text-xs text-sidebar-foreground/40 text-center">
          v1.0.0
        </div>
      </SidebarFooter>
    </Sidebar>
  )
}
