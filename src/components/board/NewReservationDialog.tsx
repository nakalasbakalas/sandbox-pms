import { useState, useEffect, useMemo } from 'react'
import { useKV } from '@github/spark/hooks'
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
import { ArrowRight, Bed, Calendar as CalendarIcon, CurrencyCircleDollar, NotePencil, Plus, SpinnerGap, User } from '@phosphor-icons/react'
import { format, addDays, startOfDay } from 'date-fns'
import { toast } from 'sonner'
import type { BookingSource } from '@/types'
import type { PropertySetup } from '@/types/onboarding'
import { calculateStayPricing, nightsBetween, SANDBOX_HOTEL_RULES } from '@/lib/hotel/business-rules'

export interface NewReservationGuest {
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

export interface NewReservationData {
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
  guest: NewReservationGuest
  roomTypeName: string
  roomNumber?: string
}

interface NewReservationDialogProps {
  open: boolean
  onClose: () => void
  onSubmit: (reservation: NewReservationData) => void | Promise<void>
  prefilledData?: {
    roomId?: string
    roomNumber?: string
    roomType?: 'TWIN' | 'DOUBLE'
    checkIn?: Date
  } | null
}

type ReservationRoomTypeCode = 'TWIN' | 'DOUBLE'

interface ReservationRoomTypeOption {
  code: ReservationRoomTypeCode
  id: string
  name: string
  baseRate: number
  baseOccupancy: number
  maxOccupancy: number
  extraGuestFee: number
  childFee: number
}

interface ReservationFormState {
  firstName: string
  lastName: string
  email: string
  phone: string
  roomType: ReservationRoomTypeCode
  adults: number
  children: number
  ratePerNight: number
  source: BookingSource
  specialRequests: string
}

const STAY_LENGTH_PRESETS = [1, 2, 3, 7]

const BOOKING_SOURCE_OPTIONS: Array<{ value: BookingSource; label: string }> = [
  { value: 'DIRECT', label: 'Direct' },
  { value: 'BOOKING_COM', label: 'Booking.com' },
  { value: 'AGODA', label: 'Agoda' },
  { value: 'EXPEDIA', label: 'Expedia' },
  { value: 'AIRBNB', label: 'Airbnb' },
  { value: 'WALK_IN', label: 'Walk-in' },
  { value: 'PHONE', label: 'Phone' },
]

function getDefaultCheckInDate() {
  return addDays(startOfDay(new Date()), 1)
}

function getDefaultCheckOutDate(checkIn = getDefaultCheckInDate()) {
  return addDays(checkIn, 1)
}

function createInitialFormData(roomType?: ReservationRoomTypeOption): ReservationFormState {
  return {
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    roomType: roomType?.code || 'TWIN',
    adults: 1,
    children: 0,
    ratePerNight: roomType?.baseRate || 0,
    source: 'DIRECT',
    specialRequests: '',
  }
}

function parseNonNegativeInteger(value: string, fallback: number) {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(0, parsed)
}

function parsePositiveInteger(value: string, fallback: number) {
  return Math.max(1, parseNonNegativeInteger(value, fallback))
}

export function NewReservationDialog({ open, onClose, onSubmit, prefilledData }: NewReservationDialogProps) {
  const [configuredRoomTypes] = useKV<Array<{
    id: string
    code?: 'TWIN' | 'DOUBLE'
    name: string
    baseRate: number
    baseOccupancy?: number
    maxOccupancy?: number
    extraGuestFee?: number
    childFee?: number
  }>>('room-types-config', [])
  const [propertyData] = useKV<PropertySetup>('onboarding-property', {} as PropertySetup)
  const [checkIn, setCheckIn] = useState<Date>(() => getDefaultCheckInDate())
  const [checkOut, setCheckOut] = useState<Date>(() => getDefaultCheckOutDate())
  const [formData, setFormData] = useState<ReservationFormState>(() => createInitialFormData())
  const [isSubmitting, setIsSubmitting] = useState(false)

  const roomTypeOptions = useMemo<ReservationRoomTypeOption[]>(() => {
    if (configuredRoomTypes.length === 0) {
      return [
        { code: 'TWIN' as const, id: 'twin', name: 'Standard Twin', baseRate: 2000, baseOccupancy: 2, maxOccupancy: 2, extraGuestFee: 300, childFee: 300 },
        { code: 'DOUBLE' as const, id: 'double', name: 'Superior Double', baseRate: 2000, baseOccupancy: 2, maxOccupancy: 4, extraGuestFee: 300, childFee: 300 },
      ]
    }

    return configuredRoomTypes.map((roomType, index) => {
      const code = roomType.code || (roomType.name.toLowerCase().includes('double') || roomType.id.toLowerCase().includes('double') || index === 1 ? 'DOUBLE' : 'TWIN') as 'TWIN' | 'DOUBLE'
      return {
        code,
        id: roomType.id,
        name: roomType.name,
        baseRate: Number(roomType.baseRate || 0),
        baseOccupancy: Number(roomType.baseOccupancy || 2),
        maxOccupancy: Number(roomType.maxOccupancy || 2),
        extraGuestFee: Number(roomType.extraGuestFee || 300),
        childFee: Number(roomType.childFee || 300),
      }
    })
  }, [configuredRoomTypes])

  const selectedRoomType = roomTypeOptions.find((roomType) => roomType.code === formData.roomType) || roomTypeOptions[0]
  const currency = propertyData?.currency?.trim() || 'THB'
  const today = startOfDay(new Date())

  const handleRoomTypeChange = (value: ReservationRoomTypeCode) => {
    const nextRoomType = roomTypeOptions.find((roomType) => roomType.code === value)
    setFormData((current) => ({
      ...current,
      roomType: value,
      ratePerNight: nextRoomType?.baseRate || 0,
    }))
  }

  const handleCheckInChange = (date: Date | undefined) => {
    if (!date) return

    const nextCheckIn = startOfDay(date)
    const currentStayLength = Math.max(1, nightsBetween(checkIn, checkOut))
    setCheckIn(nextCheckIn)
    setCheckOut(addDays(nextCheckIn, currentStayLength))
  }

  const handleCheckOutChange = (date: Date | undefined) => {
    if (!date) return
    setCheckOut(startOfDay(date))
  }

  const applyStayLength = (stayLength: number) => {
    setCheckOut(addDays(checkIn, stayLength))
  }

  useEffect(() => {
    if (prefilledData) {
      if (prefilledData.roomType) {
        const nextRoomType = roomTypeOptions.find((roomType) => roomType.code === prefilledData.roomType)
        setFormData(prev => ({
          ...prev,
          roomType: prefilledData.roomType as ReservationRoomTypeCode,
          ratePerNight: nextRoomType?.baseRate || 0,
        }))
      }
      if (prefilledData.checkIn) {
        const nextCheckIn = startOfDay(prefilledData.checkIn)
        setCheckIn(nextCheckIn)
        setCheckOut(addDays(nextCheckIn, 1))
      }
    }
  }, [prefilledData, roomTypeOptions])

  useEffect(() => {
    if (!open) return

    setFormData((current) => {
      const selected = roomTypeOptions.find((roomType) => roomType.code === current.roomType) || roomTypeOptions[0]
      if (!selected) return current
      if (current.roomType === selected.code && current.ratePerNight > 0) return current
      return {
        ...current,
        roomType: selected.code,
        ratePerNight: selected.baseRate,
      }
    })
  }, [open, roomTypeOptions])

  const nights = nightsBetween(checkIn, checkOut)
  const pricing = calculateStayPricing({
    checkIn,
    checkOut,
    ratePerNight: formData.ratePerNight,
    adults: formData.adults,
    childAges: Array.from({ length: formData.children }, () => 0),
    standardOccupancy: selectedRoomType?.baseOccupancy,
    maxOccupancy: selectedRoomType?.maxOccupancy,
    extraGuestFeePerNight: selectedRoomType?.extraGuestFee,
    childSharingFeePerNight: selectedRoomType?.childFee,
  })
  const totalAmount = pricing.total
  const depositAmount = Math.floor(totalAmount * 0.3)
  const guestCount = formData.adults + formData.children
  const occupancyLimit = selectedRoomType?.maxOccupancy || SANDBOX_HOTEL_RULES.maxOccupancy

  const handleSubmit = async () => {
    if (isSubmitting) return

    const firstName = formData.firstName.trim()
    const lastName = formData.lastName.trim()
    const email = formData.email.trim()
    const phone = formData.phone.trim()

    if (!firstName || !lastName) {
      toast.error('Enter the guest first and last name.')
      return
    }

    if (nights <= 0) {
      toast.error('Check-out date must be after check-in date.')
      return
    }

    if (formData.adults < 1) {
      toast.error('At least one adult is required.')
      return
    }

    if (!selectedRoomType) {
      toast.error('Configure room types and base rates before creating reservations.')
      return
    }

    if (guestCount > (selectedRoomType?.maxOccupancy || SANDBOX_HOTEL_RULES.maxOccupancy)) {
      toast.error(`Maximum occupancy is ${selectedRoomType?.maxOccupancy || SANDBOX_HOTEL_RULES.maxOccupancy} guests per room.`)
      return
    }

    if (formData.ratePerNight <= 0) {
      toast.error('Enter a valid tax-inclusive room rate.')
      return
    }

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast.error('Enter a valid guest email address.')
      return
    }

    if (phone && phone.replace(/\D/g, '').length < 7) {
      toast.error('Enter a valid guest phone number.')
      return
    }

    setIsSubmitting(true)

    const guest: NewReservationGuest = {
      id: `guest-${Date.now()}`,
      propertyId: 'prop-1',
      firstName,
      lastName,
      email: email || null,
      phone: phone || null,
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

    const reservation: NewReservationData = {
      id: `RES-${Date.now()}`,
      propertyId: 'prop-1',
      guestId: guest.id,
      roomTypeId: selectedRoomType?.id || formData.roomType.toLowerCase(),
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
      specialRequests: formData.specialRequests.trim() || null,
      notes: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      guest,
      roomTypeName: selectedRoomType?.name || formData.roomType,
      roomNumber: prefilledData?.roomNumber,
    }

    try {
      await onSubmit(reservation)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Reservation could not be created.')
      setIsSubmitting(false)
      return
    }
    
    setFormData(createInitialFormData(roomTypeOptions[0]))
    const nextCheckIn = getDefaultCheckInDate()
    setCheckIn(nextCheckIn)
    setCheckOut(getDefaultCheckOutDate(nextCheckIn))
    setIsSubmitting(false)
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="h-[calc(100vh-2rem)] max-w-[calc(100vw-2rem)] grid-rows-[auto,minmax(0,1fr),auto] gap-0 overflow-hidden p-0 sm:max-w-[min(1120px,calc(100vw-2rem))] lg:h-[min(900px,calc(100vh-2rem))]">
        <DialogHeader className="border-b px-6 py-5 pr-14">
          <DialogTitle className="text-xl">New Reservation</DialogTitle>
          <DialogDescription>
            Create a new booking
            {prefilledData?.roomNumber && ` for Room ${prefilledData.roomNumber}`}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="h-full min-h-0">
          <form id="new-reservation-form" onSubmit={(event) => { event.preventDefault(); void handleSubmit() }}>
            <div className="grid gap-5 p-6 lg:grid-cols-[minmax(0,1fr)_340px]">
              <div className="space-y-5">
                <section className="space-y-4">
                  <div className="flex items-center gap-2">
                    <User size={18} weight="bold" className="text-primary" />
                    <h3 className="text-sm font-semibold">Guest</h3>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <Label htmlFor="firstName" className="text-sm">First Name *</Label>
                      <Input
                        id="firstName"
                        autoFocus
                        autoComplete="given-name"
                        value={formData.firstName}
                        onChange={(e) => setFormData(prev => ({ ...prev, firstName: e.target.value }))}
                        className="mt-2 h-11 text-base md:text-sm"
                      />
                    </div>
                    <div>
                      <Label htmlFor="lastName" className="text-sm">Last Name *</Label>
                      <Input
                        id="lastName"
                        autoComplete="family-name"
                        value={formData.lastName}
                        onChange={(e) => setFormData(prev => ({ ...prev, lastName: e.target.value }))}
                        className="mt-2 h-11 text-base md:text-sm"
                      />
                    </div>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <Label htmlFor="email" className="text-sm">Email</Label>
                      <Input
                        id="email"
                        type="email"
                        autoComplete="email"
                        value={formData.email}
                        onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
                        className="mt-2 h-11 text-base md:text-sm"
                      />
                    </div>
                    <div>
                      <Label htmlFor="phone" className="text-sm">Phone</Label>
                      <Input
                        id="phone"
                        type="tel"
                        autoComplete="tel"
                        value={formData.phone}
                        onChange={(e) => setFormData(prev => ({ ...prev, phone: e.target.value }))}
                        className="mt-2 h-11 text-base md:text-sm"
                      />
                    </div>
                  </div>
                </section>

                <Separator />

                <section className="space-y-4">
                  <div className="flex items-center gap-2">
                    <CalendarIcon size={18} weight="bold" className="text-primary" />
                    <h3 className="text-sm font-semibold">Stay Dates</h3>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <Label className="text-sm">Check-in Date</Label>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button variant="outline" className="mt-2 h-11 w-full justify-start text-left text-sm">
                            <CalendarIcon className="mr-2 h-4 w-4" />
                            {format(checkIn, 'EEE, MMM d, yyyy')}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0">
                          <Calendar
                            mode="single"
                            selected={checkIn}
                            onSelect={handleCheckInChange}
                            disabled={(date) => startOfDay(date) < today}
                          />
                        </PopoverContent>
                      </Popover>
                    </div>
                    <div>
                      <Label className="text-sm">Check-out Date</Label>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button variant="outline" className="mt-2 h-11 w-full justify-start text-left text-sm">
                            <CalendarIcon className="mr-2 h-4 w-4" />
                            {format(checkOut, 'EEE, MMM d, yyyy')}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0">
                          <Calendar
                            mode="single"
                            selected={checkOut}
                            onSelect={handleCheckOutChange}
                            disabled={(date) => startOfDay(date) <= startOfDay(checkIn)}
                          />
                        </PopoverContent>
                      </Popover>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {STAY_LENGTH_PRESETS.map((stayLength) => (
                      <Button
                        key={stayLength}
                        type="button"
                        variant={nights === stayLength ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => applyStayLength(stayLength)}
                      >
                        {stayLength} {stayLength === 1 ? 'night' : 'nights'}
                      </Button>
                    ))}
                  </div>
                </section>

                <Separator />

                <section className="space-y-4">
                  <div className="flex items-center gap-2">
                    <Bed size={18} weight="bold" className="text-primary" />
                    <h3 className="text-sm font-semibold">Room & Rate</h3>
                  </div>
                  {prefilledData?.roomNumber && (
                    <div className="rounded-md border bg-muted/60 px-3 py-2 text-sm">
                      Room {prefilledData.roomNumber} is selected from the board.
                    </div>
                  )}
                  <div className="grid gap-4 md:grid-cols-[minmax(180px,1.2fr)_110px_110px]">
                    <div>
                      <Label htmlFor="roomType" className="text-sm">Room Type</Label>
                      <Select value={formData.roomType} onValueChange={(v) => handleRoomTypeChange(v as ReservationRoomTypeCode)}>
                        <SelectTrigger id="roomType" className="mt-2 h-11 w-full text-sm">
                          <SelectValue placeholder="Select room type" />
                        </SelectTrigger>
                        <SelectContent>
                          {roomTypeOptions.map((roomType) => (
                            <SelectItem key={roomType.id} value={roomType.code}>{roomType.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label htmlFor="adults" className="text-sm">Adults</Label>
                      <Input
                        id="adults"
                        type="number"
                        min="1"
                        inputMode="numeric"
                        value={formData.adults}
                        onChange={(e) => setFormData(prev => ({ ...prev, adults: parsePositiveInteger(e.target.value, prev.adults) }))}
                        className="mt-2 h-11 text-base md:text-sm"
                      />
                    </div>
                    <div>
                      <Label htmlFor="children" className="text-sm">Children</Label>
                      <Input
                        id="children"
                        type="number"
                        min="0"
                        inputMode="numeric"
                        value={formData.children}
                        onChange={(e) => setFormData(prev => ({ ...prev, children: parseNonNegativeInteger(e.target.value, prev.children) }))}
                        className="mt-2 h-11 text-base md:text-sm"
                      />
                    </div>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <Label htmlFor="ratePerNight" className="text-sm">Rate per Night ({currency})</Label>
                      <Input
                        id="ratePerNight"
                        type="number"
                        min="0"
                        inputMode="decimal"
                        value={formData.ratePerNight}
                        onChange={(e) => setFormData(prev => ({ ...prev, ratePerNight: parseNonNegativeInteger(e.target.value, prev.ratePerNight) }))}
                        className="mt-2 h-11 text-base md:text-sm"
                      />
                    </div>
                    <div>
                      <Label htmlFor="source" className="text-sm">Booking Source</Label>
                      <Select value={formData.source} onValueChange={(v) => setFormData(prev => ({ ...prev, source: v as BookingSource }))}>
                        <SelectTrigger id="source" className="mt-2 h-11 w-full text-sm">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {BOOKING_SOURCE_OPTIONS.map((source) => (
                            <SelectItem key={source.value} value={source.value}>{source.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </section>

                <Separator />

                <section className="space-y-3">
                  <div className="flex items-center gap-2">
                    <NotePencil size={18} weight="bold" className="text-primary" />
                    <h3 className="text-sm font-semibold">Requests</h3>
                  </div>
                  <div>
                    <Label htmlFor="specialRequests" className="text-sm">Special Requests</Label>
                    <Textarea
                      id="specialRequests"
                      value={formData.specialRequests}
                      onChange={(e) => setFormData(prev => ({ ...prev, specialRequests: e.target.value }))}
                      className="mt-2 min-h-[96px] text-base md:text-sm"
                      rows={3}
                      placeholder="Any special requests from the guest..."
                    />
                  </div>
                </section>
              </div>

              <aside className="lg:sticky lg:top-0 lg:self-start">
                <Card className="overflow-hidden">
                  <div className="border-b bg-muted/70 px-4 py-3">
                    <h4 className="text-sm font-semibold">Booking Summary</h4>
                    <p className="text-xs text-muted-foreground">Calculated before save</p>
                  </div>
                  <div className="space-y-4 p-4">
                    <div className="rounded-md border bg-background p-3">
                      <div className="mb-2 flex items-center justify-between gap-3 text-sm font-medium">
                        <span>{format(checkIn, 'MMM d')}</span>
                        <ArrowRight size={16} className="text-muted-foreground" />
                        <span>{format(checkOut, 'MMM d')}</span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {nights} {nights === 1 ? 'night' : 'nights'} · {guestCount} {guestCount === 1 ? 'guest' : 'guests'}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <div className="text-xs text-muted-foreground">Room</div>
                        <div className="font-medium">{selectedRoomType?.name || 'Not selected'}</div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">Occupancy</div>
                        <div className="font-medium">{guestCount}/{occupancyLimit}</div>
                      </div>
                    </div>

                    <Separator />

                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between gap-3">
                        <span className="text-muted-foreground">Room subtotal</span>
                        <span className="font-medium">{currency} {pricing.roomSubtotal.toLocaleString()}</span>
                      </div>
                      {pricing.extraGuestFee > 0 && (
                        <div className="flex justify-between gap-3">
                          <span className="text-muted-foreground">Extra guest fee</span>
                          <span className="font-medium">{currency} {pricing.extraGuestFee.toLocaleString()}</span>
                        </div>
                      )}
                      {pricing.childFee > 0 && (
                        <div className="flex justify-between gap-3">
                          <span className="text-muted-foreground">Child fee</span>
                          <span className="font-medium">{currency} {pricing.childFee.toLocaleString()}</span>
                        </div>
                      )}
                      <div className="flex justify-between gap-3">
                        <span className="text-muted-foreground">Deposit (30%)</span>
                        <span className="font-medium">{currency} {depositAmount.toLocaleString()}</span>
                      </div>
                    </div>

                    <div className="rounded-md bg-primary px-4 py-3 text-primary-foreground">
                      <div className="flex items-center gap-2 text-xs opacity-90">
                        <CurrencyCircleDollar size={16} weight="bold" />
                        Total Amount
                      </div>
                      <div className="mt-1 text-2xl font-semibold">{currency} {totalAmount.toLocaleString()}</div>
                    </div>

                    {pricing.warnings.length > 0 && (
                      <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                        {pricing.warnings[0]}
                      </div>
                    )}
                  </div>
                </Card>
              </aside>
            </div>
          </form>
        </ScrollArea>

        <DialogFooter className="border-t px-6 py-4">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="new-reservation-form" disabled={isSubmitting}>
            {isSubmitting ? (
              <SpinnerGap className="h-4 w-4 animate-spin" weight="bold" />
            ) : (
              <Plus className="h-4 w-4" weight="bold" />
            )}
            {isSubmitting ? 'Creating...' : 'Create Reservation'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
