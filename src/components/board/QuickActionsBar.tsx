import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { 
  FunnelSimple, 
  CalendarBlank,
  Clock,
  Info
} from '@phosphor-icons/react'
import { cn } from '@/lib/utils'

interface QuickActionsBarProps {
  viewMode: '7day' | '14day' | '30day'
  onViewModeChange: (mode: '7day' | '14day' | '30day') => void
  filterCount: number
}

export function QuickActionsBar({ viewMode, onViewModeChange, filterCount }: QuickActionsBarProps) {
  return (
    <div className="flex items-center justify-between bg-card rounded px-3 py-2 border border-border">
      <div className="flex items-center gap-1.5">
        <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mr-1">
          View
        </div>
        <Button
          variant={viewMode === '7day' ? 'default' : 'ghost'}
          size="sm"
          onClick={() => onViewModeChange('7day')}
          className="h-7 text-xs font-medium px-2.5"
        >
          <CalendarBlank className="w-3 h-3 mr-1" />
          7d
        </Button>
        <Button
          variant={viewMode === '14day' ? 'default' : 'ghost'}
          size="sm"
          onClick={() => onViewModeChange('14day')}
          className="h-7 text-xs font-medium px-2.5"
        >
          14d
        </Button>
        <Button
          variant={viewMode === '30day' ? 'default' : 'ghost'}
          size="sm"
          onClick={() => onViewModeChange('30day')}
          className="h-7 text-xs font-medium px-2.5"
        >
          30d
        </Button>

        <div className="h-4 w-px bg-border mx-1" />

        <Button variant="ghost" size="sm" className="h-7 text-xs gap-1.5 font-medium px-2.5">
          <FunnelSimple className="w-3 h-3" />
          Filters
          {filterCount > 0 && (
            <Badge variant="default" className="h-3.5 min-w-3.5 px-1 flex items-center justify-center text-[9px] ml-0 font-semibold">
              {filterCount}
            </Badge>
          )}
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Clock className="w-3 h-3" />
          <span className="font-medium text-[10px]">
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
