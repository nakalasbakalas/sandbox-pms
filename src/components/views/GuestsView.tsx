import { useState, useMemo, useCallback, useEffect } from 'react'
import { useKV } from '@github/spark/hooks'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { 
  MagnifyingGlass, Plus, User, EnvelopeSimple, Phone, MapPin, 
  CalendarBlank, Star, Warning, Flag, ChatCircle
} from '@phosphor-icons/react'
import { format } from 'date-fns'
import { cn } from '@/lib/utils'
import { nightsBetween } from '@/lib/hotel/business-rules'
import { pmsApi, SERVER_API_ENABLED } from '@/lib/pms-api-client'
import { toast } from 'sonner'
import { useNavigation } from '@/hooks/use-navigation'

export interface Guest {
  id: string
  firstName: string
  lastName: string
  fullName: string
  email?: string
  phone?: string
  nationality?: string
  dateOfBirth?: Date
  passportNumber?: string
  idNumber?: string
  address?: string
  
  isVIP: boolean
  tags: string[]
  preferences?: string
  notes?: string
  warnings?: string
  
  totalStays: number
  totalNights: number
  totalSpent: number
  lastStayDate?: Date
  firstStayDate: Date
  
  preferredRoomType?: 'TWIN' | 'DOUBLE'
  preferredContact?: 'EMAIL' | 'PHONE' | 'LINE'
  
  createdAt: Date
  updatedAt: Date
}

type NewGuestForm = {
  firstName: string
  lastName: string
  email: string
  phone: string
  nationality: string
  idNumber: string
  notes: string
  vipStatus: boolean
}

const emptyNewGuest: NewGuestForm = {
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  nationality: '',
  idNumber: '',
  notes: '',
  vipStatus: false,
}

function deserializeGuest(guest: Guest): Guest {
  return {
    ...guest,
    dateOfBirth: guest.dateOfBirth ? new Date(guest.dateOfBirth) : undefined,
    lastStayDate: guest.lastStayDate ? new Date(guest.lastStayDate) : undefined,
    firstStayDate: new Date(guest.firstStayDate),
    createdAt: new Date(guest.createdAt),
    updatedAt: new Date(guest.updatedAt),
  }
}

function preferencesToText(preferences: unknown): string | undefined {
  if (!preferences) return undefined
  if (typeof preferences === 'string') return preferences
  if (Array.isArray(preferences)) return preferences.join(', ')
  if (typeof preferences === 'object') return Object.entries(preferences as Record<string, unknown>)
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join(', ')
  return undefined
}

function guestFromServer(record: any): Guest {
  const reservations = record.reservations || []
  const activeReservations = reservations.filter((reservation: any) => reservation.status !== 'CANCELLED' && reservation.status !== 'NO_SHOW')
  const stays = reservations.filter((reservation: any) => reservation.status === 'CHECKED_OUT')
  const stayDates = activeReservations
    .flatMap((reservation: any) => [reservation.checkIn, reservation.checkOut])
    .filter(Boolean)
    .map((value: string) => new Date(value))
    .filter((value: Date) => !Number.isNaN(value.getTime()))
  const firstStayDate = stayDates.length
    ? new Date(Math.min(...stayDates.map((date: Date) => date.getTime())))
    : new Date(record.createdAt || new Date())
  const lastStayDate = stayDates.length
    ? new Date(Math.max(...stayDates.map((date: Date) => date.getTime())))
    : undefined
  const totalNights = activeReservations.reduce((sum: number, reservation: any) => (
    sum + nightsBetween(reservation.checkIn, reservation.checkOut)
  ), 0)
  const totalSpent = reservations.reduce((sum: number, reservation: any) => (
    sum + Number(reservation.folio?.total || reservation.totalAmount || 0)
  ), 0)
  const tags = [
    record.vipStatus ? 'VIP' : undefined,
    stays.length >= 3 ? 'Frequent Guest' : undefined,
    record.blacklisted ? 'Caution' : undefined,
  ].filter(Boolean) as string[]

  return {
    id: record.id,
    firstName: record.firstName,
    lastName: record.lastName,
    fullName: `${record.firstName || ''} ${record.lastName || ''}`.trim(),
    email: record.email || undefined,
    phone: record.phone || undefined,
    nationality: record.nationality || undefined,
    dateOfBirth: record.dateOfBirth ? new Date(record.dateOfBirth) : undefined,
    passportNumber: record.idType === 'PASSPORT' ? record.idNumber || undefined : undefined,
    idNumber: record.idNumber || undefined,
    isVIP: Boolean(record.vipStatus),
    tags,
    preferences: preferencesToText(record.preferences),
    notes: record.notes || undefined,
    warnings: record.blacklisted ? 'Guest is marked for manager review.' : undefined,
    totalStays: stays.length,
    totalNights,
    totalSpent,
    lastStayDate,
    firstStayDate,
    preferredRoomType: reservations[0]?.roomType?.code === 'DOUBLE' ? 'DOUBLE' : reservations[0]?.roomType?.code === 'TWIN' ? 'TWIN' : undefined,
    createdAt: new Date(record.createdAt || new Date()),
    updatedAt: new Date(record.updatedAt || new Date()),
  }
}

function localGuestFromForm(form: NewGuestForm): Guest {
  const now = new Date()
  return {
    id: `guest-${Date.now()}`,
    firstName: form.firstName.trim(),
    lastName: form.lastName.trim(),
    fullName: `${form.firstName.trim()} ${form.lastName.trim()}`.trim(),
    email: form.email.trim() || undefined,
    phone: form.phone.trim() || undefined,
    nationality: form.nationality.trim() || undefined,
    idNumber: form.idNumber.trim() || undefined,
    isVIP: form.vipStatus,
    tags: form.vipStatus ? ['VIP'] : [],
    notes: form.notes.trim() || undefined,
    totalStays: 0,
    totalNights: 0,
    totalSpent: 0,
    firstStayDate: now,
    createdAt: now,
    updatedAt: now,
  }
}

export function GuestsView() {
  const { navigate } = useNavigation()
  const [guestsRaw, setGuestsRaw] = useKV<Guest[]>('guests-data', [])
  const [canonicalGuestsRaw, setCanonicalGuests] = useKV<Guest[]>('guests', [])
  const [authToken] = useKV<string | null>('auth:pms-token', null)
  const [serverGuests, setServerGuests] = useState<Guest[]>([])
  const [isLoadingGuests, setIsLoadingGuests] = useState(false)
  const [guestError, setGuestError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedGuest, setSelectedGuest] = useState<Guest | null>(null)
  const [selectedTab, setSelectedTab] = useState<'all' | 'vip' | 'frequent' | 'recent'>('all')
  const [isNewGuestOpen, setIsNewGuestOpen] = useState(false)
  const [newGuest, setNewGuest] = useState<NewGuestForm>(emptyNewGuest)
  const [newGuestError, setNewGuestError] = useState<string | null>(null)
  const [isSavingGuest, setIsSavingGuest] = useState(false)

  const refreshServerGuests = useCallback(async () => {
    if (!SERVER_API_ENABLED || !authToken) return []
    setIsLoadingGuests(true)
    setGuestError(null)
    try {
      const payload = await pmsApi<{ ok: true; data: any[] }>('/api/guests', authToken)
      const nextGuests = payload.data.map(guestFromServer)
      setServerGuests(nextGuests)
      setGuestsRaw(nextGuests)
      setCanonicalGuests(nextGuests)
      return nextGuests
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load guest profiles.'
      setGuestError(message)
      return []
    } finally {
      setIsLoadingGuests(false)
    }
  }, [authToken, setCanonicalGuests, setGuestsRaw])
  
  useEffect(() => {
    if (SERVER_API_ENABLED && authToken) {
      void refreshServerGuests()
    }
  }, [authToken, refreshServerGuests])

  const guests = useMemo(() => {
    if (SERVER_API_ENABLED && authToken) return serverGuests

    const merged = new Map<string, Guest>()
    ;(canonicalGuestsRaw || []).map(deserializeGuest).forEach((guest) => {
      merged.set(guest.id, guest)
    })
    ;(guestsRaw || []).map(deserializeGuest).forEach((guest) => {
      merged.set(guest.id, guest)
    })
    return [...merged.values()]
  }, [authToken, canonicalGuestsRaw, guestsRaw, serverGuests])

  const updateNewGuest = (field: keyof NewGuestForm, value: string | boolean) => {
    setNewGuest((current) => ({ ...current, [field]: value }))
  }

  const handleCreateGuest = async () => {
    if (!newGuest.firstName.trim() || !newGuest.lastName.trim()) {
      setNewGuestError('Guest first and last name are required.')
      return
    }
    if (newGuest.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newGuest.email.trim())) {
      setNewGuestError('Enter a valid guest email address.')
      return
    }

    setIsSavingGuest(true)
    setNewGuestError(null)
    try {
      if (SERVER_API_ENABLED && authToken) {
        const payload = await pmsApi<{ ok: true; data: any }>('/api/guests', authToken, {
          method: 'POST',
          body: JSON.stringify({
            firstName: newGuest.firstName,
            lastName: newGuest.lastName,
            email: newGuest.email || undefined,
            phone: newGuest.phone || undefined,
            nationality: newGuest.nationality || undefined,
            idNumber: newGuest.idNumber || undefined,
            notes: newGuest.notes || undefined,
            vipStatus: newGuest.vipStatus,
          }),
        })
        await refreshServerGuests()
        setSelectedGuest(guestFromServer({ ...payload.data, reservations: [] }))
      } else {
        const createdGuest = localGuestFromForm(newGuest)
        const nextGuests = [
          createdGuest,
          ...guests.filter((guest) => guest.id !== createdGuest.id),
        ]
        setGuestsRaw(nextGuests)
        setCanonicalGuests(nextGuests)
        setSelectedGuest(createdGuest)
      }
      toast.success(`Guest profile created for ${newGuest.firstName.trim()} ${newGuest.lastName.trim()}.`)
      setNewGuest(emptyNewGuest)
      setIsNewGuestOpen(false)
    } catch (error) {
      setNewGuestError(error instanceof Error ? error.message : 'Guest profile could not be created.')
    } finally {
      setIsSavingGuest(false)
    }
  }
  
  const filteredGuests = useMemo(() => {
    let result = guests
    
    switch (selectedTab) {
      case 'vip':
        result = result.filter(g => g.isVIP)
        break
      case 'frequent':
        result = result.filter(g => g.totalStays >= 3)
        break
      case 'recent': {
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
        result = result.filter(g => g.lastStayDate && g.lastStayDate >= thirtyDaysAgo)
        break
      }
    }
    
    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      result = result.filter(g =>
        g.fullName.toLowerCase().includes(query) ||
        g.email?.toLowerCase().includes(query) ||
        g.phone?.includes(query) ||
        g.nationality?.toLowerCase().includes(query) ||
        g.passportNumber?.toLowerCase().includes(query)
      )
    }
    
    return result
  }, [guests, selectedTab, searchQuery])
  
  const stats = useMemo(() => ({
    total: guests.length,
    vip: guests.filter(g => g.isVIP).length,
    frequent: guests.filter(g => g.totalStays >= 3).length,
    withWarnings: guests.filter(g => g.warnings).length
  }), [guests])
  
  const getInitials = (name: string) => {
    const parts = name.split(' ')
    return parts.map(p => p[0]).join('').substring(0, 2).toUpperCase()
  }
  
  return (
    <div className="h-screen flex flex-col bg-background">
      <div className="flex-none border-b border-border bg-card">
        <div className="px-6 py-4">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-2xl font-semibold text-foreground">Guest Directory</h1>
              <p className="text-sm text-muted-foreground mt-1">
                Manage guest profiles and preferences
              </p>
            </div>
            <Button aria-label="New Guest" className="gap-2" onClick={() => {
              setNewGuest(emptyNewGuest)
              setNewGuestError(null)
              setIsNewGuestOpen(true)
            }}>
              <Plus size={18} weight="bold" />
              New Guest
            </Button>
          </div>
          
          <div className="relative max-w-md">
            <MagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} />
            <Input
              placeholder="Search by name, email, phone, passport..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
          {guestError && (
            <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {guestError}
            </div>
          )}
        </div>
        
        <div className="px-6 pb-4">
          <div className="grid grid-cols-4 gap-3">
            <Card className="p-3">
              <div className="text-xs font-medium text-muted-foreground mb-1">Total Guests</div>
              <div className="text-2xl font-bold text-foreground">{stats.total}</div>
            </Card>
            <Card className="p-3">
              <div className="text-xs font-medium text-muted-foreground mb-1">VIP Guests</div>
              <div className="text-2xl font-bold text-amber-600">{stats.vip}</div>
            </Card>
            <Card className="p-3">
              <div className="text-xs font-medium text-muted-foreground mb-1">Frequent Guests</div>
              <div className="text-2xl font-bold text-blue-600">{stats.frequent}</div>
            </Card>
            <Card className="p-3">
              <div className="text-xs font-medium text-muted-foreground mb-1">With Warnings</div>
              <div className="text-2xl font-bold text-orange-600">{stats.withWarnings}</div>
            </Card>
          </div>
        </div>
      </div>
      
      <Tabs value={selectedTab} onValueChange={(v) => setSelectedTab(v as any)} className="flex-1 flex flex-col">
        <div className="flex-none border-b border-border bg-card px-6">
          <TabsList className="bg-transparent">
            <TabsTrigger value="all">All Guests</TabsTrigger>
            <TabsTrigger value="vip">VIP</TabsTrigger>
            <TabsTrigger value="frequent">Frequent</TabsTrigger>
            <TabsTrigger value="recent">Recent</TabsTrigger>
          </TabsList>
        </div>
        
        <TabsContent value={selectedTab} className="flex-1 m-0 p-6">
          <ScrollArea className="h-full">
            <div className="space-y-3">
              {filteredGuests.length === 0 ? (
                <Card className="p-12 text-center">
                  <User className="mx-auto mb-4 text-muted-foreground" size={48} weight="light" />
                  <h3 className="text-lg font-medium text-foreground mb-2">
                    {isLoadingGuests ? 'Loading guest profiles...' : 'No guests found'}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {isLoadingGuests ? 'Checking persistent guest records.' : searchQuery ? 'Try adjusting your search terms' : 'No guests in this category'}
                  </p>
                </Card>
              ) : (
                filteredGuests.map(guest => (
                  <Card 
                    key={guest.id}
                    className="p-4 hover:border-primary/50 transition-colors cursor-pointer"
                    onClick={() => setSelectedGuest(guest)}
                  >
                    <div className="flex items-start gap-4">
                      <Avatar className="h-12 w-12 border-2 border-border">
                        <AvatarFallback className={cn(
                          'text-sm font-semibold',
                          guest.isVIP && 'bg-amber-100 text-amber-800'
                        )}>
                          {getInitials(guest.fullName)}
                        </AvatarFallback>
                      </Avatar>
                      
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-2">
                          <h3 className="text-base font-semibold text-foreground">{guest.fullName}</h3>
                          {guest.tags.map(tag => (
                            <Badge 
                              key={tag} 
                              variant="outline"
                              className={cn(
                                'text-xs',
                                tag === 'VIP' && 'bg-amber-50 text-amber-800 border-amber-200',
                                tag === 'Frequent Guest' && 'bg-blue-50 text-blue-800 border-blue-200',
                                tag === 'Caution' && 'bg-red-50 text-red-800 border-red-200'
                              )}
                            >
                              {tag === 'VIP' && <Star size={12} weight="fill" className="mr-1" />}
                              {tag === 'Caution' && <Warning size={12} weight="fill" className="mr-1" />}
                              {tag}
                            </Badge>
                          ))}
                        </div>
                        
                        <div className="grid grid-cols-4 gap-x-6 gap-y-2 text-sm">
                          {guest.email && (
                            <div className="flex items-center gap-2 text-muted-foreground">
                              <EnvelopeSimple size={16} />
                              <span className="truncate">{guest.email}</span>
                            </div>
                          )}
                          {guest.phone && (
                            <div className="flex items-center gap-2 text-muted-foreground">
                              <Phone size={16} />
                              <span>{guest.phone}</span>
                            </div>
                          )}
                          {guest.nationality && (
                            <div className="flex items-center gap-2 text-muted-foreground">
                              <Flag size={16} />
                              <span>{guest.nationality}</span>
                            </div>
                          )}
                          {guest.lastStayDate && (
                            <div className="flex items-center gap-2 text-muted-foreground">
                              <CalendarBlank size={16} />
                              <span>Last stay: {format(guest.lastStayDate, 'MMM d, yyyy')}</span>
                            </div>
                          )}
                        </div>
                      </div>
                      
                      <div className="text-right">
                        <div className="grid grid-cols-3 gap-4 text-sm">
                          <div>
                            <div className="text-2xl font-bold text-foreground">{guest.totalStays}</div>
                            <div className="text-xs text-muted-foreground">Stays</div>
                          </div>
                          <div>
                            <div className="text-2xl font-bold text-foreground">{guest.totalNights}</div>
                            <div className="text-xs text-muted-foreground">Nights</div>
                          </div>
                          <div>
                            <div className="text-lg font-bold text-foreground">฿{(guest.totalSpent / 1000).toFixed(0)}k</div>
                            <div className="text-xs text-muted-foreground">Spent</div>
                          </div>
                        </div>
                      </div>
                    </div>
                    
                    {(guest.preferences || guest.notes || guest.warnings) && (
                      <div className="mt-3 pt-3 border-t border-border text-xs space-y-1">
                        {guest.preferences && (
                          <div className="text-muted-foreground">
                            <span className="font-medium">Preferences:</span> {guest.preferences}
                          </div>
                        )}
                        {guest.notes && (
                          <div className="text-muted-foreground">
                            <span className="font-medium">Notes:</span> {guest.notes}
                          </div>
                        )}
                        {guest.warnings && (
                          <div className="text-orange-600 flex items-center gap-1">
                            <Warning size={14} weight="fill" />
                            <span className="font-medium">Warning:</span> {guest.warnings}
                          </div>
                        )}
                      </div>
                    )}
                  </Card>
                ))
              )}
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>
      
      {selectedGuest && (
        <Dialog open={!!selectedGuest} onOpenChange={() => setSelectedGuest(null)}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-3">
                <Avatar className="h-12 w-12 border-2 border-border">
                  <AvatarFallback className={cn(
                    'text-sm font-semibold',
                    selectedGuest.isVIP && 'bg-amber-100 text-amber-800'
                  )}>
                    {getInitials(selectedGuest.fullName)}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <div className="flex items-center gap-2">
                    <span>{selectedGuest.fullName}</span>
                    {selectedGuest.isVIP && (
                      <Badge className="bg-amber-100 text-amber-800">VIP</Badge>
                    )}
                  </div>
                  <div className="text-sm font-normal text-muted-foreground">
                    Guest #{selectedGuest.id}
                  </div>
                </div>
              </DialogTitle>
            </DialogHeader>
            
            <div className="space-y-6 py-4">
              <div>
                <h4 className="text-sm font-semibold text-foreground mb-3">Contact Information</h4>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <Label className="text-muted-foreground">Email</Label>
                    <div className="mt-1 text-foreground">{selectedGuest.email || '—'}</div>
                  </div>
                  <div>
                    <Label className="text-muted-foreground">Phone</Label>
                    <div className="mt-1 text-foreground">{selectedGuest.phone || '—'}</div>
                  </div>
                  <div>
                    <Label className="text-muted-foreground">Nationality</Label>
                    <div className="mt-1 text-foreground">{selectedGuest.nationality || '—'}</div>
                  </div>
                  <div>
                    <Label className="text-muted-foreground">Preferred Contact</Label>
                    <div className="mt-1 text-foreground">{selectedGuest.preferredContact || '—'}</div>
                  </div>
                </div>
              </div>
              
              <div>
                <h4 className="text-sm font-semibold text-foreground mb-3">Stay History</h4>
                <div className="grid grid-cols-3 gap-4">
                  <Card className="p-3">
                    <div className="text-2xl font-bold text-foreground">{selectedGuest.totalStays}</div>
                    <div className="text-xs text-muted-foreground">Total Stays</div>
                  </Card>
                  <Card className="p-3">
                    <div className="text-2xl font-bold text-foreground">{selectedGuest.totalNights}</div>
                    <div className="text-xs text-muted-foreground">Total Nights</div>
                  </Card>
                  <Card className="p-3">
                    <div className="text-xl font-bold text-foreground">฿{selectedGuest.totalSpent.toLocaleString()}</div>
                    <div className="text-xs text-muted-foreground">Total Spent</div>
                  </Card>
                </div>
              </div>
              
              {selectedGuest.preferences && (
                <div>
                  <Label className="text-muted-foreground">Preferences</Label>
                  <div className="mt-2 p-3 bg-muted rounded-md text-sm text-foreground">
                    {selectedGuest.preferences}
                  </div>
                </div>
              )}
              
              {selectedGuest.warnings && (
                <div>
                  <Label className="text-orange-600 flex items-center gap-1">
                    <Warning size={16} weight="fill" />
                    Warnings
                  </Label>
                  <div className="mt-2 p-3 bg-orange-50 border border-orange-200 rounded-md text-sm text-orange-800">
                    {selectedGuest.warnings}
                  </div>
                </div>
              )}
              
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1 gap-2" onClick={() => {
                  setSelectedGuest(null)
                  navigate('guest-communications')
                }}>
                  <ChatCircle size={18} />
                  Send Message
                </Button>
                <Button variant="outline" className="flex-1 gap-2" onClick={() => {
                  setSelectedGuest(null)
                  navigate('reservations')
                }}>
                  <CalendarBlank size={18} />
                  View Reservations
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      <Dialog open={isNewGuestOpen} onOpenChange={setIsNewGuestOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>New guest profile</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="guest-first-name">First name</Label>
              <Input
                id="guest-first-name"
                value={newGuest.firstName}
                onChange={(event) => updateNewGuest('firstName', event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="guest-last-name">Last name</Label>
              <Input
                id="guest-last-name"
                value={newGuest.lastName}
                onChange={(event) => updateNewGuest('lastName', event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="guest-email">Email</Label>
              <Input
                id="guest-email"
                type="email"
                value={newGuest.email}
                onChange={(event) => updateNewGuest('email', event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="guest-phone">Phone</Label>
              <Input
                id="guest-phone"
                value={newGuest.phone}
                onChange={(event) => updateNewGuest('phone', event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="guest-nationality">Nationality</Label>
              <Input
                id="guest-nationality"
                value={newGuest.nationality}
                onChange={(event) => updateNewGuest('nationality', event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="guest-id-number">ID / passport number</Label>
              <Input
                id="guest-id-number"
                value={newGuest.idNumber}
                onChange={(event) => updateNewGuest('idNumber', event.target.value)}
              />
            </div>
            <div className="col-span-2 space-y-2">
              <Label htmlFor="guest-notes">Notes</Label>
              <Textarea
                id="guest-notes"
                value={newGuest.notes}
                onChange={(event) => updateNewGuest('notes', event.target.value)}
                placeholder="Operational notes visible to hotel staff"
              />
            </div>
            <label className="col-span-2 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={newGuest.vipStatus}
                onChange={(event) => updateNewGuest('vipStatus', event.target.checked)}
              />
              Mark as VIP
            </label>
          </div>
          {newGuestError && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {newGuestError}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setIsNewGuestOpen(false)} disabled={isSavingGuest}>
              Cancel
            </Button>
            <Button onClick={handleCreateGuest} disabled={isSavingGuest}>
              {isSavingGuest ? 'Creating...' : 'Create guest'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
