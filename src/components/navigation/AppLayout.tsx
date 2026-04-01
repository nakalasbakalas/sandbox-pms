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
        <header className="flex h-8 shrink-0 items-center gap-2 border-b border-border bg-background px-2">
          <SidebarTrigger className="-ml-1 h-6 w-6" />
          <div className="h-3 w-px bg-border/50" />
          <div className="flex-1" />
          {onOpenShortcuts && (
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
                >
                  <Question size={14} weight="duotone" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-72" align="end">
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <h4 className="text-sm font-semibold flex items-center gap-1.5">
                      <Info size={14} weight="duotone" className="text-primary" />
                      Quick Help
                    </h4>
                    <p className="text-xs text-muted-foreground">
                      Get help and learn keyboard shortcuts
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full justify-between h-8"
                    onClick={onOpenShortcuts}
                  >
                    <span className="flex items-center gap-1.5 text-xs">
                      <Command size={14} weight="duotone" />
                      Keyboard Shortcuts
                    </span>
                    <kbd className="pointer-events-none inline-flex h-4 select-none items-center gap-0.5 rounded border bg-muted px-1 font-mono text-[10px] font-medium text-muted-foreground">
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
