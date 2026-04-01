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
    <div className="flex items-center justify-between bg-card rounded px-2 py-1.5 border border-border">
      <div className="flex items-center gap-1">
        <div className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wide mr-0.5">
          View
        </div>
        <Button
          variant={viewMode === '7day' ? 'default' : 'ghost'}
          size="sm"
          onClick={() => onViewModeChange('7day')}
          className="h-6 text-[11px] font-medium px-2"
        >
          <CalendarBlank className="w-2.5 h-2.5 mr-0.5" />
          7d
        </Button>
        <Button
          variant={viewMode === '14day' ? 'default' : 'ghost'}
          size="sm"
          onClick={() => onViewModeChange('14day')}
          className="h-6 text-[11px] font-medium px-2"
        >
          14d
        </Button>
        <Button
          variant={viewMode === '30day' ? 'default' : 'ghost'}
          size="sm"
          onClick={() => onViewModeChange('30day')}
          className="h-6 text-[11px] font-medium px-2"
        >
          30d
        </Button>

        <div className="h-3 w-px bg-border mx-0.5" />

        <Button variant="ghost" size="sm" className="h-6 text-[11px] gap-1 font-medium px-2">
          <FunnelSimple className="w-2.5 h-2.5" />
          Filters
          {filterCount > 0 && (
            <Badge variant="default" className="h-3 min-w-3 px-0.5 flex items-center justify-center text-[8px] ml-0 font-semibold">
              {filterCount}
            </Badge>
          )}
        </Button>

        {onOpenAutomation && (
          <>
            <div className="h-3 w-px bg-border mx-0.5" />
            <Button 
              variant="ghost" 
              size="sm" 
              className="h-6 text-[11px] gap-1 font-medium px-2"
              onClick={onOpenAutomation}
            >
              <Robot className="w-2.5 h-2.5" />
              Auto
              {automationEnabled && (
                <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
              )}
            </Button>
          </>
        )}
      </div>

      <div className="flex items-center gap-1.5">
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <Clock className="w-2.5 h-2.5" />
          <span className="font-medium text-[9px]">
            {new Date().toLocaleDateString('en-GB', { 
              day: '2-digit', 
              month: 'short',
              year: 'numeric'
            })}
          </span>
        </div>
      </div>
    </div>
  )
}
