import { SidebarProvider, SidebarTrigger, SidebarInset } from '@/components/ui/sidebar'
import { AppSidebar } from './AppSidebar'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Question, Command, Info } from '@phosphor-icons/react'

interface AppLayoutProps {
  children: React.ReactNode
  onOpenShortcuts?: () => void
}

export function AppLayout({ children, onOpenShortcuts }: AppLayoutProps) {
  return (
    <SidebarProvider defaultOpen={true}>
      <AppSidebar />
      <SidebarInset className="flex flex-col">
        <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border bg-background px-3">
          <SidebarTrigger className="-ml-1" />
          <div className="h-3 w-px bg-border/50" />
          <div className="flex-1" />
          {onOpenShortcuts && (
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2 text-muted-foreground hover:text-foreground"
                >
                  <Question size={18} weight="duotone" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-80" align="end">
                <div className="space-y-4">
                  <div className="space-y-2">
                    <h4 className="font-semibold flex items-center gap-2">
                      <Info size={18} weight="duotone" className="text-primary" />
                      Quick Help
                    </h4>
                    <p className="text-sm text-muted-foreground">
                      Get help and learn keyboard shortcuts for faster navigation
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    className="w-full justify-between"
                    onClick={onOpenShortcuts}
                  >
                    <span className="flex items-center gap-2">
                      <Command size={16} weight="duotone" />
                      Keyboard Shortcuts
                    </span>
                    <kbd className="pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-xs font-medium text-muted-foreground">
                      ?
                    </kbd>
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
          )}
        </header>
        <main className="flex-1 overflow-auto bg-muted/30">
          {children}
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
