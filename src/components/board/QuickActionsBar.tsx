import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { 
  FunnelSimple, 
  CalendarBlank,
  Clock,
  Info,
  Robot
} from '@phosphor-icons/react'
import { cn } from '@/lib/utils'

interface QuickActionsBarProps {
  viewMode: '7day' | '14day' | '30day'
  onViewModeChange: (mode: '7day' | '14day' | '30day') => void
  filterCount: number
  automationEnabled?: boolean
  onOpenAutomation?: () => void
}

export function QuickActionsBar({ 
  viewMode, 
  onViewModeChange, 
  filterCount,
  automationEnabled,
  onOpenAutomation 
}: QuickActionsBarProps) {
  return (
    <div className="flex items-center justify-between bg-gradient-to-r from-card via-card to-muted/20 rounded-lg px-2 py-1.5 border-2 border-border shadow-sm">
      <div className="flex items-center gap-1">
        <div className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider mr-1">
          View
        </div>
        <Button
          variant={viewMode === '7day' ? 'default' : 'ghost'}
          size="sm"
          onClick={() => onViewModeChange('7day')}
          className="h-6 text-[11px] font-semibold px-2 shadow-sm"
        >
          <CalendarBlank className="w-2.5 h-2.5 mr-1" />
          7 Days
        </Button>
        <Button
          variant={viewMode === '14day' ? 'default' : 'ghost'}
          size="sm"
          onClick={() => onViewModeChange('14day')}
          className="h-6 text-[11px] font-semibold px-2 shadow-sm"
        >
          14 Days
        </Button>
        <Button
          variant={viewMode === '30day' ? 'default' : 'ghost'}
          size="sm"
          onClick={() => onViewModeChange('30day')}
          className="h-6 text-[11px] font-semibold px-2 shadow-sm"
        >
          30 Days
        </Button>

        <div className="h-4 w-px bg-border mx-1" />

        {onOpenAutomation && (
          <>
            <Button 
              variant="ghost" 
              size="sm" 
              className="h-6 text-[11px] gap-1 font-semibold px-2"
              onClick={onOpenAutomation}
            >
              <Robot className="w-2.5 h-2.5" />
              Automation
              {automationEnabled && (
                <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              )}
            </Button>
          </>
        )}
      </div>

      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1 text-xs text-muted-foreground bg-muted/50 px-2 py-1 rounded-md">
          <Clock className="w-2.5 h-2.5" />
          <span className="font-semibold text-[9px]">
            {new Date().toLocaleDateString('en-GB', { 
              day: '2-digit', 
              month: 'short',
              year: 'numeric',
              weekday: 'short'
            })}
          </span>
        </div>
      </div>
    </div>
  )
}
