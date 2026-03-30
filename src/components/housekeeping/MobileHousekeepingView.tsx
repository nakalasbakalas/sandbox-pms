import { useState, useEffect, useMemo } from 'react'
import { useKV } from '@github/spark/hooks'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { 
  Broom, 
  CheckCircle, 
  Circle, 
  Clock, 
  Wrench,
  Warning,
  CaretRight,
  Note,
  Camera,
  ListChecks,
  Plus,
  X,
  User,
  CalendarBlank
} from '@phosphor-icons/react'
import type { HousekeepingRoom, CleanStatus, MaintenanceIssue, MaintenanceCategory, MaintenancePriority, CleaningChecklistItem } from '@/types/housekeeping'
import { toast } from 'sonner'
import { useRoomSync, convertBoardRoomToHousekeepingRoom } from '@/hooks/use-room-sync'
import { generateMockBoardData } from '@/lib/mock-board-data'
import { useNotifications } from '@/hooks/use-notifications'
import { NotificationBell } from '@/components/notifications/NotificationBell'
import { useRoomReadyNotifications } from '@/hooks/use-room-ready-notifications'

interface StatusHistoryEntry {
  timestamp: Date
  status: CleanStatus
  user: string
  notes?: string
}

export function MobileHousekeepingView() {
  const { rooms: boardRooms, updateRoomStatus, initializeRooms } = useRoomSync()
  const [maintenanceIssues, setMaintenanceIssues] = useKV<MaintenanceIssue[]>('maintenance-issues', [])
  const [statusHistory, setStatusHistory] = useKV<Record<string, StatusHistoryEntry[]>>('status-history', {})
  const [selectedRoom, setSelectedRoom] = useState<HousekeepingRoom | null>(null)
  const [isUpdating, setIsUpdating] = useState(false)
  const { addNotification } = useNotifications()
  const { sendNotification, shouldNotify } = useRoomReadyNotifications()

  useEffect(() => {
    if (boardRooms.length === 0) {
      initializeRooms(generateMockBoardData())
    }
  }, [boardRooms.length, initializeRooms])

  const rooms = useMemo(() => 
    boardRooms.map(convertBoardRoomToHousekeepingRoom),
    [boardRooms]
  )

  const handleUpdateRoomStatus = (roomId: string, newStatus: CleanStatus, notes?: string) => {
    setIsUpdating(true)
    
    updateRoomStatus({
      roomId,
      cleanStatus: newStatus,
      lastCleaned: newStatus === 'CLEAN' || newStatus === 'INSPECTED' ? new Date() : undefined,
      cleanedBy: newStatus === 'CLEAN' || newStatus === 'INSPECTED' ? 'Current User' : undefined
    })

    setStatusHistory((current) => {
      const currentHistory = current || {}
      return {
        ...currentHistory,
        [roomId]: [
          ...(currentHistory[roomId] || []),
          {
            timestamp: new Date(),
            status: newStatus,
            user: 'Current User',
            notes
          }
        ]
      }
    })
    
    setTimeout(() => {
      setIsUpdating(false)
      setSelectedRoom(null)
      const room = rooms?.find(r => r.roomId === roomId)
      if (room) {
        toast.success(`Room ${room.number} updated to ${newStatus}`)
        
        if ((newStatus === 'CLEAN' || newStatus === 'INSPECTED') && shouldNotify(newStatus)) {
          sendNotification(room, newStatus)
        }
      }
    }, 300)
  }

  const addMaintenanceIssue = (issue: Omit<MaintenanceIssue, 'id' | 'reportedAt'>) => {
    const newIssue: MaintenanceIssue = {
      ...issue,
      id: `issue-${Date.now()}`,
      reportedAt: new Date()
    }
    
    setMaintenanceIssues((current) => [...(current || []), newIssue])

    if (issue.priority === 'URGENT' || issue.priority === 'HIGH') {
      addNotification({
        type: issue.priority === 'URGENT' ? 'MAINTENANCE_URGENT' : 'HOUSEKEEPING_URGENT',
        priority: issue.priority,
        title: `${issue.priority === 'URGENT' ? '🚨 URGENT' : '⚠️'} Maintenance: Room ${issue.roomNumber}`,
        message: `${issue.category}: ${issue.title}`,
        roomNumber: issue.roomNumber,
        roomId: issue.roomId,
        actionRequired: true,
        metadata: {
          issueId: newIssue.id,
          category: issue.category,
          blockRoom: issue.blockRoom
        }
      })
    }

    toast.success(`Maintenance issue reported for Room ${issue.roomNumber}`)
  }

  const addRoomNote = (roomId: string, note: string) => {
    toast.success('Note added')
  }

  const dirtyRooms = (rooms || []).filter(r => r.cleanStatus === 'DIRTY').sort((a, b) => b.priority - a.priority)
  const cleanRooms = (rooms || []).filter(r => r.cleanStatus === 'CLEAN')
  const inProgressRooms = (rooms || []).filter(r => r.cleanStatus === 'CLEANING')
  const maintenanceRooms = (rooms || []).filter(r => r.hasMaintenanceIssue)

  const checkoutRooms = dirtyRooms.filter(r => r.isDepartureToday)
  const stayoverRooms = dirtyRooms.filter(r => !r.isDepartureToday)

  if (selectedRoom) {
    return <RoomDetailView 
      room={selectedRoom} 
      onBack={() => setSelectedRoom(null)}
      onUpdateStatus={handleUpdateRoomStatus}
      isUpdating={isUpdating}
      onAddMaintenanceIssue={addMaintenanceIssue}
      onAddNote={addRoomNote}
      statusHistory={(statusHistory || {})[selectedRoom.roomId] || []}
      maintenanceIssues={maintenanceIssues?.filter(i => i.roomId === selectedRoom.roomId) || []}
    />
  }

  return (
    <div className="min-h-screen bg-background pb-24">
      <div className="sticky top-0 z-10 bg-primary text-primary-foreground px-4 py-6 shadow-lg">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-semibold">Housekeeping</h1>
          <NotificationBell />
        </div>
        <div className="grid grid-cols-4 gap-4 text-sm">
          <div>
            <div className="text-3xl font-bold">{checkoutRooms.length}</div>
            <div className="opacity-90 text-xs">Checkouts</div>
          </div>
          <div>
            <div className="text-3xl font-bold">{dirtyRooms.length}</div>
            <div className="opacity-90 text-xs">To Clean</div>
          </div>
          <div>
            <div className="text-3xl font-bold">{inProgressRooms.length}</div>
            <div className="opacity-90 text-xs">Cleaning</div>
          </div>
          <div>
            <div className="text-3xl font-bold">{cleanRooms.length}</div>
            <div className="opacity-90 text-xs">Ready</div>
          </div>
        </div>
      </div>

      <Tabs defaultValue="checkouts" className="w-full">
        <TabsList className="w-full rounded-none border-b sticky top-[140px] bg-background z-10">
          <TabsTrigger value="checkouts" className="flex-1 text-xs">
            Checkouts ({checkoutRooms.length})
          </TabsTrigger>
          <TabsTrigger value="stayovers" className="flex-1 text-xs">
            Stayovers ({stayoverRooms.length})
          </TabsTrigger>
          <TabsTrigger value="progress" className="flex-1 text-xs">
            In Progress ({inProgressRooms.length})
          </TabsTrigger>
          <TabsTrigger value="issues" className="flex-1 text-xs">
            Issues ({maintenanceRooms.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="checkouts" className="m-0 px-4 pt-4">
          <div className="space-y-3">
            {checkoutRooms.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <CheckCircle size={48} className="mx-auto mb-3 opacity-50" />
                <p>All checkout rooms cleaned!</p>
              </div>
            ) : (
              checkoutRooms.map(room => (
                <RoomCard key={room.roomId} room={room} onSelect={setSelectedRoom} />
              ))
            )}
          </div>
        </TabsContent>

        <TabsContent value="stayovers" className="m-0 px-4 pt-4">
          <div className="space-y-3">
            {stayoverRooms.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <CheckCircle size={48} className="mx-auto mb-3 opacity-50" />
                <p>All stayover rooms cleaned!</p>
              </div>
            ) : (
              stayoverRooms.map(room => (
                <RoomCard key={room.roomId} room={room} onSelect={setSelectedRoom} />
              ))
            )}
          </div>
        </TabsContent>

        <TabsContent value="progress" className="m-0 px-4 pt-4">
          <div className="space-y-3">
            {inProgressRooms.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Broom size={48} className="mx-auto mb-3 opacity-50" />
                <p>No rooms being cleaned right now</p>
              </div>
            ) : (
              inProgressRooms.map(room => (
                <RoomCard key={room.roomId} room={room} onSelect={setSelectedRoom} />
              ))
            )}
          </div>
        </TabsContent>

        <TabsContent value="issues" className="m-0 px-4 pt-4">
          <div className="space-y-3">
            {maintenanceRooms.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <CheckCircle size={48} className="mx-auto mb-3 opacity-50" />
                <p>No maintenance issues!</p>
              </div>
            ) : (
              maintenanceRooms.map(room => (
                <RoomCard key={room.roomId} room={room} onSelect={setSelectedRoom} showMaintenance />
              ))
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}

interface RoomCardProps {
  room: HousekeepingRoom
  onSelect: (room: HousekeepingRoom) => void
  showMaintenance?: boolean
}

function RoomCard({ room, onSelect, showMaintenance }: RoomCardProps) {
  return (
    <Card 
      className="p-4 active:scale-[0.98] transition-transform cursor-pointer"
      onClick={() => onSelect(room)}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <div className="text-2xl font-bold">{room.number}</div>
            <Badge variant="secondary" className="text-xs">
              {room.type}
            </Badge>
            {room.isArrivalToday && (
              <Badge variant="default" className="text-xs bg-green-600">
                Arrival {room.arrivalTime}
              </Badge>
            )}
            {room.hasMaintenanceIssue && (
              <Badge variant="destructive" className="text-xs">
                <Wrench size={12} className="mr-1" weight="bold" />
                Issue
              </Badge>
            )}
          </div>
          
          {room.guestName && (
            <div className="text-sm text-muted-foreground mb-1">
              {room.guestName}
            </div>
          )}
          
          {room.isDepartureToday && room.checkOutTime && (
            <div className="flex items-center gap-1 text-sm text-orange-600 dark:text-orange-400">
              <Clock size={14} weight="bold" />
              <span>Checkout {room.checkOutTime}</span>
            </div>
          )}

          {showMaintenance && room.maintenanceNotes && (
            <div className="flex items-start gap-2 mt-2 text-sm">
              <Wrench size={16} className="text-red-600 mt-0.5 flex-shrink-0" weight="bold" />
              <span className="text-red-600 dark:text-red-400">{room.maintenanceNotes}</span>
            </div>
          )}
        </div>

        <div className="flex flex-col items-end gap-2">
          <StatusBadge status={room.cleanStatus} />
          <CaretRight size={20} className="text-muted-foreground" />
        </div>
      </div>
    </Card>
  )
}

interface RoomDetailViewProps {
  room: HousekeepingRoom
  onBack: () => void
  onUpdateStatus: (roomId: string, status: CleanStatus, notes?: string) => void
  isUpdating: boolean
  onAddMaintenanceIssue: (issue: Omit<MaintenanceIssue, 'id' | 'reportedAt'>) => void
  onAddNote: (roomId: string, note: string) => void
  statusHistory: StatusHistoryEntry[]
  maintenanceIssues: MaintenanceIssue[]
}

function RoomDetailView({ 
  room, 
  onBack, 
  onUpdateStatus, 
  isUpdating,
  onAddMaintenanceIssue,
  onAddNote,
  statusHistory,
  maintenanceIssues
}: RoomDetailViewProps) {
  const [showChecklist, setShowChecklist] = useState(false)
  const [showMaintenanceDialog, setShowMaintenanceDialog] = useState(false)
  const [showNoteDialog, setShowNoteDialog] = useState(false)
  const [showHistoryDialog, setShowHistoryDialog] = useState(false)

  return (
    <div className="min-h-screen bg-background pb-24">
      <div className="sticky top-0 z-10 bg-primary text-primary-foreground px-4 py-6 shadow-lg">
        <button 
          onClick={onBack}
          className="mb-4 text-primary-foreground hover:opacity-80 transition-opacity flex items-center gap-2"
        >
          ← Back to List
        </button>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold mb-1">Room {room.number}</h1>
            <div className="text-sm opacity-90">
              {room.type} • Floor {room.floor}
            </div>
          </div>
          <StatusBadge status={room.cleanStatus} large />
        </div>
      </div>

      <div className="p-4 space-y-4">
        {room.isArrivalToday && (
          <Card className="p-4 bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800">
            <div className="flex items-center gap-2 text-green-700 dark:text-green-300 font-medium">
              <Warning size={20} weight="bold" />
              <span>Arrival Today at {room.arrivalTime}</span>
            </div>
            <div className="text-sm text-green-600 dark:text-green-400 mt-1">
              Priority cleaning required
            </div>
          </Card>
        )}

        {room.isDepartureToday && (
          <Card className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Clock size={20} weight="bold" />
              <span className="font-medium">Departure Details</span>
            </div>
            <div className="text-sm text-muted-foreground">
              Checkout time: {room.checkOutTime}
            </div>
            {room.guestName && (
              <div className="text-sm text-muted-foreground">
                Guest: {room.guestName}
              </div>
            )}
          </Card>
        )}

        {room.specialInstructions && (
          <Card className="p-4 bg-blue-50 dark:bg-blue-950 border-blue-200 dark:border-blue-800">
            <div className="flex items-center gap-2 text-blue-700 dark:text-blue-300 font-medium mb-2">
              <Note size={20} weight="bold" />
              <span>Special Instructions</span>
            </div>
            <div className="text-sm text-blue-600 dark:text-blue-400">
              {room.specialInstructions}
            </div>
          </Card>
        )}

        {maintenanceIssues.length > 0 && (
          <Card className="p-4 bg-red-50 dark:bg-red-950 border-red-200 dark:border-red-800">
            <div className="flex items-center gap-2 text-red-700 dark:text-red-300 font-medium mb-3">
              <Wrench size={20} weight="bold" />
              <span>Maintenance Issues ({maintenanceIssues.length})</span>
            </div>
            <div className="space-y-2">
              {maintenanceIssues.map(issue => (
                <div key={issue.id} className="text-sm">
                  <div className="font-medium text-red-700 dark:text-red-300">{issue.title}</div>
                  <div className="text-red-600 dark:text-red-400">{issue.description}</div>
                  <div className="text-xs text-red-500 dark:text-red-500 mt-1">
                    {issue.priority} • {issue.category} • {issue.status}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}

        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="outline"
            onClick={() => setShowChecklist(true)}
            className="h-14"
          >
            <ListChecks size={20} className="mr-2" weight="bold" />
            Checklist
          </Button>
          <Button
            variant="outline"
            onClick={() => setShowNoteDialog(true)}
            className="h-14"
          >
            <Note size={20} className="mr-2" weight="bold" />
            Add Note
          </Button>
          <Button
            variant="outline"
            onClick={() => setShowMaintenanceDialog(true)}
            className="h-14"
          >
            <Wrench size={20} className="mr-2" weight="bold" />
            Report Issue
          </Button>
          <Button
            variant="outline"
            onClick={() => setShowHistoryDialog(true)}
            className="h-14"
          >
            <Clock size={20} className="mr-2" weight="bold" />
            History
          </Button>
        </div>

        <Separator className="my-6" />

        <div className="space-y-2">
          <h3 className="font-medium mb-3">Update Room Status</h3>
          
          {room.cleanStatus === 'DIRTY' && (
            <>
              <Button
                size="lg"
                className="w-full h-16 text-lg"
                variant="default"
                onClick={() => onUpdateStatus(room.roomId, 'CLEANING')}
                disabled={isUpdating}
              >
                <Broom size={24} className="mr-2" weight="bold" />
                Start Cleaning
              </Button>
              
              <Button
                size="lg"
                className="w-full h-16 text-lg"
                variant="outline"
                onClick={() => onUpdateStatus(room.roomId, 'CLEAN')}
                disabled={isUpdating}
              >
                <CheckCircle size={24} className="mr-2" weight="bold" />
                Mark as Clean
              </Button>
            </>
          )}

          {room.cleanStatus === 'CLEANING' && (
            <Button
              size="lg"
              className="w-full h-16 text-lg"
              variant="default"
              onClick={() => onUpdateStatus(room.roomId, 'CLEAN')}
              disabled={isUpdating}
            >
              <CheckCircle size={24} className="mr-2" weight="bold" />
              Finish Cleaning
            </Button>
          )}

          {room.cleanStatus === 'CLEAN' && (
            <Button
              size="lg"
              className="w-full h-16 text-lg"
              variant="default"
              onClick={() => onUpdateStatus(room.roomId, 'INSPECTED')}
              disabled={isUpdating}
            >
              <CheckCircle size={24} className="mr-2" weight="bold" />
              Mark as Inspected
            </Button>
          )}

          {room.cleanStatus !== 'DIRTY' && (
            <Button
              size="lg"
              className="w-full h-16 text-lg"
              variant="outline"
              onClick={() => onUpdateStatus(room.roomId, 'DIRTY')}
              disabled={isUpdating}
            >
              <Circle size={24} className="mr-2" />
              Mark as Dirty
            </Button>
          )}
        </div>
      </div>

      <CleaningChecklistDialog
        room={room}
        open={showChecklist}
        onClose={() => setShowChecklist(false)}
        onComplete={(notes) => onUpdateStatus(room.roomId, 'CLEAN', notes)}
      />

      <MaintenanceReportDialog
        room={room}
        open={showMaintenanceDialog}
        onClose={() => setShowMaintenanceDialog(false)}
        onSubmit={onAddMaintenanceIssue}
      />

      <NoteDialog
        room={room}
        open={showNoteDialog}
        onClose={() => setShowNoteDialog(false)}
        onSubmit={onAddNote}
      />

      <HistoryDialog
        room={room}
        open={showHistoryDialog}
        onClose={() => setShowHistoryDialog(false)}
        history={statusHistory}
      />
    </div>
  )
}

interface CleaningChecklistDialogProps {
  room: HousekeepingRoom
  open: boolean
  onClose: () => void
  onComplete: (notes?: string) => void
}

function CleaningChecklistDialog({ room, open, onClose, onComplete }: CleaningChecklistDialogProps) {
  const [checklist, setChecklist] = useState<CleaningChecklistItem[]>([
    { id: '1', category: 'BATHROOM', task: 'Clean toilet and sink', isCompleted: false, order: 1 },
    { id: '2', category: 'BATHROOM', task: 'Clean shower/bathtub', isCompleted: false, order: 2 },
    { id: '3', category: 'BATHROOM', task: 'Restock toiletries', isCompleted: false, order: 3 },
    { id: '4', category: 'BATHROOM', task: 'Replace towels', isCompleted: false, order: 4 },
    { id: '5', category: 'BEDROOM', task: 'Change bed linens', isCompleted: false, order: 5 },
    { id: '6', category: 'BEDROOM', task: 'Vacuum floor', isCompleted: false, order: 6 },
    { id: '7', category: 'BEDROOM', task: 'Dust surfaces', isCompleted: false, order: 7 },
    { id: '8', category: 'AMENITIES', task: 'Restock minibar', isCompleted: false, order: 8 },
    { id: '9', category: 'AMENITIES', task: 'Check TV remote batteries', isCompleted: false, order: 9 },
    { id: '10', category: 'GENERAL', task: 'Empty trash', isCompleted: false, order: 10 },
    { id: '11', category: 'GENERAL', task: 'Check AC/heating', isCompleted: false, order: 11 },
  ])
  const [notes, setNotes] = useState('')

  const toggleItem = (id: string) => {
    setChecklist(prev => prev.map(item => 
      item.id === id ? { ...item, isCompleted: !item.isCompleted } : item
    ))
  }

  const completedCount = checklist.filter(item => item.isCompleted).length
  const totalCount = checklist.length
  const progress = Math.round((completedCount / totalCount) * 100)

  const handleComplete = () => {
    onComplete(notes || undefined)
    onClose()
    setChecklist(prev => prev.map(item => ({ ...item, isCompleted: false })))
    setNotes('')
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[90vh] flex flex-col p-0">
        <DialogHeader className="px-6 pt-6 pb-4">
          <DialogTitle>Cleaning Checklist - Room {room.number}</DialogTitle>
          <DialogDescription>
            {completedCount} of {totalCount} tasks completed ({progress}%)
          </DialogDescription>
        </DialogHeader>
        
        <ScrollArea className="flex-1 px-6">
          <div className="space-y-4 pb-4">
            {['BATHROOM', 'BEDROOM', 'AMENITIES', 'GENERAL'].map(category => {
              const items = checklist.filter(item => item.category === category)
              if (items.length === 0) return null
              
              return (
                <div key={category}>
                  <h4 className="font-medium mb-2 text-sm text-muted-foreground">{category}</h4>
                  <div className="space-y-2">
                    {items.map(item => (
                      <div key={item.id} className="flex items-center gap-3">
                        <Checkbox
                          id={item.id}
                          checked={item.isCompleted}
                          onCheckedChange={() => toggleItem(item.id)}
                        />
                        <Label 
                          htmlFor={item.id}
                          className={`cursor-pointer flex-1 ${item.isCompleted ? 'line-through text-muted-foreground' : ''}`}
                        >
                          {item.task}
                        </Label>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}

            <div className="pt-4">
              <Label htmlFor="checklist-notes">Additional Notes (Optional)</Label>
              <Textarea
                id="checklist-notes"
                placeholder="Any observations or issues..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="mt-2"
                rows={3}
              />
            </div>
          </div>
        </ScrollArea>

        <DialogFooter className="px-6 pb-6 pt-4 border-t">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button 
            onClick={handleComplete}
            disabled={completedCount < totalCount}
          >
            <CheckCircle size={18} className="mr-2" weight="bold" />
            Complete Cleaning
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface MaintenanceReportDialogProps {
  room: HousekeepingRoom
  open: boolean
  onClose: () => void
  onSubmit: (issue: Omit<MaintenanceIssue, 'id' | 'reportedAt'>) => void
}

function MaintenanceReportDialog({ room, open, onClose, onSubmit }: MaintenanceReportDialogProps) {
  const [category, setCategory] = useState<MaintenanceCategory>('OTHER')
  const [priority, setPriority] = useState<MaintenancePriority>('MEDIUM')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [blockRoom, setBlockRoom] = useState(false)

  const handleSubmit = () => {
    if (!title.trim() || !description.trim()) {
      toast.error('Please fill in all required fields')
      return
    }

    onSubmit({
      roomId: room.roomId,
      roomNumber: room.number,
      category,
      title: title.trim(),
      description: description.trim(),
      priority,
      reportedBy: 'Current User',
      status: 'PENDING',
      blockRoom
    })

    setTitle('')
    setDescription('')
    setCategory('OTHER')
    setPriority('MEDIUM')
    setBlockRoom(false)
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Report Maintenance Issue</DialogTitle>
          <DialogDescription>Room {room.number}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label htmlFor="issue-category">Category</Label>
            <Select value={category} onValueChange={(v) => setCategory(v as MaintenanceCategory)}>
              <SelectTrigger id="issue-category" className="mt-2">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="AC">Air Conditioning</SelectItem>
                <SelectItem value="PLUMBING">Plumbing</SelectItem>
                <SelectItem value="ELECTRICAL">Electrical</SelectItem>
                <SelectItem value="FURNITURE">Furniture</SelectItem>
                <SelectItem value="BATHROOM">Bathroom</SelectItem>
                <SelectItem value="BEDDING">Bedding</SelectItem>
                <SelectItem value="OTHER">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="issue-priority">Priority</Label>
            <Select value={priority} onValueChange={(v) => setPriority(v as MaintenancePriority)}>
              <SelectTrigger id="issue-priority" className="mt-2">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="LOW">Low</SelectItem>
                <SelectItem value="MEDIUM">Medium</SelectItem>
                <SelectItem value="HIGH">High</SelectItem>
                <SelectItem value="URGENT">Urgent</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="issue-title">Issue Title</Label>
            <Input
              id="issue-title"
              placeholder="e.g., AC not cooling"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="mt-2"
            />
          </div>

          <div>
            <Label htmlFor="issue-description">Description</Label>
            <Textarea
              id="issue-description"
              placeholder="Describe the issue in detail..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="mt-2"
              rows={4}
            />
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="block-room"
              checked={blockRoom}
              onCheckedChange={(checked) => setBlockRoom(checked as boolean)}
            />
            <Label htmlFor="block-room" className="cursor-pointer">
              Block room from selling
            </Label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit}>
            <Wrench size={18} className="mr-2" weight="bold" />
            Submit Report
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface NoteDialogProps {
  room: HousekeepingRoom
  open: boolean
  onClose: () => void
  onSubmit: (roomId: string, note: string) => void
}

function NoteDialog({ room, open, onClose, onSubmit }: NoteDialogProps) {
  const [note, setNote] = useState(room.specialInstructions || '')

  const handleSubmit = () => {
    if (!note.trim()) {
      toast.error('Please enter a note')
      return
    }

    onSubmit(room.roomId, note.trim())
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Note - Room {room.number}</DialogTitle>
          <DialogDescription>
            Special instructions or observations
          </DialogDescription>
        </DialogHeader>

        <div>
          <Textarea
            placeholder="Enter note or special instructions..."
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={5}
            autoFocus
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit}>
            <Note size={18} className="mr-2" weight="bold" />
            Save Note
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface HistoryDialogProps {
  room: HousekeepingRoom
  open: boolean
  onClose: () => void
  history: StatusHistoryEntry[]
}

function HistoryDialog({ room, open, onClose, history }: HistoryDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Status History - Room {room.number}</DialogTitle>
          <DialogDescription>
            Recent status changes and updates
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-96">
          {history.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Clock size={48} className="mx-auto mb-3 opacity-50" />
              <p>No history available</p>
            </div>
          ) : (
            <div className="space-y-4">
              {[...history].reverse().map((entry, index) => (
                <div key={index} className="flex gap-3 pb-4 border-b last:border-0">
                  <div className="flex-shrink-0 mt-1">
                    <StatusBadge status={entry.status} />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 text-sm">
                      <User size={14} />
                      <span className="font-medium">{entry.user}</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                      <CalendarBlank size={14} />
                      <span>{new Date(entry.timestamp).toLocaleString()}</span>
                    </div>
                    {entry.notes && (
                      <div className="text-sm mt-2 text-muted-foreground">
                        {entry.notes}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>

        <DialogFooter>
          <Button onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface StatusBadgeProps {
  status: CleanStatus
  large?: boolean
}

function StatusBadge({ status, large }: StatusBadgeProps) {
  const config = {
    CLEAN: { label: 'Clean', className: 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300' },
    DIRTY: { label: 'Dirty', className: 'bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300' },
    INSPECTED: { label: 'Inspected', className: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300' },
    CLEANING: { label: 'Cleaning', className: 'bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300' },
  }

  const { label, className } = config[status]

  return (
    <Badge 
      className={`${className} ${large ? 'text-base px-4 py-1' : 'text-xs'}`}
      variant="secondary"
    >
      {label}
    </Badge>
  )
}
