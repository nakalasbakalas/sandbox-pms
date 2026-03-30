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
        <Button variant="outline" size="sm" className="h-8 gap-2">
          <Funnel className="w-3.5 h-3.5" />
          <span className="text-xs">Filters</span>
          {activeCount > 0 && (
            <Badge variant="secondary" className="h-4 w-4 p-0 text-[9px] flex items-center justify-center">
              {activeCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold">Board Filters</h4>
            {!allEnabled && (
              <Button
                variant="ghost"
                size="sm"
                onClick={resetFilters}
                className="h-7 text-xs"
              >
                Reset All
              </Button>
            )}
          </div>

          <Separator />

          <div className="space-y-3">
            <div className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground">Status</div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="arrivals" className="text-xs font-normal cursor-pointer">
                    Arrivals Today
                  </Label>
                  <Switch
                    id="arrivals"
                    checked={filters.showArrivals}
                    onCheckedChange={(checked) => updateFilter('showArrivals', checked)}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="departures" className="text-xs font-normal cursor-pointer">
                    Departures Today
                  </Label>
                  <Switch
                    id="departures"
                    checked={filters.showDepartures}
                    onCheckedChange={(checked) => updateFilter('showDepartures', checked)}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="occupied" className="text-xs font-normal cursor-pointer">
                    Occupied Rooms
                  </Label>
                  <Switch
                    id="occupied"
                    checked={filters.showOccupied}
                    onCheckedChange={(checked) => updateFilter('showOccupied', checked)}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="vacant" className="text-xs font-normal cursor-pointer">
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

            <div className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground">Conditions</div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="dirty" className="text-xs font-normal cursor-pointer">
                    Dirty Rooms
                  </Label>
                  <Switch
                    id="dirty"
                    checked={filters.showDirty}
                    onCheckedChange={(checked) => updateFilter('showDirty', checked)}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="vip" className="text-xs font-normal cursor-pointer">
                    VIP Guests
                  </Label>
                  <Switch
                    id="vip"
                    checked={filters.showVIP}
                    onCheckedChange={(checked) => updateFilter('showVIP', checked)}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="issues" className="text-xs font-normal cursor-pointer">
                    Room Issues
                  </Label>
                  <Switch
                    id="issues"
                    checked={filters.showIssues}
                    onCheckedChange={(checked) => updateFilter('showIssues', checked)}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="deposit" className="text-xs font-normal cursor-pointer">
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
