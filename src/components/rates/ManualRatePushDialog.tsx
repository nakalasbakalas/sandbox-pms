import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Checkbox } from '@/components/ui/checkbox'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { CalendarBlank, ArrowUp, CheckCircle } from '@phosphor-icons/react'
import { format } from 'date-fns'
import { cn } from '@/lib/utils'
import { useKV } from '@github/spark/hooks'
import { useRatePush } from '@/hooks/use-rate-push'
import { toast } from 'sonner'

interface ManualRatePushDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface Channel {
  id: string
  name: string
  enabled: boolean
  connected: boolean
  status: string
}

interface RoomType {
  id: string
  name: string
  baseRate: number
}

export function ManualRatePushDialog({ open, onOpenChange }: ManualRatePushDialogProps) {
  const [channels] = useKV<Channel[]>('channels', [])
  const [roomTypes] = useKV<RoomType[]>('room-types-config', [])
  const { manualPushRates } = useRatePush()

  const [dateRange, setDateRange] = useState<{ from: Date | undefined; to: Date | undefined }>({
    from: undefined,
    to: undefined
  })
  const [selectedChannels, setSelectedChannels] = useState<string[]>([])
  const [selectedRoomTypes, setSelectedRoomTypes] = useState<string[]>([])
  const [isPushing, setIsPushing] = useState(false)

  const connectedChannels = channels.filter(c => c.connected && c.enabled)

  const handleChannelToggle = (channelId: string) => {
    setSelectedChannels(prev =>
      prev.includes(channelId)
        ? prev.filter(id => id !== channelId)
        : [...prev, channelId]
    )
  }

  const handleRoomTypeToggle = (roomTypeId: string) => {
    setSelectedRoomTypes(prev =>
      prev.includes(roomTypeId)
        ? prev.filter(id => id !== roomTypeId)
        : [...prev, roomTypeId]
    )
  }

  const handleSelectAllChannels = () => {
    if (selectedChannels.length === connectedChannels.length) {
      setSelectedChannels([])
    } else {
      setSelectedChannels(connectedChannels.map(c => c.id))
    }
  }

  const handleSelectAllRoomTypes = () => {
    if (selectedRoomTypes.length === roomTypes.length) {
      setSelectedRoomTypes([])
    } else {
      setSelectedRoomTypes(roomTypes.map(rt => rt.id))
    }
  }

  const handlePushRates = async () => {
    if (!dateRange.from || !dateRange.to) {
      toast.error('Please select a date range')
      return
    }

    if (selectedChannels.length === 0) {
      toast.error('Please select at least one channel')
      return
    }

    if (selectedRoomTypes.length === 0) {
      toast.error('Please select at least one room type')
      return
    }

    setIsPushing(true)

    try {
      for (const roomTypeId of selectedRoomTypes) {
        await manualPushRates(
          roomTypeId,
          format(dateRange.from, 'yyyy-MM-dd'),
          format(dateRange.to, 'yyyy-MM-dd'),
          selectedChannels
        )
      }

      setDateRange({ from: undefined, to: undefined })
      setSelectedChannels([])
      setSelectedRoomTypes([])
      onOpenChange(false)
    } catch (error) {
      toast.error('Failed to push rates')
    } finally {
      setIsPushing(false)
    }
  }

  const isValid = dateRange.from && dateRange.to && selectedChannels.length > 0 && selectedRoomTypes.length > 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowUp className="w-5 h-5 text-primary" />
            Manual Rate Push
          </DialogTitle>
          <DialogDescription>
            Push rates to selected channels for specific dates and room types
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          <div className="space-y-3">
            <Label className="text-base font-semibold">Date Range</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    'w-full justify-start text-left font-normal',
                    !dateRange.from && 'text-muted-foreground'
                  )}
                >
                  <CalendarBlank className="mr-2 h-4 w-4" />
                  {dateRange.from ? (
                    dateRange.to ? (
                      <>
                        {format(dateRange.from, 'LLL dd, y')} - {format(dateRange.to, 'LLL dd, y')}
                      </>
                    ) : (
                      format(dateRange.from, 'LLL dd, y')
                    )
                  ) : (
                    <span>Select date range</span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="range"
                  defaultMonth={dateRange.from}
                  selected={{ from: dateRange.from, to: dateRange.to }}
                  onSelect={(range) => setDateRange({ from: range?.from, to: range?.to })}
                  numberOfMonths={2}
                />
              </PopoverContent>
            </Popover>
          </div>

          <Separator />

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-base font-semibold">
                Channels ({selectedChannels.length}/{connectedChannels.length})
              </Label>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleSelectAllChannels}
                disabled={connectedChannels.length === 0}
              >
                {selectedChannels.length === connectedChannels.length ? 'Deselect All' : 'Select All'}
              </Button>
            </div>

            {connectedChannels.length === 0 ? (
              <div className="text-center py-8 border rounded-lg bg-muted/30">
                <p className="text-sm text-muted-foreground">No channels connected</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Connect channels to push rates
                </p>
              </div>
            ) : (
              <ScrollArea className="h-32 border rounded-lg p-3">
                <div className="space-y-2">
                  {connectedChannels.map(channel => (
                    <div
                      key={channel.id}
                      className="flex items-center space-x-3 p-2 rounded-lg hover:bg-muted/50 transition-colors"
                    >
                      <Checkbox
                        id={`channel-${channel.id}`}
                        checked={selectedChannels.includes(channel.id)}
                        onCheckedChange={() => handleChannelToggle(channel.id)}
                      />
                      <Label
                        htmlFor={`channel-${channel.id}`}
                        className="flex items-center gap-2 flex-1 cursor-pointer"
                      >
                        <div className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold">
                          {channel.name.charAt(0)}
                        </div>
                        <span className="font-medium">{channel.name}</span>
                        <Badge variant="secondary" className="ml-auto">
                          <CheckCircle className="w-3 h-3 mr-1 text-green-600" />
                          Connected
                        </Badge>
                      </Label>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </div>

          <Separator />

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-base font-semibold">
                Room Types ({selectedRoomTypes.length}/{roomTypes.length})
              </Label>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleSelectAllRoomTypes}
                disabled={roomTypes.length === 0}
              >
                {selectedRoomTypes.length === roomTypes.length ? 'Deselect All' : 'Select All'}
              </Button>
            </div>

            {roomTypes.length === 0 ? (
              <div className="text-center py-8 border rounded-lg bg-muted/30">
                <p className="text-sm text-muted-foreground">No room types configured</p>
              </div>
            ) : (
              <ScrollArea className="h-32 border rounded-lg p-3">
                <div className="space-y-2">
                  {roomTypes.map(roomType => (
                    <div
                      key={roomType.id}
                      className="flex items-center space-x-3 p-2 rounded-lg hover:bg-muted/50 transition-colors"
                    >
                      <Checkbox
                        id={`room-${roomType.id}`}
                        checked={selectedRoomTypes.includes(roomType.id)}
                        onCheckedChange={() => handleRoomTypeToggle(roomType.id)}
                      />
                      <Label
                        htmlFor={`room-${roomType.id}`}
                        className="flex items-center justify-between flex-1 cursor-pointer"
                      >
                        <span className="font-medium">{roomType.name}</span>
                        <span className="text-sm text-muted-foreground">
                          Base: ฿{roomType.baseRate.toLocaleString()}
                        </span>
                      </Label>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPushing}>
            Cancel
          </Button>
          <Button onClick={handlePushRates} disabled={!isValid || isPushing}>
            <ArrowUp className="w-4 h-4 mr-2" />
            {isPushing ? 'Pushing Rates...' : 'Push Rates'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
