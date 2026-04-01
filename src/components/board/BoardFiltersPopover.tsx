import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Funnel } from '@phosphor-icons/react'

export interface BoardFilters {
  showArrivals: boolean
  showDepartures: boolean
  showVacant: boolean
  showOccupied: boolean
  showDirty: boolean
  showVIP: boolean
  showIssues: boolean
  showDepositPending: boolean
}

interface BoardFiltersPopoverProps {
  filters: BoardFilters
  onFiltersChange: (filters: BoardFilters) => void
  activeCount: number
}

export function BoardFiltersPopover({
  filters,
  onFiltersChange,
  activeCount
}: BoardFiltersPopoverProps) {
  const updateFilter = (key: keyof BoardFilters, value: boolean) => {
    onFiltersChange({ ...filters, [key]: value })
  }

  const resetFilters = () => {
    onFiltersChange({
      showArrivals: true,
      showDepartures: true,
      showVacant: true,
      showOccupied: true,
      showDirty: true,
      showVIP: true,
      showIssues: true,
      showDepositPending: true,
    })
  }

  const allEnabled = Object.values(filters).every(v => v === true)

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-7 gap-1.5 font-bold shadow-sm hover:shadow-md">
          <Funnel className="w-3 h-3" weight="bold" />
          <span className="text-[11px]">Filters</span>
          {activeCount > 0 && (
            <Badge variant="destructive" className="h-4 w-4 p-0 text-[9px] flex items-center justify-center font-bold">
              {activeCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 shadow-xl border-2">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-extrabold tracking-tight">Board Filters</h4>
            {!allEnabled && (
              <Button
                variant="ghost"
                size="sm"
                onClick={resetFilters}
                className="h-7 text-[11px] font-bold"
              >
                Reset All
              </Button>
            )}
          </div>

          <Separator />

          <div className="space-y-4">
            <div className="space-y-3">
              <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Room Status</div>
              <div className="space-y-2">
                <div className="flex items-center justify-between p-2.5 rounded-lg hover:bg-muted/60 transition-colors border border-transparent hover:border-border">
                  <Label htmlFor="arrivals" className="text-[11px] font-semibold cursor-pointer">
                    Arrivals Today
                  </Label>
                  <Switch
                    id="arrivals"
                    checked={filters.showArrivals}
                    onCheckedChange={(checked) => updateFilter('showArrivals', checked)}
                  />
                </div>
                <div className="flex items-center justify-between p-2.5 rounded-lg hover:bg-muted/60 transition-colors border border-transparent hover:border-border">
                  <Label htmlFor="departures" className="text-[11px] font-semibold cursor-pointer">
                    Departures Today
                  </Label>
                  <Switch
                    id="departures"
                    checked={filters.showDepartures}
                    onCheckedChange={(checked) => updateFilter('showDepartures', checked)}
                  />
                </div>
                <div className="flex items-center justify-between p-2.5 rounded-lg hover:bg-muted/60 transition-colors border border-transparent hover:border-border">
                  <Label htmlFor="occupied" className="text-[11px] font-semibold cursor-pointer">
                    Occupied Rooms
                  </Label>
                  <Switch
                    id="occupied"
                    checked={filters.showOccupied}
                    onCheckedChange={(checked) => updateFilter('showOccupied', checked)}
                  />
                </div>
                <div className="flex items-center justify-between p-2.5 rounded-lg hover:bg-muted/60 transition-colors border border-transparent hover:border-border">
                  <Label htmlFor="vacant" className="text-[11px] font-semibold cursor-pointer">
                    Vacant Rooms
                  </Label>
                  <Switch
                    id="vacant"
                    checked={filters.showVacant}
                    onCheckedChange={(checked) => updateFilter('showVacant', checked)}
                  />
                </div>
              </div>
            </div>

            <Separator />

            <div className="space-y-3">
              <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Special Conditions</div>
              <div className="space-y-2">
                <div className="flex items-center justify-between p-2.5 rounded-lg hover:bg-muted/60 transition-colors border border-transparent hover:border-border">
                  <Label htmlFor="dirty" className="text-[11px] font-semibold cursor-pointer">
                    Dirty Rooms
                  </Label>
                  <Switch
                    id="dirty"
                    checked={filters.showDirty}
                    onCheckedChange={(checked) => updateFilter('showDirty', checked)}
                  />
                </div>
                <div className="flex items-center justify-between p-2.5 rounded-lg hover:bg-muted/60 transition-colors border border-transparent hover:border-border">
                  <Label htmlFor="vip" className="text-[11px] font-semibold cursor-pointer">
                    VIP Guests
                  </Label>
                  <Switch
                    id="vip"
                    checked={filters.showVIP}
                    onCheckedChange={(checked) => updateFilter('showVIP', checked)}
                  />
                </div>
                <div className="flex items-center justify-between p-2.5 rounded-lg hover:bg-muted/60 transition-colors border border-transparent hover:border-border">
                  <Label htmlFor="issues" className="text-[11px] font-semibold cursor-pointer">
                    Room Issues
                  </Label>
                  <Switch
                    id="issues"
                    checked={filters.showIssues}
                    onCheckedChange={(checked) => updateFilter('showIssues', checked)}
                  />
                </div>
                <div className="flex items-center justify-between p-2.5 rounded-lg hover:bg-muted/60 transition-colors border border-transparent hover:border-border">
                  <Label htmlFor="deposit" className="text-[11px] font-semibold cursor-pointer">
                    Pending Deposits
                  </Label>
                  <Switch
                    id="deposit"
                    checked={filters.showDepositPending}
                    onCheckedChange={(checked) => updateFilter('showDepositPending', checked)}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
