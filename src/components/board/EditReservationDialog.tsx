import { useState, useEffect } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Card } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Calendar as CalendarIcon, X, FloppyDisk, Trash } from '@phosphor-icons/react'
import { format, differenceInDays } from 'date-fns'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import type { BoardRoomCard } from '@/types/board'
import type { BookingSource } from '@/types'

interface EditReservationDialogProps {
  open: boolean
  onClose: () => void
  room: BoardRoomCard | null
  onUpdate: (roomId: string, updates: {
    guestName?: string
    checkIn?: Date
    checkOut?: Date
    guestCount?: number
    depositStatus?: 'NONE' | 'PENDING' | 'PARTIAL' | 'PAID'
    balanceDue?: number
    isVIP?: boolean
    specialRequests?: string
  }) => void
  onDelete?: (roomId: string) => void
}

export function EditReservationDialog({ open, onClose, room, onUpdate, onDelete }: EditReservationDialogProps) {
  const [checkIn, setCheckIn] = useState<Date | undefined>(undefined)
  const [checkOut, setCheckOut] = useState<Date | undefined>(undefined)
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    guestCount: 2,
    ratePerNight: 1500,
    depositStatus: 'NONE' as 'NONE' | 'PENDING' | 'PARTIAL' | 'PAID',
    balanceDue: 0,
    isVIP: false,
    specialRequests: '',
  })

  useEffect(() => {
    if (room && open) {
      const [firstName = '', lastName = ''] = (room.guestName || ' ').split(' ')
      setCheckIn(room.checkIn)
      setCheckOut(room.checkOut)
      setFormData({
        firstName,
        lastName,
        email: '',
        phone: '',
        guestCount: room.guestCount || 2,
        ratePerNight: 1500,
        depositStatus: room.depositStatus || 'NONE',
        balanceDue: room.balanceDue || 0,
        isVIP: room.isVIP || false,
        specialRequests: '',
      })
    }
  }, [room, open])

  const handleUpdate = () => {
    if (!room) return

    if (!checkIn || !checkOut) {
      toast.error('Please select check-in and check-out dates')
      return
    }

    if (checkIn >= checkOut) {
      toast.error('Check-out must be after check-in')
      return
    }

    if (!formData.firstName.trim() || !formData.lastName.trim()) {
      toast.error('Guest name is required')
      return
    }

    const nights = differenceInDays(checkOut, checkIn)
    const totalAmount = nights * formData.ratePerNight

    onUpdate(room.roomId, {
      guestName: `${formData.firstName.trim()} ${formData.lastName.trim()}`,
      checkIn,
      checkOut,
      guestCount: formData.guestCount,
      depositStatus: formData.depositStatus,
      balanceDue: formData.balanceDue,
      isVIP: formData.isVIP,
      specialRequests: formData.specialRequests,
    })

    toast.success('Reservation updated successfully')
    onClose()
  }

  const handleDelete = () => {
    if (!room || !onDelete) return
    
    if (confirm(`Delete reservation for ${room.guestName}?`)) {
      onDelete(room.roomId)
      toast.success('Reservation deleted')
      onClose()
    }
  }

  if (!room) return null

  const nights = checkIn && checkOut ? differenceInDays(checkOut, checkIn) : 0
  const totalAmount = nights * formData.ratePerNight

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] p-4">
        <DialogHeader className="pb-2">
          <DialogTitle className="flex items-center justify-between text-base">
            <span>Edit Reservation - Room {room.number}</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="h-6 w-6 p-0"
            >
              <X className="w-3.5 h-3.5" />
            </Button>
          </DialogTitle>
          <DialogDescription className="text-xs">
            Update reservation details for Room {room.number} ({room.type})
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[65vh] pr-3">
          <div className="space-y-3 py-1">
            <Card className="p-2.5 bg-muted/30">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-semibold">Reservation ID</div>
                  <div className="text-[10px] font-mono text-muted-foreground mt-0.5">
                    {room.reservationId}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs font-semibold">Room Status</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">
                    {room.status.replace('_', ' ')}
                  </div>
                </div>
              </div>
            </Card>

            <div>
              <h3 className="text-xs font-semibold mb-2">Guest Information</h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="firstName" className="text-xs">First Name *</Label>
                  <Input
                    id="firstName"
                    value={formData.firstName}
                    onChange={(e) => setFormData(prev => ({ ...prev, firstName: e.target.value }))}
                    placeholder="Suda"
                    className="mt-1 h-8 text-sm"
                  />
                </div>
                <div>
                  <Label htmlFor="lastName" className="text-xs">Last Name *</Label>
                  <Input
                    id="lastName"
                    value={formData.lastName}
                    onChange={(e) => setFormData(prev => ({ ...prev, lastName: e.target.value }))}
                    placeholder="Prasert"
                    className="mt-1 h-8 text-sm"
                  />
                </div>
                <div>
                  <Label htmlFor="email" className="text-xs">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
                    placeholder="guest@sandboxhotel.co.th"
                    className="mt-1 h-8 text-sm"
                  />
                </div>
                <div>
                  <Label htmlFor="phone" className="text-xs">Phone</Label>
                  <Input
                    id="phone"
                    value={formData.phone}
                    onChange={(e) => setFormData(prev => ({ ...prev, phone: e.target.value }))}
                    placeholder="+66 123 456 789"
                    className="mt-1 h-8 text-sm"
                  />
                </div>
              </div>
            </div>

            <Separator className="my-2" />

            <div>
              <h3 className="text-xs font-semibold mb-2">Stay Details</h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Check-in Date *</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className={cn(
                          "w-full justify-start text-left font-normal mt-1 h-8 text-xs",
                          !checkIn && "text-muted-foreground"
                        )}
                      >
                        <CalendarIcon className="mr-1.5 h-3.5 w-3.5" />
                        {checkIn ? format(checkIn, "MMM d, yyyy") : "Select date"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={checkIn}
                        onSelect={setCheckIn}
                        disabled={(date) => date < new Date(new Date().setHours(0, 0, 0, 0))}
                      />
                    </PopoverContent>
                  </Popover>
                </div>

                <div>
                  <Label className="text-xs">Check-out Date *</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className={cn(
                          "w-full justify-start text-left font-normal mt-1 h-8 text-xs",
                          !checkOut && "text-muted-foreground"
                        )}
                      >
                        <CalendarIcon className="mr-1.5 h-3.5 w-3.5" />
                        {checkOut ? format(checkOut, "MMM d, yyyy") : "Select date"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={checkOut}
                        onSelect={setCheckOut}
                        disabled={(date) => !checkIn || date <= checkIn}
                      />
                    </PopoverContent>
                  </Popover>
                </div>

                <div>
                  <Label htmlFor="guestCount" className="text-xs">Number of Guests</Label>
                  <Select
                    value={formData.guestCount.toString()}
                    onValueChange={(value) => setFormData(prev => ({ ...prev, guestCount: parseInt(value) }))}
                  >
                    <SelectTrigger className="mt-1 h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[1, 2, 3, 4].map((count) => (
                        <SelectItem key={count} value={count.toString()}>
                          {count} {count === 1 ? 'guest' : 'guests'}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label htmlFor="ratePerNight" className="text-xs">Rate per Night (฿)</Label>
                  <Input
                    id="ratePerNight"
                    type="number"
                    value={formData.ratePerNight}
                    onChange={(e) => setFormData(prev => ({ ...prev, ratePerNight: parseFloat(e.target.value) || 0 }))}
                    className="mt-1 h-8 text-sm"
                  />
                </div>
              </div>

              {nights > 0 && (
                <Card className="mt-2.5 p-2.5 bg-primary/5 border-primary/20">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-xs font-semibold text-primary">Total Amount</div>
                      <div className="text-[10px] text-muted-foreground mt-0.5">
                        {nights} {nights === 1 ? 'night' : 'nights'} × ฿{formData.ratePerNight.toLocaleString()}
                      </div>
                    </div>
                    <div className="text-lg font-bold text-primary">
                      ฿{totalAmount.toLocaleString()}
                    </div>
                  </div>
                </Card>
              )}
            </div>

            <Separator className="my-2" />

            <div>
              <h3 className="text-xs font-semibold mb-2">Payment Details</h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="depositStatus" className="text-xs">Deposit Status</Label>
                  <Select
                    value={formData.depositStatus}
                    onValueChange={(value: any) => setFormData(prev => ({ ...prev, depositStatus: value }))}
                  >
                    <SelectTrigger className="mt-1 h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="NONE">None</SelectItem>
                      <SelectItem value="PENDING">Pending</SelectItem>
                      <SelectItem value="PARTIAL">Partial</SelectItem>
                      <SelectItem value="PAID">Paid</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label htmlFor="balanceDue" className="text-xs">Balance Due (฿)</Label>
                  <Input
                    id="balanceDue"
                    type="number"
                    value={formData.balanceDue}
                    onChange={(e) => setFormData(prev => ({ ...prev, balanceDue: parseFloat(e.target.value) || 0 }))}
                    className="mt-1 h-8 text-sm"
                  />
                </div>
              </div>
            </div>

            <Separator className="my-2" />

            <div>
              <h3 className="text-xs font-semibold mb-2">Additional Options</h3>
              <div className="space-y-2">
                <div className="flex items-center justify-between p-2 rounded-lg border bg-card">
                  <div>
                    <div className="text-xs font-medium">VIP Guest</div>
                    <div className="text-[10px] text-muted-foreground">Mark this guest as VIP</div>
                  </div>
                  <Button
                    variant={formData.isVIP ? "default" : "outline"}
                    size="sm"
                    onClick={() => setFormData(prev => ({ ...prev, isVIP: !prev.isVIP }))}
                    className="h-7 text-xs"
                  >
                    {formData.isVIP ? 'VIP' : 'Standard'}
                  </Button>
                </div>

                <div>
                  <Label htmlFor="specialRequests" className="text-xs">Special Requests</Label>
                  <Textarea
                    id="specialRequests"
                    value={formData.specialRequests}
                    onChange={(e) => setFormData(prev => ({ ...prev, specialRequests: e.target.value }))}
                    placeholder="Any special requirements or notes..."
                    className="mt-1 min-h-[60px] text-sm"
                  />
                </div>
              </div>
            </div>
          </div>
        </ScrollArea>

        <DialogFooter className="flex items-center justify-between pt-3">
          <div>
            {onDelete && (
              <Button
                variant="destructive"
                onClick={handleDelete}
                className="gap-1.5 h-8 text-xs"
              >
                <Trash className="w-3.5 h-3.5" />
                Delete Reservation
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} className="h-8 text-xs">
              Cancel
            </Button>
            <Button onClick={handleUpdate} className="gap-1.5 h-8 text-xs">
              <FloppyDisk className="w-3.5 h-3.5" />
              Save Changes
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
