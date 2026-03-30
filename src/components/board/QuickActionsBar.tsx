import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { 
  FunnelSimple, 
  CalendarBlank,
  ArrowsOutSimple,
  ListMagnifyingGlass,
  Clock
} from '@phosphor-icons/react'

interface QuickActionsBarProps {
  viewMode: '7day' | '14day' | '30day'
  onViewModeChange: (mode: '7day' | '14day' | '30day') => void
  filterCount: number
}

export function QuickActionsBar({ viewMode, onViewModeChange, filterCount }: QuickActionsBarProps) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <Button
          variant={viewMode === '7day' ? 'default' : 'outline'}
          size="sm"
          onClick={() => onViewModeChange('7day')}
          className="h-8 text-xs"
        >
          <CalendarBlank className="w-3.5 h-3.5 mr-1.5" />
          7 Days
        </Button>
        <Button
          variant={viewMode === '14day' ? 'default' : 'outline'}
          size="sm"
          onClick={() => onViewModeChange('14day')}
          className="h-8 text-xs"
        >
          14 Days
        </Button>
        <Button
          variant={viewMode === '30day' ? 'default' : 'outline'}
          size="sm"
          onClick={() => onViewModeChange('30day')}
          className="h-8 text-xs"
        >
          30 Days
        </Button>

        <div className="h-4 w-px bg-border mx-1" />

        <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5">
          <FunnelSimple className="w-3.5 h-3.5" />
          Filters
          {filterCount > 0 && (
            <Badge variant="secondary" className="h-4 w-4 p-0 flex items-center justify-center text-[9px] ml-0.5">
              {filterCount}
            </Badge>
          )}
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" className="h-8 text-xs gap-1.5 text-muted-foreground">
          <Clock className="w-3.5 h-3.5" />
          Today: {new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
        </Button>
        
        <div className="h-4 w-px bg-border" />

        <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5">
          <ListMagnifyingGlass className="w-3.5 h-3.5" />
          Legend
        </Button>
        <Button variant="outline" size="sm" className="h-8 w-8 p-0">
          <ArrowsOutSimple className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  )
}
