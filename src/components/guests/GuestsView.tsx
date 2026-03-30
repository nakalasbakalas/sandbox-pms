import { useState, useMemo } from 'react'
import { useKV } from '@github/spark/hooks'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { 
  MagnifyingGlass, 
  Plus, 
  User,
  Phone,
  Envelope,
  MapPin,
  IdentificationCard,
  Star,
  Warning,
  Calendar,
  Bed,
  Note,
  ArrowRight,
  Trash
} from '@phosphor-icons/react'
import type { Guest } from '@/types'
import { toast } from 'sonner'
import { format } from 'date-fns'
import { cn } from '@/lib/utils'

interface GuestWithStats extends Guest {
  totalStays?: number
  totalRevenue?: number
  lastStayDate?: Date
  upcomingStays?: number
}

export function GuestsView() {
  const [guests, setGuests] = useKV<GuestWithStats[]>('guests', [])
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedGuest, setSelectedGuest] = useState<GuestWithStats | null>(null)
  const [showNewGuestDialog, setShowNewGuestDialog] = useState(false)
  const [filter, setFilter] = useState<'ALL' | 'VIP' | 'BLACKLISTED' | 'CAUTION'>('ALL')

  const filteredGuests = useMemo(() => {
    let filtered = guests || []

    if (filter === 'VIP') {
      filtered = filtered.filter(g => g.vipStatus)
    } else if (filter === 'BLACKLISTED') {
      filtered = filtered.filter(g => g.blacklisted)
    } else if (filter === 'CAUTION') {
      filtered = filtered.filter(g => g.cautionFlag)
    }

    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      filtered = filtered.filter(g => 
        g.firstName.toLowerCase().includes(query) ||
        g.lastName.toLowerCase().includes(query) ||
        g.email?.toLowerCase().includes(query) ||
        g.phone?.toLowerCase().includes(query) ||
        g.nationality?.toLowerCase().includes(query)
      )
    }

    return filtered.sort((a, b) => a.lastName.localeCompare(b.lastName))
  }, [guests, searchQuery, filter])

  const vipGuests = (guests || []).filter(g => g.vipStatus)
  const blacklistedGuests = (guests || []).filter(g => g.blacklisted)
  const cautionGuests = (guests || []).filter(g => g.cautionFlag)

  const handleDeleteGuest = (guestId: string) => {
    setGuests(current => (current || []).filter(g => g.id !== guestId))
    toast.success('Guest deleted')
    setSelectedGuest(null)
  }

  const handleUpdateGuest = (updatedGuest: GuestWithStats) => {
    setGuests(current => 
      (current || []).map(g => g.id === updatedGuest.id ? updatedGuest : g)
    )
    toast.success('Guest updated')
  }

  return (
    <div className="h-full flex flex-col bg-background p-6 gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Guest Directory</h1>
          <p className="text-sm text-muted-foreground">
            Manage guest profiles and stay history
          </p>
        </div>
        
        <div className="flex items-center gap-2">
          <Button onClick={() => setShowNewGuestDialog(true)}>
            <Plus className="w-4 h-4 mr-2" weight="bold" />
            New Guest
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <Card className="p-4">
          <div className="text-sm text-muted-foreground mb-1">Total Guests</div>
          <div className="text-3xl font-bold">{(guests || []).length}</div>
        </Card>
        <Card className="p-4">
          <div className="text-sm text-muted-foreground mb-1 flex items-center gap-1">
            <Star size={14} weight="fill" className="text-yellow-500" />
            VIP Guests
          </div>
          <div className="text-3xl font-bold">{vipGuests.length}</div>
        </Card>
        <Card className="p-4 bg-orange-50 dark:bg-orange-950/20 border-orange-200 dark:border-orange-800">
          <div className="text-sm text-orange-700 dark:text-orange-400 mb-1 flex items-center gap-1">
            <Warning size={14} weight="bold" />
            Caution
          </div>
          <div className="text-3xl font-bold text-orange-700 dark:text-orange-400">{cautionGuests.length}</div>
        </Card>
        <Card className="p-4 bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800">
          <div className="text-sm text-red-700 dark:text-red-400 mb-1">Blacklisted</div>
          <div className="text-3xl font-bold text-red-700 dark:text-red-400">{blacklistedGuests.length}</div>
        </Card>
      </div>

      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-md">
          <MagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, email, phone, or nationality..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
        <div className="flex gap-2">
          <Button 
            variant={filter === 'ALL' ? 'default' : 'outline'} 
            size="sm"
            onClick={() => setFilter('ALL')}
          >
            All
          </Button>
          <Button 
            variant={filter === 'VIP' ? 'default' : 'outline'} 
            size="sm"
            onClick={() => setFilter('VIP')}
          >
            <Star size={14} className="mr-1" weight="fill" />
            VIP
          </Button>
          <Button 
            variant={filter === 'CAUTION' ? 'default' : 'outline'} 
            size="sm"
            onClick={() => setFilter('CAUTION')}
          >
            <Warning size={14} className="mr-1" weight="bold" />
            Caution
          </Button>
          <Button 
            variant={filter === 'BLACKLISTED' ? 'default' : 'outline'} 
            size="sm"
            onClick={() => setFilter('BLACKLISTED')}
          >
            Blacklisted
          </Button>
        </div>
      </div>

      <Card className="flex-1 p-4">
        <ScrollArea className="h-[calc(100vh-400px)]">
          {filteredGuests.length === 0 ? (
            <div className="flex items-center justify-center h-full text-center text-muted-foreground py-12">
              <div>
                <User size={48} className="mx-auto mb-3 opacity-50" />
                <p>No guests found</p>
              </div>
            </div>
          ) : (
            <div className="space-y-2 pr-4">
              {filteredGuests.map(guest => (
                <GuestCard 
                  key={guest.id} 
                  guest={guest}
                  onClick={() => setSelectedGuest(guest)}
                />
              ))}
            </div>
          )}
        </ScrollArea>
      </Card>

      <GuestDetailDialog
        guest={selectedGuest}
        open={!!selectedGuest}
        onClose={() => setSelectedGuest(null)}
        onDelete={handleDeleteGuest}
        onUpdate={handleUpdateGuest}
      />

      <NewGuestDialog
        open={showNewGuestDialog}
        onClose={() => setShowNewGuestDialog(false)}
        onSubmit={(data) => {
          setGuests(current => [...(current || []), data])
          toast.success('Guest profile created')
          setShowNewGuestDialog(false)
        }}
      />
    </div>
  )
}

interface GuestCardProps {
  guest: GuestWithStats
  onClick: () => void
}

function GuestCard({ guest, onClick }: GuestCardProps) {
  return (
    <Card 
      className="p-4 hover:bg-accent/50 cursor-pointer transition-colors"
      onClick={onClick}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            <h3 className="font-semibold text-lg">
              {guest.firstName} {guest.lastName}
            </h3>
            {guest.vipStatus && (
              <Badge className="bg-yellow-100 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-300">
                <Star size={12} className="mr-1" weight="fill" />
                VIP
              </Badge>
            )}
            {guest.blacklisted && (
              <Badge variant="destructive">
                Blacklisted
              </Badge>
            )}
            {guest.cautionFlag && (
              <Badge className="bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300">
                <Warning size={12} className="mr-1" weight="bold" />
                Caution
              </Badge>
            )}
          </div>
          
          <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
            {guest.email && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Envelope size={14} />
                <span className="truncate">{guest.email}</span>
              </div>
            )}
            {guest.phone && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Phone size={14} />
                <span>{guest.phone}</span>
              </div>
            )}
            {guest.nationality && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <MapPin size={14} />
                <span>{guest.nationality}</span>
              </div>
            )}
            {guest.totalStays !== undefined && guest.totalStays > 0 && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Bed size={14} />
                <span>{guest.totalStays} stay{guest.totalStays > 1 ? 's' : ''}</span>
                {guest.totalRevenue && (
                  <span className="font-medium text-foreground">
                    (฿{guest.totalRevenue.toLocaleString()})
                  </span>
                )}
              </div>
            )}
          </div>

          {guest.notes && (
            <div className="mt-2 text-sm flex items-start gap-2 text-muted-foreground">
              <Note size={14} className="mt-0.5 flex-shrink-0" />
              <span className="line-clamp-1">{guest.notes}</span>
            </div>
          )}
        </div>

        <ArrowRight size={20} className="text-muted-foreground flex-shrink-0" />
      </div>
    </Card>
  )
}

interface GuestDetailDialogProps {
  guest: GuestWithStats | null
  open: boolean
  onClose: () => void
  onDelete: (guestId: string) => void
  onUpdate: (guest: GuestWithStats) => void
}

function GuestDetailDialog({ guest, open, onClose, onDelete, onUpdate }: GuestDetailDialogProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editForm, setEditForm] = useState<GuestWithStats | null>(null)

  if (!guest) return null

  const handleEdit = () => {
    setEditForm(guest)
    setIsEditing(true)
  }

  const handleSave = () => {
    if (editForm) {
      onUpdate(editForm)
      setIsEditing(false)
    }
  }

  const handleCancel = () => {
    setEditForm(null)
    setIsEditing(false)
  }

  const currentGuest = isEditing ? editForm! : guest

  return (
    <Dialog open={open} onOpenChange={(open) => {
      if (!open) {
        onClose()
        setIsEditing(false)
        setEditForm(null)
      }
    }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle>Guest Profile</DialogTitle>
            <div className="flex gap-2">
              {currentGuest.vipStatus && (
                <Badge className="bg-yellow-100 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-300">
                  <Star size={12} className="mr-1" weight="fill" />
                  VIP
                </Badge>
              )}
              {currentGuest.blacklisted && (
                <Badge variant="destructive">Blacklisted</Badge>
              )}
              {currentGuest.cautionFlag && (
                <Badge className="bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300">
                  <Warning size={12} className="mr-1" weight="bold" />
                  Caution
                </Badge>
              )}
            </div>
          </div>
          <DialogDescription>Guest ID: {guest.id}</DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh] pr-4">
          <div className="space-y-4">
            <Card className="p-4">
              <h3 className="font-semibold mb-3 flex items-center gap-2">
                <User size={18} />
                Personal Information
              </h3>
              
              {isEditing ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>First Name</Label>
                      <Input
                        value={currentGuest.firstName}
                        onChange={(e) => setEditForm(prev => prev ? { ...prev, firstName: e.target.value } : null)}
                        className="mt-1"
                      />
                    </div>
                    <div>
                      <Label>Last Name</Label>
                      <Input
                        value={currentGuest.lastName}
                        onChange={(e) => setEditForm(prev => prev ? { ...prev, lastName: e.target.value } : null)}
                        className="mt-1"
                      />
                    </div>
                  </div>
                  <div>
                    <Label>Email</Label>
                    <Input
                      type="email"
                      value={currentGuest.email || ''}
                      onChange={(e) => setEditForm(prev => prev ? { ...prev, email: e.target.value || null } : null)}
                      className="mt-1"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Phone</Label>
                      <Input
                        value={currentGuest.phone || ''}
                        onChange={(e) => setEditForm(prev => prev ? { ...prev, phone: e.target.value || null } : null)}
                        className="mt-1"
                      />
                    </div>
                    <div>
                      <Label>Nationality</Label>
                      <Input
                        value={currentGuest.nationality || ''}
                        onChange={(e) => setEditForm(prev => prev ? { ...prev, nationality: e.target.value || null } : null)}
                        className="mt-1"
                      />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <div className="text-muted-foreground">Name</div>
                    <div className="font-medium">{currentGuest.firstName} {currentGuest.lastName}</div>
                  </div>
                  {currentGuest.email && (
                    <div>
                      <div className="text-muted-foreground">Email</div>
                      <div className="font-medium">{currentGuest.email}</div>
                    </div>
                  )}
                  {currentGuest.phone && (
                    <div>
                      <div className="text-muted-foreground">Phone</div>
                      <div className="font-medium">{currentGuest.phone}</div>
                    </div>
                  )}
                  {currentGuest.nationality && (
                    <div>
                      <div className="text-muted-foreground">Nationality</div>
                      <div className="font-medium">{currentGuest.nationality}</div>
                    </div>
                  )}
                  {currentGuest.dateOfBirth && (
                    <div>
                      <div className="text-muted-foreground">Date of Birth</div>
                      <div className="font-medium">{format(new Date(currentGuest.dateOfBirth), 'PP')}</div>
                    </div>
                  )}
                </div>
              )}
            </Card>

            {(currentGuest.idType || currentGuest.idNumber || isEditing) && (
              <Card className="p-4">
                <h3 className="font-semibold mb-3 flex items-center gap-2">
                  <IdentificationCard size={18} />
                  Identification
                </h3>
                
                {isEditing ? (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>ID Type</Label>
                      <Input
                        value={currentGuest.idType || ''}
                        onChange={(e) => setEditForm(prev => prev ? { ...prev, idType: e.target.value || null } : null)}
                        className="mt-1"
                        placeholder="Passport, National ID, etc."
                      />
                    </div>
                    <div>
                      <Label>ID Number</Label>
                      <Input
                        value={currentGuest.idNumber || ''}
                        onChange={(e) => setEditForm(prev => prev ? { ...prev, idNumber: e.target.value || null } : null)}
                        className="mt-1"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    {currentGuest.idType && (
                      <div>
                        <div className="text-muted-foreground">ID Type</div>
                        <div className="font-medium">{currentGuest.idType}</div>
                      </div>
                    )}
                    {currentGuest.idNumber && (
                      <div>
                        <div className="text-muted-foreground">ID Number</div>
                        <div className="font-medium">{currentGuest.idNumber}</div>
                      </div>
                    )}
                  </div>
                )}
              </Card>
            )}

            <Card className="p-4">
              <h3 className="font-semibold mb-3">Stay History</h3>
              <div className="grid grid-cols-3 gap-4 text-sm">
                <div>
                  <div className="text-muted-foreground">Total Stays</div>
                  <div className="text-2xl font-bold">{currentGuest.totalStays || 0}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Total Revenue</div>
                  <div className="text-2xl font-bold">
                    {currentGuest.totalRevenue ? `฿${currentGuest.totalRevenue.toLocaleString()}` : '฿0'}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground">Last Stay</div>
                  <div className="font-medium">
                    {currentGuest.lastStayDate ? format(new Date(currentGuest.lastStayDate), 'PP') : 'N/A'}
                  </div>
                </div>
              </div>
              {currentGuest.upcomingStays && currentGuest.upcomingStays > 0 && (
                <div className="mt-3 p-2 bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded text-sm text-blue-700 dark:text-blue-300">
                  {currentGuest.upcomingStays} upcoming reservation{currentGuest.upcomingStays > 1 ? 's' : ''}
                </div>
              )}
            </Card>

            {(currentGuest.notes || isEditing) && (
              <Card className="p-4">
                <h3 className="font-semibold mb-3 flex items-center gap-2">
                  <Note size={18} />
                  Notes
                </h3>
                
                {isEditing ? (
                  <Textarea
                    value={currentGuest.notes || ''}
                    onChange={(e) => setEditForm(prev => prev ? { ...prev, notes: e.target.value || null } : null)}
                    rows={4}
                    placeholder="Add any notes about this guest..."
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">{currentGuest.notes}</p>
                )}
              </Card>
            )}

            {isEditing && (
              <Card className="p-4">
                <h3 className="font-semibold mb-3">Flags</h3>
                <div className="space-y-3">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={currentGuest.vipStatus}
                      onChange={(e) => setEditForm(prev => prev ? { ...prev, vipStatus: e.target.checked } : null)}
                      className="w-4 h-4"
                    />
                    <div>
                      <div className="font-medium flex items-center gap-2">
                        <Star size={16} weight="fill" className="text-yellow-500" />
                        VIP Status
                      </div>
                      <div className="text-xs text-muted-foreground">Mark this guest as VIP for special treatment</div>
                    </div>
                  </label>
                  
                  <Separator />
                  
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={currentGuest.cautionFlag}
                      onChange={(e) => setEditForm(prev => prev ? { ...prev, cautionFlag: e.target.checked } : null)}
                      className="w-4 h-4"
                    />
                    <div>
                      <div className="font-medium flex items-center gap-2">
                        <Warning size={16} weight="bold" className="text-orange-500" />
                        Caution Flag
                      </div>
                      <div className="text-xs text-muted-foreground">Requires special attention or monitoring</div>
                    </div>
                  </label>
                  
                  <Separator />
                  
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={currentGuest.blacklisted}
                      onChange={(e) => setEditForm(prev => prev ? { ...prev, blacklisted: e.target.checked } : null)}
                      className="w-4 h-4"
                    />
                    <div>
                      <div className="font-medium text-red-600 dark:text-red-400">Blacklist</div>
                      <div className="text-xs text-muted-foreground">Do not accept reservations from this guest</div>
                    </div>
                  </label>
                </div>
              </Card>
            )}
          </div>
        </ScrollArea>

        <DialogFooter className="gap-2">
          {isEditing ? (
            <>
              <Button variant="outline" onClick={handleCancel}>Cancel</Button>
              <Button onClick={handleSave}>Save Changes</Button>
            </>
          ) : (
            <>
              <Button 
                variant="outline" 
                onClick={() => {
                  if (confirm('Are you sure you want to delete this guest profile?')) {
                    onDelete(guest.id)
                  }
                }}
                className="mr-auto"
              >
                <Trash size={16} className="mr-2" weight="bold" />
                Delete
              </Button>
              <Button variant="outline" onClick={onClose}>Close</Button>
              <Button onClick={handleEdit}>Edit Profile</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface NewGuestDialogProps {
  open: boolean
  onClose: () => void
  onSubmit: (guest: GuestWithStats) => void
}

function NewGuestDialog({ open, onClose, onSubmit }: NewGuestDialogProps) {
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    nationality: '',
    idType: '',
    idNumber: '',
    vipStatus: false,
    notes: '',
  })

  const handleSubmit = () => {
    if (!formData.firstName || !formData.lastName) {
      toast.error('First name and last name are required')
      return
    }

    const newGuest: GuestWithStats = {
      id: `guest-${Date.now()}`,
      propertyId: 'prop-1',
      firstName: formData.firstName,
      lastName: formData.lastName,
      email: formData.email || null,
      phone: formData.phone || null,
      nationality: formData.nationality || null,
      idType: formData.idType || null,
      idNumber: formData.idNumber || null,
      dateOfBirth: null,
      vipStatus: formData.vipStatus,
      blacklisted: false,
      cautionFlag: false,
      preferences: null,
      notes: formData.notes || null,
      createdAt: new Date(),
      updatedAt: new Date(),
      totalStays: 0,
      totalRevenue: 0,
      upcomingStays: 0,
    }

    onSubmit(newGuest)
    
    setFormData({
      firstName: '',
      lastName: '',
      email: '',
      phone: '',
      nationality: '',
      idType: '',
      idNumber: '',
      vipStatus: false,
      notes: '',
    })
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>New Guest Profile</DialogTitle>
          <DialogDescription>Add a new guest to the directory</DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh] pr-4">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="firstName">First Name *</Label>
                <Input
                  id="firstName"
                  value={formData.firstName}
                  onChange={(e) => setFormData(prev => ({ ...prev, firstName: e.target.value }))}
                  className="mt-2"
                />
              </div>
              <div>
                <Label htmlFor="lastName">Last Name *</Label>
                <Input
                  id="lastName"
                  value={formData.lastName}
                  onChange={(e) => setFormData(prev => ({ ...prev, lastName: e.target.value }))}
                  className="mt-2"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
                  className="mt-2"
                />
              </div>
              <div>
                <Label htmlFor="phone">Phone</Label>
                <Input
                  id="phone"
                  value={formData.phone}
                  onChange={(e) => setFormData(prev => ({ ...prev, phone: e.target.value }))}
                  className="mt-2"
                />
              </div>
            </div>

            <div>
              <Label htmlFor="nationality">Nationality</Label>
              <Input
                id="nationality"
                value={formData.nationality}
                onChange={(e) => setFormData(prev => ({ ...prev, nationality: e.target.value }))}
                className="mt-2"
              />
            </div>

            <Separator />

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="idType">ID Type</Label>
                <Input
                  id="idType"
                  value={formData.idType}
                  onChange={(e) => setFormData(prev => ({ ...prev, idType: e.target.value }))}
                  className="mt-2"
                  placeholder="Passport, National ID, etc."
                />
              </div>
              <div>
                <Label htmlFor="idNumber">ID Number</Label>
                <Input
                  id="idNumber"
                  value={formData.idNumber}
                  onChange={(e) => setFormData(prev => ({ ...prev, idNumber: e.target.value }))}
                  className="mt-2"
                />
              </div>
            </div>

            <Separator />

            <div>
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                value={formData.notes}
                onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
                className="mt-2"
                rows={3}
                placeholder="Any special notes about this guest..."
              />
            </div>

            <label className="flex items-center gap-3 cursor-pointer p-3 border rounded-lg hover:bg-accent/50 transition-colors">
              <input
                type="checkbox"
                checked={formData.vipStatus}
                onChange={(e) => setFormData(prev => ({ ...prev, vipStatus: e.target.checked }))}
                className="w-4 h-4"
              />
              <div>
                <div className="font-medium flex items-center gap-2">
                  <Star size={16} weight="fill" className="text-yellow-500" />
                  VIP Status
                </div>
                <div className="text-xs text-muted-foreground">Mark this guest as VIP</div>
              </div>
            </label>
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit}>
            <Plus className="w-4 h-4 mr-2" weight="bold" />
            Create Guest Profile
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
