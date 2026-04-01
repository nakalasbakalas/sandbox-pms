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
import { Calendar as CalendarIcon, Plus } from '@phosphor-icons/react'
import { format, addDays, differenceInDays } from 'date-fns'
import { toast } from 'sonner'
import type { BookingSource } from '@/types'

interface Guest {
  id: string
  propertyId: string
  firstName: string
  lastName: string
  email?: string | null
  phone?: string | null
  nationality?: string | null
  idType?: string | null
  idNumber?: string | null
  dateOfBirth?: Date | null
  vipStatus: boolean
  blacklisted: boolean
  cautionFlag: boolean
  preferences?: Record<string, unknown> | null
  notes?: string | null
  createdAt: Date
  updatedAt: Date
}

interface ReservationData {
  id: string
  propertyId: string
  guestId: string
  roomTypeId: string
  assignedRoomId: string | null
  status: 'CONFIRMED'
  source: BookingSource
  channelRef: string | null
  checkIn: Date
  checkOut: Date
  actualCheckIn: Date | null
  actualCheckOut: Date | null
  adults: number
  children: number
  childAges: number[] | null
  ratePerNight: number
  totalAmount: number
  depositAmount: number
  depositPaid: boolean
  specialRequests: string | null
  notes: string | null
  createdAt: Date
  updatedAt: Date
  guest: Guest
  roomTypeName: string
  roomNumber?: string
}

interface NewReservationDialogProps {
  open: boolean
  onClose: () => void
  onSubmit: (reservation: ReservationData) => void
  prefilledData?: {
    roomId?: string
    roomNumber?: string
    roomType?: 'TWIN' | 'DOUBLE'
    checkIn?: Date
  } | null
}

export function NewReservationDialog({ open, onClose, onSubmit, prefilledData }: NewReservationDialogProps) {
  const [checkIn, setCheckIn] = useState<Date>(addDays(new Date(), 1))
  const [checkOut, setCheckOut] = useState<Date>(addDays(new Date(), 2))
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    roomType: 'TWIN' as 'TWIN' | 'DOUBLE',
    adults: 1,
    children: 0,
    ratePerNight: 1500,
    source: 'DIRECT' as BookingSource,
    specialRequests: '',
  })

  useEffect(() => {
    if (prefilledData) {
      if (prefilledData.roomType) {
        setFormData(prev => ({ ...prev, roomType: prefilledData.roomType! }))
      }
      if (prefilledData.checkIn) {
        setCheckIn(prefilledData.checkIn)
        setCheckOut(addDays(prefilledData.checkIn, 1))
      }
    }
  }, [prefilledData])

  const nights = differenceInDays(checkOut, checkIn)
  const totalAmount = nights * formData.ratePerNight
  const depositAmount = Math.floor(totalAmount * 0.3)

  const handleSubmit = () => {
    if (!formData.firstName || !formData.lastName) {
      toast.error('Please fill in guest name')
      return
    }

    const guest: Guest = {
      id: `guest-${Date.now()}`,
      propertyId: 'prop-1',
      firstName: formData.firstName,
      lastName: formData.lastName,
      email: formData.email || null,
      phone: formData.phone || null,
      nationality: null,
      idType: null,
      idNumber: null,
      dateOfBirth: null,
      vipStatus: false,
      blacklisted: false,
      cautionFlag: false,
      preferences: null,
      notes: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    const reservation: ReservationData = {
      id: `RES-${Date.now()}`,
      propertyId: 'prop-1',
      guestId: guest.id,
      roomTypeId: formData.roomType === 'TWIN' ? 'rt-1' : 'rt-2',
      assignedRoomId: prefilledData?.roomId || null,
      status: 'CONFIRMED',
      source: formData.source,
      channelRef: null,
      checkIn,
      checkOut,
      actualCheckIn: null,
      actualCheckOut: null,
      adults: formData.adults,
      children: formData.children,
      childAges: null,
      ratePerNight: formData.ratePerNight,
      totalAmount,
      depositAmount,
      depositPaid: false,
      specialRequests: formData.specialRequests || null,
      notes: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      guest,
      roomTypeName: formData.roomType === 'TWIN' ? 'Twin Room' : 'Double Room',
      roomNumber: prefilledData?.roomNumber,
    }

    onSubmit(reservation)
    
    setFormData({
      firstName: '',
      lastName: '',
      email: '',
      phone: '',
      roomType: 'TWIN',
      adults: 1,
      children: 0,
      ratePerNight: 1500,
      source: 'DIRECT',
      specialRequests: '',
    })
    setCheckIn(addDays(new Date(), 1))
    setCheckOut(addDays(new Date(), 2))
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl p-4">
        <DialogHeader className="pb-2">
          <DialogTitle className="text-base">New Reservation</DialogTitle>
          <DialogDescription className="text-xs">
            Create a new booking
            {prefilledData?.roomNumber && ` for Room ${prefilledData.roomNumber}`}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[65vh] pr-3">
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="firstName" className="text-xs">First Name *</Label>
                <Input
                  id="firstName"
                  value={formData.firstName}
                  onChange={(e) => setFormData(prev => ({ ...prev, firstName: e.target.value }))}
                  className="mt-1 h-8 text-sm"
                />
              </div>
              <div>
                <Label htmlFor="lastName" className="text-xs">Last Name *</Label>
                <Input
                  id="lastName"
                  value={formData.lastName}
                  onChange={(e) => setFormData(prev => ({ ...prev, lastName: e.target.value }))}
                  className="mt-1 h-8 text-sm"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="email" className="text-xs">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
                  className="mt-1 h-8 text-sm"
                />
              </div>
              <div>
                <Label htmlFor="phone" className="text-xs">Phone</Label>
                <Input
                  id="phone"
                  value={formData.phone}
                  onChange={(e) => setFormData(prev => ({ ...prev, phone: e.target.value }))}
                  className="mt-1 h-8 text-sm"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Check-in Date</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full mt-1 h-8 justify-start text-xs">
                      <CalendarIcon className="mr-1.5 h-3.5 w-3.5" />
                      {format(checkIn, 'MMM d, yyyy')}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0">
                    <Calendar
                      mode="single"
                      selected={checkIn}
                      onSelect={(date) => date && setCheckIn(date)}
                      disabled={(date) => date < new Date()}
                    />
                  </PopoverContent>
                </Popover>
              </div>
              <div>
                <Label className="text-xs">Check-out Date</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full mt-1 h-8 justify-start text-xs">
                      <CalendarIcon className="mr-1.5 h-3.5 w-3.5" />
                      {format(checkOut, 'MMM d, yyyy')}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0">
                    <Calendar
                      mode="single"
                      selected={checkOut}
                      onSelect={(date) => date && setCheckOut(date)}
                      disabled={(date) => date <= checkIn}
                    />
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label htmlFor="roomType" className="text-xs">Room Type</Label>
                <Select value={formData.roomType} onValueChange={(v) => setFormData(prev => ({ ...prev, roomType: v as 'TWIN' | 'DOUBLE' }))}>
                  <SelectTrigger id="roomType" className="mt-1 h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="TWIN">Twin Room</SelectItem>
                    <SelectItem value="DOUBLE">Double Room</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="adults" className="text-xs">Adults</Label>
                <Input
                  id="adults"
                  type="number"
                  min="1"
                  value={formData.adults}
                  onChange={(e) => setFormData(prev => ({ ...prev, adults: parseInt(e.target.value) || 1 }))}
                  className="mt-1 h-8 text-sm"
                />
              </div>
              <div>
                <Label htmlFor="children" className="text-xs">Children</Label>
                <Input
                  id="children"
                  type="number"
                  min="0"
                  value={formData.children}
                  onChange={(e) => setFormData(prev => ({ ...prev, children: parseInt(e.target.value) || 0 }))}
                  className="mt-1 h-8 text-sm"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="ratePerNight" className="text-xs">Rate per Night (฿)</Label>
                <Input
                  id="ratePerNight"
                  type="number"
                  min="0"
                  value={formData.ratePerNight}
                  onChange={(e) => setFormData(prev => ({ ...prev, ratePerNight: parseInt(e.target.value) || 0 }))}
                  className="mt-1 h-8 text-sm"
                />
              </div>
              <div>
                <Label htmlFor="source" className="text-xs">Booking Source</Label>
                <Select value={formData.source} onValueChange={(v) => setFormData(prev => ({ ...prev, source: v as BookingSource }))}>
                  <SelectTrigger id="source" className="mt-1 h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="DIRECT">Direct</SelectItem>
                    <SelectItem value="BOOKING_COM">Booking.com</SelectItem>
                    <SelectItem value="AGODA">Agoda</SelectItem>
                    <SelectItem value="EXPEDIA">Expedia</SelectItem>
                    <SelectItem value="AIRBNB">Airbnb</SelectItem>
                    <SelectItem value="WALK_IN">Walk-in</SelectItem>
                    <SelectItem value="PHONE">Phone</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label htmlFor="specialRequests" className="text-xs">Special Requests</Label>
              <Textarea
                id="specialRequests"
                value={formData.specialRequests}
                onChange={(e) => setFormData(prev => ({ ...prev, specialRequests: e.target.value }))}
                className="mt-1 text-sm min-h-[60px]"
                rows={2}
                placeholder="Any special requests from the guest..."
              />
            </div>

            <Card className="p-2.5 bg-muted">
              <h4 className="font-semibold mb-1.5 text-xs">Booking Summary</h4>
              <div className="space-y-0.5 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Nights:</span>
                  <span className="font-medium">{nights}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Rate per Night:</span>
                  <span className="font-medium">฿{formData.ratePerNight.toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-sm font-semibold pt-1 border-t">
                  <span>Total Amount:</span>
                  <span>฿{totalAmount.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Deposit (30%):</span>
                  <span className="font-medium">฿{depositAmount.toLocaleString()}</span>
                </div>
              </div>
            </Card>
          </div>
        </ScrollArea>

        <DialogFooter className="pt-3">
          <Button variant="outline" onClick={onClose} className="h-8 text-xs">Cancel</Button>
          <Button onClick={handleSubmit} className="h-8 text-xs">
            <Plus className="w-3.5 h-3.5 mr-1.5" weight="bold" />
            Create Reservation
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
