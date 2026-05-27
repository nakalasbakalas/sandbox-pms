import { useState, useMemo } from 'react'
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
  CalendarBlank, Star, Warning, Flag, Paperclip, ChatCircle
} from '@phosphor-icons/react'
import { format } from 'date-fns'
import { cn } from '@/lib/utils'

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

function generateMockGuests(): Guest[] {
  return []
}

export function GuestsView() {
  const [guests, setGuests] = useKV<Guest[]>('guests-data', [])
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedGuest, setSelectedGuest] = useState<Guest | null>(null)
  const [selectedTab, setSelectedTab] = useState<'all' | 'vip' | 'frequent' | 'recent'>('all')
  
  useState(() => {
    if (guests.length === 0) {
      setGuests(generateMockGuests())
    }
  })
  
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
            <Button className="gap-2">
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
                  <h3 className="text-lg font-medium text-foreground mb-2">No guests found</h3>
                  <p className="text-sm text-muted-foreground">
                    {searchQuery ? 'Try adjusting your search terms' : 'No guests in this category'}
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
                <Button variant="outline" className="flex-1 gap-2">
                  <ChatCircle size={18} />
                  Send Message
                </Button>
                <Button variant="outline" className="flex-1 gap-2">
                  <Paperclip size={18} />
                  View Documents
                </Button>
                <Button variant="outline" className="flex-1 gap-2">
                  <CalendarBlank size={18} />
                  View Reservations
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
