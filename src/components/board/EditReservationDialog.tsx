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
      <DialogContent className="max-w-2xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            <span>Edit Reservation - Room {room.number}</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="h-8 w-8 p-0"
            >
              <X className="w-4 h-4" />
            </Button>
          </DialogTitle>
          <DialogDescription>
            Update reservation details for Room {room.number} ({room.type})
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh] pr-4">
          <div className="space-y-6 py-2">
            <Card className="p-4 bg-muted/30">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold">Reservation ID</div>
                  <div className="text-xs font-mono text-muted-foreground mt-1">
                    {room.reservationId}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-semibold">Room Status</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {room.status.replace('_', ' ')}
                  </div>
                </div>
              </div>
            </Card>

            <div>
              <h3 className="text-sm font-semibold mb-3">Guest Information</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="firstName">First Name *</Label>
                  <Input
                    id="firstName"
                    value={formData.firstName}
                    onChange={(e) => setFormData(prev => ({ ...prev, firstName: e.target.value }))}
                    placeholder="John"
                    className="mt-1.5"
                  />
                </div>
                <div>
                  <Label htmlFor="lastName">Last Name *</Label>
                  <Input
                    id="lastName"
                    value={formData.lastName}
                    onChange={(e) => setFormData(prev => ({ ...prev, lastName: e.target.value }))}
                    placeholder="Doe"
                    className="mt-1.5"
                  />
                </div>
                <div>
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
                    placeholder="john.doe@example.com"
                    className="mt-1.5"
                  />
                </div>
                <div>
                  <Label htmlFor="phone">Phone</Label>
                  <Input
                    id="phone"
                    value={formData.phone}
                    onChange={(e) => setFormData(prev => ({ ...prev, phone: e.target.value }))}
                    placeholder="+66 123 456 789"
                    className="mt-1.5"
                  />
                </div>
              </div>
            </div>

            <Separator />

            <div>
              <h3 className="text-sm font-semibold mb-3">Stay Details</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Check-in Date *</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className={cn(
                          "w-full justify-start text-left font-normal mt-1.5",
                          !checkIn && "text-muted-foreground"
                        )}
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
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
                  <Label>Check-out Date *</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className={cn(
                          "w-full justify-start text-left font-normal mt-1.5",
                          !checkOut && "text-muted-foreground"
                        )}
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
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
                  <Label htmlFor="guestCount">Number of Guests</Label>
                  <Select
                    value={formData.guestCount.toString()}
                    onValueChange={(value) => setFormData(prev => ({ ...prev, guestCount: parseInt(value) }))}
                  >
                    <SelectTrigger className="mt-1.5">
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
                  <Label htmlFor="ratePerNight">Rate per Night (฿)</Label>
                  <Input
                    id="ratePerNight"
                    type="number"
                    value={formData.ratePerNight}
                    onChange={(e) => setFormData(prev => ({ ...prev, ratePerNight: parseFloat(e.target.value) || 0 }))}
                    className="mt-1.5"
                  />
                </div>
              </div>

              {nights > 0 && (
                <Card className="mt-4 p-4 bg-primary/5 border-primary/20">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-semibold text-primary">Total Amount</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {nights} {nights === 1 ? 'night' : 'nights'} × ฿{formData.ratePerNight.toLocaleString()}
                      </div>
                    </div>
                    <div className="text-2xl font-bold text-primary">
                      ฿{totalAmount.toLocaleString()}
                    </div>
                  </div>
                </Card>
              )}
            </div>

            <Separator />

            <div>
              <h3 className="text-sm font-semibold mb-3">Payment Details</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="depositStatus">Deposit Status</Label>
                  <Select
                    value={formData.depositStatus}
                    onValueChange={(value: any) => setFormData(prev => ({ ...prev, depositStatus: value }))}
                  >
                    <SelectTrigger className="mt-1.5">
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
                  <Label htmlFor="balanceDue">Balance Due (฿)</Label>
                  <Input
                    id="balanceDue"
                    type="number"
                    value={formData.balanceDue}
                    onChange={(e) => setFormData(prev => ({ ...prev, balanceDue: parseFloat(e.target.value) || 0 }))}
                    className="mt-1.5"
                  />
                </div>
              </div>
            </div>

            <Separator />

            <div>
              <h3 className="text-sm font-semibold mb-3">Additional Options</h3>
              <div className="space-y-3">
                <div className="flex items-center justify-between p-3 rounded-lg border bg-card">
                  <div>
                    <div className="text-sm font-medium">VIP Guest</div>
                    <div className="text-xs text-muted-foreground">Mark this guest as VIP</div>
                  </div>
                  <Button
                    variant={formData.isVIP ? "default" : "outline"}
                    size="sm"
                    onClick={() => setFormData(prev => ({ ...prev, isVIP: !prev.isVIP }))}
                  >
                    {formData.isVIP ? 'VIP' : 'Standard'}
                  </Button>
                </div>

                <div>
                  <Label htmlFor="specialRequests">Special Requests</Label>
                  <Textarea
                    id="specialRequests"
                    value={formData.specialRequests}
                    onChange={(e) => setFormData(prev => ({ ...prev, specialRequests: e.target.value }))}
                    placeholder="Any special requirements or notes..."
                    className="mt-1.5 min-h-[80px]"
                  />
                </div>
              </div>
            </div>
          </div>
        </ScrollArea>

        <DialogFooter className="flex items-center justify-between">
          <div>
            {onDelete && (
              <Button
                variant="destructive"
                onClick={handleDelete}
                className="gap-2"
              >
                <Trash className="w-4 h-4" />
                Delete Reservation
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={handleUpdate} className="gap-2">
              <FloppyDisk className="w-4 h-4" />
              Save Changes
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
