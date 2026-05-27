import { useState, useMemo, useEffect, useCallback } from 'react'
import type { BoardRoomCard, DragOperation } from '@/types/board'
import { RoomCard } from './RoomCard'
import { BoardStatsBar } from './BoardStatsBar'
import { QuickActionsBar } from './QuickActionsBar'
import { StatusLegend } from './StatusLegend'
import { RoomContextMenu } from './RoomContextMenu'
import { BoardFiltersPopover, type BoardFilters } from './BoardFiltersPopover'
import { calculateBoardStats } from '@/lib/board-data'
import { createSandboxRooms } from '@/lib/hotel/rooms'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { MoneyDisplay } from '@/components/ui/money-display'
import { StatusPill } from '@/components/ui/status-pill'
import { MagnifyingGlass, Funnel, Command, CaretDown, CaretRight, Info, X, Check, Broom, SignOut, Users, Warning, Clock, Plus, Pencil, Robot } from '@phosphor-icons/react'
import { Card } from '@/components/ui/card'
import { toast } from 'sonner'
import { CommandPalette } from '@/components/CommandPalette'
import { useCommandPalette } from '@/hooks/use-command-palette'
import { useNavigation } from '@/hooks/use-navigation'
import { createPMSCommands } from '@/lib/pms-commands'
import { useRoomSync } from '@/hooks/use-room-sync'
import { cn } from '@/lib/utils'
import { addDays, format, isSameDay, isWeekend } from 'date-fns'
import { useKV } from '@github/spark/hooks'
import { ScrollArea } from '@/components/ui/scroll-area'
import { NewReservationDialog } from './NewReservationDialog'
import { EditReservationDialog } from './EditReservationDialog'
import { useKeyboardShortcuts } from '@/hooks/use-keyboard-shortcuts'
import { getBoardShortcuts } from '@/hooks/use-board-shortcuts'
import { useAutomaticHousekeepingMessaging } from '@/hooks/use-automatic-housekeeping-messaging'
import { AutomatedMessagingSettings } from '@/components/settings/AutomatedMessagingSettings'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { createAuditRecord, type AuditRecord } from '@/lib/hotel/operations'
import { getRoomAssignmentDecision } from '@/lib/hotel/business-rules'
import { useI18n, formatBangkokDate, formatBangkokTime } from '@/lib/i18n'

interface UnassignedReservation {
  id: string
  guestName: string
  checkIn: Date
  checkOut: Date
  roomType: 'TWIN' | 'DOUBLE'
  guestCount: number
  nights: number
  source: string
  isVIP?: boolean
  needsAttention?: boolean
}

export function Board() {
  const { rooms, lastUpdate, initializeRooms, setRooms } = useRoomSync()
  const { t, language } = useI18n()
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedRoom, setSelectedRoom] = useState<BoardRoomCard | null>(null)
  const [noteDraft, setNoteDraft] = useState('')
  const [draggingRoom, setDraggingRoom] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'7day' | '14day' | '30day'>('7day')
  const [collapsedRoomTypes, setCollapsedRoomTypes] = useState<Set<string>>(new Set())
  const [startDate] = useState(new Date())
  const [showUnassigned, setShowUnassigned] = useState(true)
  const [unassignedReservationsRaw, setUnassignedReservationsRaw] = useKV<UnassignedReservation[]>('unassigned-reservations', [])
  const [auditRecords, setAuditRecords] = useKV<AuditRecord[]>('audit-records', [])
  const [draggingReservation, setDraggingReservation] = useState<string | null>(null)
  
  const unassignedReservations = useMemo(() => 
    (unassignedReservationsRaw || []).map(res => ({
      ...res,
      checkIn: res.checkIn ? new Date(res.checkIn) : new Date(),
      checkOut: res.checkOut ? new Date(res.checkOut) : new Date(),
    })),
    [unassignedReservationsRaw]
  )
  
  const setUnassignedReservations = useCallback((updater: UnassignedReservation[] | ((current: UnassignedReservation[]) => UnassignedReservation[])) => {
    setUnassignedReservationsRaw((current) => {
      const deserialized = (current || []).map(res => ({
        ...res,
        checkIn: res.checkIn ? new Date(res.checkIn) : new Date(),
        checkOut: res.checkOut ? new Date(res.checkOut) : new Date(),
      }))
      const updated = typeof updater === 'function' ? updater(deserialized) : updater
      return updated
    })
  }, [setUnassignedReservationsRaw])
  const [resizingReservation, setResizingReservation] = useState<{
    roomId: string
    direction: 'start' | 'end'
    initialDate: Date
    currentDate: Date
  } | null>(null)
  const [filters, setFilters] = useState<BoardFilters>({
    showArrivals: true,
    showDepartures: true,
    showVacant: true,
    showOccupied: true,
    showDirty: true,
    showVIP: true,
    showIssues: true,
    showDepositPending: true,
  })
  const [showNewReservationDialog, setShowNewReservationDialog] = useState(false)
  const [prefilledReservation, setPrefilledReservation] = useState<{
    roomId?: string
    roomNumber?: string
    roomType?: 'TWIN' | 'DOUBLE'
    checkIn?: Date
  } | null>(null)
  const [showEditReservationDialog, setShowEditReservationDialog] = useState(false)
  const [editingRoom, setEditingRoom] = useState<BoardRoomCard | null>(null)
  const [showAutomationSettings, setShowAutomationSettings] = useState(false)
  
  const { navigate } = useNavigation()
  const commands = useMemo(() => createPMSCommands(navigate), [navigate])
  const commandPalette = useCommandPalette(commands)
  
  const automation = useAutomaticHousekeepingMessaging(rooms)

  const stats = useMemo(() => calculateBoardStats(rooms), [rooms])

  const roomAuditRecords = useMemo(() => {
    if (!selectedRoom) return []
    return (auditRecords || []).filter((record) =>
      record.entityId === selectedRoom.roomId || record.entityId === selectedRoom.reservationId
    ).slice(0, 5)
  }, [auditRecords, selectedRoom])

  const addAudit = useCallback((record: AuditRecord) => {
    setAuditRecords((current) => [record, ...(current || [])].slice(0, 200))
  }, [setAuditRecords])

  useEffect(() => {
    setNoteDraft(selectedRoom?.notes || '')
  }, [selectedRoom])

  const cycleViewMode = useCallback(() => {
    setViewMode(current => {
      const modes: Array<'7day' | '14day' | '30day'> = ['7day', '14day', '30day']
      const currentIndex = modes.indexOf(current)
      const nextMode = modes[(currentIndex + 1) % modes.length]
      toast.success(`View mode: ${nextMode.replace('day', ' days')}`)
      return nextMode
    })
  }, [])

  const clearAllFilters = useCallback(() => {
    setFilters({
      showArrivals: true,
      showDepartures: true,
      showVacant: true,
      showOccupied: true,
      showDirty: true,
      showVIP: true,
      showIssues: true,
      showDepositPending: true,
    })
    toast.success('All filters cleared')
  }, [])

  const focusSearchInput = useCallback(() => {
    const searchInput = document.querySelector('[placeholder="Search rooms..."]') as HTMLInputElement
    searchInput?.focus()
  }, [])

  const boardShortcuts = useMemo(() => getBoardShortcuts({
    openNewReservation: () => setShowNewReservationDialog(true),
    toggleUnassigned: () => setShowUnassigned(prev => !prev),
    cycleViewMode,
    focusSearch: focusSearchInput,
    clearFilters: clearAllFilters,
  }), [cycleViewMode, focusSearchInput, clearAllFilters])

  useKeyboardShortcuts(boardShortcuts, true)

  useEffect(() => {
    if (rooms.length === 0) {
      initializeRooms(createSandboxRooms())
    }
  }, [rooms.length, initializeRooms])

  useEffect(() => {
    if (lastUpdate) {
      const room = rooms.find(r => r.roomId === lastUpdate.roomId)
      if (room) {
        toast.success(
          `Room ${room.number} updated to ${lastUpdate.cleanStatus}`,
          { duration: 2000 }
        )
      }
    }
  }, [lastUpdate, rooms])

  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selectedRoom) {
        setSelectedRoom(null)
      }
      
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault()
        document.querySelector<HTMLInputElement>('input[type="text"]')?.focus()
      }

      if ((e.metaKey || e.ctrlKey) && e.key === '1') {
        e.preventDefault()
        setViewMode('7day')
      }
      if ((e.metaKey || e.ctrlKey) && e.key === '2') {
        e.preventDefault()
        setViewMode('14day')
      }
      if ((e.metaKey || e.ctrlKey) && e.key === '3') {
        e.preventDefault()
        setViewMode('30day')
      }
    }

    window.addEventListener('keydown', handleKeyPress)
    return () => window.removeEventListener('keydown', handleKeyPress)
  }, [selectedRoom])

  const dayCount = viewMode === '7day' ? 7 : viewMode === '14day' ? 14 : 30
  
  const dateColumns = useMemo(() => {
    return Array.from({ length: dayCount }, (_, i) => addDays(startDate, i))
  }, [startDate, dayCount])

  const filteredRooms = useMemo(() => {
    let result = rooms
    
    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      result = result.filter(room => 
        room.number.includes(query) ||
        room.guestName?.toLowerCase().includes(query) ||
        room.type.toLowerCase().includes(query)
      )
    }
    
    result = result.filter(room => {
      if (filters.showOccupied === false && room.guestName) return false
      if (filters.showVacant === false && !room.guestName) return false
      if (filters.showArrivals === false && room.isArrivalToday) return false
      if (filters.showDepartures === false && room.isDepartureToday) return false
      if (filters.showDirty === false && room.cleanStatus === 'DIRTY') return false
      if (filters.showVIP === false && room.isVIP) return false
      if (filters.showIssues === false && room.hasIssue) return false
      if (filters.showDepositPending === false && room.depositStatus === 'PENDING') return false
      
      return true
    })
    
    return result
  }, [rooms, searchQuery, filters])

  const activeFilterCount = useMemo(() => {
    return Object.values(filters).filter(v => v === false).length
  }, [filters])

  const twinRooms = useMemo(() => 
    filteredRooms.filter(r => r.type === 'TWIN').sort((a, b) => Number(a.number) - Number(b.number)),
    [filteredRooms]
  )

  const doubleRooms = useMemo(() => 
    filteredRooms.filter(r => r.type === 'DOUBLE').sort((a, b) => Number(a.number) - Number(b.number)),
    [filteredRooms]
  )

  const toggleRoomType = (roomType: string) => {
    setCollapsedRoomTypes(prev => {
      const next = new Set(prev)
      if (next.has(roomType)) {
        next.delete(roomType)
      } else {
        next.add(roomType)
      }
      return next
    })
  }

  const handleRoomClick = (room: BoardRoomCard) => {
    setSelectedRoom(room)
  }

  const handleDragStart = (room: BoardRoomCard) => (e: React.DragEvent) => {
    if (!room.guestName || !room.reservationId) return
    
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('application/json', JSON.stringify({
      type: 'MOVE_GUEST',
      sourceRoomId: room.roomId,
      reservationId: room.reservationId,
      guestName: room.guestName,
    } as DragOperation))
    
    setDraggingRoom(room.roomId)
  }

  const handleReservationDragStart = (reservation: UnassignedReservation) => (e: React.DragEvent) => {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('application/json', JSON.stringify({
      type: 'ASSIGN_ROOM',
      reservationId: reservation.id,
      guestName: reservation.guestName,
      roomType: reservation.roomType,
      checkIn: reservation.checkIn.toISOString(),
      checkOut: reservation.checkOut.toISOString(),
      guestCount: reservation.guestCount
    }))
    
    setDraggingReservation(reservation.id)
  }

  const handleDragOver = (room: BoardRoomCard) => (e: React.DragEvent) => {
    if (!draggingRoom && !draggingReservation) return
    if (room.roomId === draggingRoom) return
    
    const decision = getRoomAssignmentDecision(room, {
      checkIn: new Date(),
      checkOut: addDays(new Date(), 1),
    })
    
    if (decision.assignable) {
      e.preventDefault()
      setDropTarget(room.roomId)
    }
  }

  const handleDragLeave = () => {
    setDropTarget(null)
  }

  const handleDrop = (targetRoom: BoardRoomCard) => (e: React.DragEvent) => {
    e.preventDefault()
    
    if (!draggingRoom && !draggingReservation) return
    
    try {
      const dataStr = e.dataTransfer.getData('application/json')
      if (!dataStr) return
      
      const data = JSON.parse(dataStr)
      
      const assignmentDecision = getRoomAssignmentDecision(targetRoom, {
        checkIn: data.checkIn ? new Date(data.checkIn) : new Date(),
        checkOut: data.checkOut ? new Date(data.checkOut) : addDays(new Date(), 1),
        excludeReservationId: data.reservationId,
      })

      if (!assignmentDecision.assignable) {
        const reason = assignmentDecision.reason === 'occupied'
          ? 'This room is occupied and cannot be assigned to another reservation.'
          : `Room ${targetRoom.number} cannot be assigned because it is ${assignmentDecision.reason.replaceAll('_', ' ')}.`
        toast.error(reason)
        return
      }

      if (targetRoom.operationalStatus === 'AVAILABLE' && 
          (targetRoom.status === 'VACANT_CLEAN' || targetRoom.status === 'VACANT_DIRTY')) {
        
        if (data.type === 'MOVE_GUEST') {
          const sourceRoom = rooms.find(r => r.roomId === data.sourceRoomId)
          if (!sourceRoom) return
          
          setRooms((currentRooms) => 
            currentRooms.map(r => {
              if (r.roomId === data.sourceRoomId) {
                return {
                  ...r,
                  status: 'VACANT_DIRTY',
                  guestName: undefined,
                  reservationId: undefined,
                  checkIn: undefined,
                  checkOut: undefined,
                  guestCount: undefined,
                  isArrivalToday: false,
                  isDepartureToday: false,
                  nightsRemaining: undefined,
                  cleanStatus: 'DIRTY'
                }
              }
              if (r.roomId === targetRoom.roomId) {
                return {
                  ...r,
                  status: sourceRoom.cleanStatus === 'DIRTY' ? 'OCCUPIED_DIRTY' : 'OCCUPIED_CLEAN',
                  guestName: data.guestName,
                  reservationId: data.reservationId,
                  checkIn: sourceRoom.checkIn,
                  checkOut: sourceRoom.checkOut,
                  guestCount: sourceRoom.guestCount,
                  isArrivalToday: sourceRoom.isArrivalToday,
                  isDepartureToday: sourceRoom.isDepartureToday,
                  nightsRemaining: sourceRoom.nightsRemaining,
                  isVIP: sourceRoom.isVIP,
                  depositStatus: sourceRoom.depositStatus,
                  balanceDue: sourceRoom.balanceDue
                }
              }
              return r
            })
          )
          
          addAudit(createAuditRecord('room', targetRoom.roomId, 'MOVE_ROOM', `${data.guestName} moved from Room ${sourceRoom.number} to Room ${targetRoom.number}.`, 'Front desk'))
          toast.success(`${data.guestName} moved from Room ${sourceRoom.number} to Room ${targetRoom.number}`)
        } else if (data.type === 'ASSIGN_ROOM') {
          if (targetRoom.type !== data.roomType) {
            toast.error(`Cannot assign ${data.roomType} reservation to ${targetRoom.type} room`)
            return
          }
          
          setRooms((currentRooms) => 
            currentRooms.map(r => 
              r.roomId === targetRoom.roomId 
                ? {
                    ...r,
                    status: 'OCCUPIED_CLEAN',
                    guestName: data.guestName,
                    reservationId: data.reservationId,
                    checkIn: new Date(data.checkIn),
                    checkOut: new Date(data.checkOut),
                    guestCount: data.guestCount,
                    isArrivalToday: isSameDay(new Date(data.checkIn), new Date()),
                    isDepartureToday: isSameDay(new Date(data.checkOut), new Date()),
                    nightsRemaining: Math.ceil((new Date(data.checkOut).getTime() - Date.now()) / (24 * 60 * 60 * 1000))
                  }
                : r
            )
          )
          
          setUnassignedReservations((current) => 
            current.filter(r => r.id !== data.reservationId)
          )
          
          addAudit(createAuditRecord('reservation', data.reservationId, 'ASSIGN_ROOM', `${data.guestName} assigned to Room ${targetRoom.number}.`, 'Front desk'))
          toast.success(`${data.guestName} assigned to Room ${targetRoom.number}`)
        }
      }
    } catch (error) {
      toast.error('Failed to complete action')
    } finally {
      setDraggingRoom(null)
      setDraggingReservation(null)
      setDropTarget(null)
    }
  }

  const handleDragEnd = () => {
    setDraggingRoom(null)
    setDraggingReservation(null)
    setDropTarget(null)
  }

  const handleCheckOut = (room: BoardRoomCard) => {
    if (!room.guestName || !room.reservationId) return
    if (room.balanceDue && room.balanceDue > 0) {
      toast.error('Collect the remaining balance before checkout.', {
        description: `Room ${room.number} has an unpaid balance.`
      })
      return
    }
    
    setRooms((currentRooms) => 
      currentRooms.map(r => 
        r.roomId === room.roomId 
          ? {
              ...r,
              status: 'VACANT_DIRTY',
              cleanStatus: 'DIRTY',
              guestName: undefined,
              reservationId: undefined,
              checkIn: undefined,
              checkOut: undefined,
              guestCount: undefined,
              isArrivalToday: false,
              isDepartureToday: false,
              nightsRemaining: undefined,
              depositStatus: 'NONE',
              balanceDue: undefined,
              isVIP: false,
              housekeepingStatus: 'DIRTY',
              lastUpdatedAt: new Date().toISOString(),
              lastUpdatedBy: 'Front desk',
            }
          : r
      )
    )
    
    addAudit(createAuditRecord('reservation', room.reservationId, 'CHECKED_OUT', `${room.guestName} checked out from Room ${room.number}. Room marked dirty.`, 'Front desk'))
    automation.triggerManualCheckOut(room)
    toast.success(`${room.guestName} checked out from Room ${room.number}`)
    setSelectedRoom(null)
  }

  const handleMarkClean = (room: BoardRoomCard) => {
    setRooms((currentRooms) => 
      currentRooms.map(r => 
        r.roomId === room.roomId 
          ? {
              ...r,
              status: r.guestName ? 'OCCUPIED_CLEAN' : 'VACANT_CLEAN',
              cleanStatus: 'CLEAN',
              housekeepingStatus: 'CLEAN',
              lastCleaned: new Date(),
              lastUpdatedAt: new Date().toISOString(),
              lastUpdatedBy: 'Housekeeping',
            }
          : r
      )
    )
    
    addAudit(createAuditRecord('housekeeping', room.roomId, 'CLEAN', `Room ${room.number} marked clean.`, 'Housekeeping'))
    toast.success(`Room ${room.number} marked as clean`)
    setSelectedRoom(null)
  }

  const handleMarkInspected = (room: BoardRoomCard) => {
    if (room.cleanStatus === 'DIRTY') {
      toast.error(`Room ${room.number} must be cleaned before inspection.`)
      return
    }

    setRooms((currentRooms) =>
      currentRooms.map(r =>
        r.roomId === room.roomId
          ? {
              ...r,
              status: r.guestName ? 'OCCUPIED_CLEAN' : 'VACANT_CLEAN',
              cleanStatus: 'INSPECTED',
              housekeepingStatus: 'INSPECTED',
              lastCleaned: new Date(),
              lastUpdatedAt: new Date().toISOString(),
              lastUpdatedBy: 'Supervisor',
            }
          : r
      )
    )

    addAudit(createAuditRecord('housekeeping', room.roomId, 'INSPECTED', `Room ${room.number} marked inspected.`, 'Supervisor'))
    toast.success(`Room ${room.number} marked inspected.`)
    setSelectedRoom(null)
  }

  const handleMarkDirty = (room: BoardRoomCard) => {
    setRooms((currentRooms) => 
      currentRooms.map(r => 
        r.roomId === room.roomId 
          ? {
              ...r,
              status: r.guestName ? 'OCCUPIED_DIRTY' : 'VACANT_DIRTY',
              cleanStatus: 'DIRTY',
              housekeepingStatus: 'DIRTY',
              lastUpdatedAt: new Date().toISOString(),
              lastUpdatedBy: 'Staff',
            }
          : r
      )
    )
    
    addAudit(createAuditRecord('housekeeping', room.roomId, 'DIRTY', `Room ${room.number} marked dirty.`, 'Staff'))
    toast.success(`Room ${room.number} marked as dirty`)
  }

  const handleBlockRoom = (room: BoardRoomCard) => {
    if (room.guestName) {
      toast.error(`Room ${room.number} is occupied and cannot be blocked.`)
      return
    }

    setRooms((currentRooms) => 
      currentRooms.map(r => 
        r.roomId === room.roomId 
          ? {
              ...r,
              operationalStatus: 'BLOCKED',
              lastUpdatedAt: new Date().toISOString(),
              lastUpdatedBy: 'Manager',
            }
          : r
      )
    )
    
    addAudit(createAuditRecord('room', room.roomId, 'BLOCKED', `Room ${room.number} blocked.`, 'Manager'))
    toast.success(`Room ${room.number} blocked`)
    setSelectedRoom(null)
  }

  const handleUnblockRoom = (room: BoardRoomCard) => {
    setRooms((currentRooms) => 
      currentRooms.map(r => 
        r.roomId === room.roomId 
          ? {
              ...r,
              operationalStatus: 'AVAILABLE',
              hasIssue: false,
              housekeepingStatus: r.cleanStatus,
              lastUpdatedAt: new Date().toISOString(),
              lastUpdatedBy: 'Manager',
            }
          : r
      )
    )
    
    addAudit(createAuditRecord('room', room.roomId, 'AVAILABLE', `Room ${room.number} marked available.`, 'Manager'))
    toast.success(`Room ${room.number} is now available`)
    setSelectedRoom(null)
  }

  const checkReservationConflict = (roomId: string, newCheckIn: Date, newCheckOut: Date, currentReservationId?: string) => {
    const roomData = rooms.find(r => r.roomId === roomId)
    if (!roomData) return false

    if (roomData.guestName && roomData.checkIn && roomData.checkOut && roomData.reservationId !== currentReservationId) {
      const existingCheckIn = roomData.checkIn
      const existingCheckOut = roomData.checkOut

      const hasOverlap = newCheckIn < existingCheckOut && newCheckOut > existingCheckIn
      
      return hasOverlap
    }

    return false
  }

  const handleExtendStay = (room: BoardRoomCard, nights: number) => {
    if (!room.checkOut || !room.checkIn) return
    
    const newCheckOut = addDays(room.checkOut, nights)
    
    if (checkReservationConflict(room.roomId, room.checkIn, newCheckOut, room.reservationId)) {
      toast.error('Cannot extend: conflicting reservation exists', {
        description: 'Another reservation occupies this room during the extended period'
      })
      return
    }
    
    setRooms((currentRooms) => 
      currentRooms.map(r => 
        r.roomId === room.roomId 
          ? {
              ...r,
              checkOut: newCheckOut,
              nightsRemaining: Math.ceil((newCheckOut.getTime() - Date.now()) / (24 * 60 * 60 * 1000)),
              isDepartureToday: isSameDay(newCheckOut, new Date())
            }
          : r
      )
    )
    
    toast.success(`Stay extended by ${nights} night${nights !== 1 ? 's' : ''}`)
  }

  const handleShortenStay = (room: BoardRoomCard, nights: number) => {
    if (!room.checkOut) return
    
    const newCheckOut = addDays(room.checkOut, -nights)
    
    if (newCheckOut <= new Date()) {
      toast.error('Cannot shorten stay to past date')
      return
    }
    
    setRooms((currentRooms) => 
      currentRooms.map(r => 
        r.roomId === room.roomId 
          ? {
              ...r,
              checkOut: newCheckOut,
              nightsRemaining: Math.ceil((newCheckOut.getTime() - Date.now()) / (24 * 60 * 60 * 1000)),
              isDepartureToday: isSameDay(newCheckOut, new Date())
            }
          : r
      )
    )
    
    toast.success(`Stay shortened by ${nights} night${nights !== 1 ? 's' : ''}`)
  }

  const handleStayResize = (roomId: string, newCheckIn?: Date, newCheckOut?: Date) => {
    const room = rooms.find(r => r.roomId === roomId)
    if (!room) return

    if (newCheckOut && newCheckOut <= new Date()) {
      toast.error('Cannot set checkout to past date')
      return
    }

    if (newCheckIn && newCheckOut && newCheckIn >= newCheckOut) {
      toast.error('Check-in must be before check-out')
      return
    }

    const finalCheckIn = newCheckIn || room.checkIn
    const finalCheckOut = newCheckOut || room.checkOut

    if (!finalCheckIn || !finalCheckOut) return

    if (checkReservationConflict(roomId, finalCheckIn, finalCheckOut, room.reservationId)) {
      toast.error('Cannot extend: conflicting reservation exists', {
        description: 'Another reservation occupies this room during the extended period'
      })
      return
    }

    setRooms((currentRooms) =>
      currentRooms.map(r =>
        r.roomId === roomId
          ? {
              ...r,
              checkIn: newCheckIn || r.checkIn,
              checkOut: newCheckOut || r.checkOut,
              nightsRemaining: newCheckOut
                ? Math.ceil((newCheckOut.getTime() - Date.now()) / (24 * 60 * 60 * 1000))
                : r.nightsRemaining,
              isDepartureToday: newCheckOut ? isSameDay(newCheckOut, new Date()) : r.isDepartureToday,
              isArrivalToday: newCheckIn ? isSameDay(newCheckIn, new Date()) : r.isArrivalToday
            }
          : r
      )
    )

    const oldCheckIn = room.checkIn
    const oldCheckOut = room.checkOut

    if (finalCheckIn && finalCheckOut && oldCheckIn && oldCheckOut) {
      const oldNights = Math.ceil((oldCheckOut.getTime() - oldCheckIn.getTime()) / (24 * 60 * 60 * 1000))
      const newNights = Math.ceil((finalCheckOut.getTime() - finalCheckIn.getTime()) / (24 * 60 * 60 * 1000))
      const nightDiff = newNights - oldNights

      if (nightDiff > 0) {
        toast.success(`Stay extended by ${nightDiff} night${nightDiff !== 1 ? 's' : ''}`)
      } else if (nightDiff < 0) {
        toast.success(`Stay shortened by ${Math.abs(nightDiff)} night${Math.abs(nightDiff) !== 1 ? 's' : ''}`)
      }
    }
  }

  const handleToggleVIP = (room: BoardRoomCard) => {
    setRooms((currentRooms) =>
      currentRooms.map(r =>
        r.roomId === room.roomId
          ? { ...r, isVIP: !r.isVIP }
          : r
      )
    )
    toast.success(`Room ${room.number} ${room.isVIP ? 'removed from' : 'added to'} VIP status`)
  }

  const handlePostCharge = (room: BoardRoomCard) => {
    navigate('cashier')
    setSelectedRoom(null)
    toast.info('Cashier opened for posting charges.', {
      description: `Room ${room.number}${room.guestName ? ` - ${room.guestName}` : ''}`
    })
  }

  const handleViewFolio = (room: BoardRoomCard) => {
    navigate('cashier')
    setSelectedRoom(null)
    toast.info('Cashier opened for folio review.', {
      description: room.guestName ? `Review billing for ${room.guestName}.` : `Room ${room.number}`
    })
  }

  const handleAddNote = (room: BoardRoomCard) => {
    setSelectedRoom(room)
    setNoteDraft(room.notes || '')
  }

  const handlePrintRegistration = (room: BoardRoomCard) => {
    toast.success('Printing registration card', {
      description: `Guest: ${room.guestName}, Room: ${room.number}`
    })
  }

  const handleTransferRoom = (room: BoardRoomCard) => {
    toast.info('Transfer Room mode activated', {
      description: 'Drag the guest to another room or select a room'
    })
  }

  const handleMarkOutOfService = (room: BoardRoomCard) => {
    if (room.guestName) {
      toast.error(`Move or check out the guest before marking Room ${room.number} out of order.`)
      return
    }

    setRooms((currentRooms) =>
      currentRooms.map(r =>
        r.roomId === room.roomId
          ? {
              ...r,
              operationalStatus: 'OUT_OF_SERVICE',
              housekeepingStatus: 'MAINTENANCE',
              hasIssue: true,
              lastUpdatedAt: new Date().toISOString(),
              lastUpdatedBy: 'Manager',
            }
          : r
      )
    )
    addAudit(createAuditRecord('room', room.roomId, 'OUT_OF_SERVICE', `Room ${room.number} marked out of service.`, 'Manager'))
    toast.warning(`Room ${room.number} marked as Out of Service`)
  }

  const handleRequestHousekeeping = (room: BoardRoomCard) => {
    setRooms((currentRooms) =>
      currentRooms.map(r => r.roomId === room.roomId
        ? {
            ...r,
            housekeepingStatus: 'DIRTY',
            cleanStatus: 'DIRTY',
            status: r.guestName ? 'OCCUPIED_DIRTY' : 'VACANT_DIRTY',
            lastUpdatedAt: new Date().toISOString(),
            lastUpdatedBy: 'Front desk',
          }
        : r
      )
    )
    addAudit(createAuditRecord('housekeeping', room.roomId, 'REQUESTED', `Priority housekeeping requested for Room ${room.number}.`, 'Front desk'))
    toast.success(`Room ${room.number} sent to housekeeping priority queue.`)
  }

  const handleCopyReservation = (room: BoardRoomCard) => {
    const reservationText = `Room ${room.number}: ${room.guestName}\nCheck-in: ${room.checkIn ? format(room.checkIn, 'MMM d, yyyy') : 'N/A'}\nCheck-out: ${room.checkOut ? format(room.checkOut, 'MMM d, yyyy') : 'N/A'}\nGuests: ${room.guestCount || 'N/A'}`
    navigator.clipboard.writeText(reservationText)
    toast.success('Reservation info copied to clipboard')
  }

  const handleViewCalendar = (room: BoardRoomCard) => {
    toast.info('Room availability calendar would open here', {
      description: `View booking calendar for Room ${room.number}`
    })
  }

  const handleQuickCheckIn = (room: BoardRoomCard) => {
    const pendingReservation = unassignedReservations.find(r => r.roomType === room.type)
    
    if (pendingReservation) {
      const decision = getRoomAssignmentDecision(room, {
        checkIn: pendingReservation.checkIn,
        checkOut: pendingReservation.checkOut,
        excludeReservationId: pendingReservation.id,
      })

      if (!decision.assignable) {
        toast.error(`Room ${room.number} cannot be checked in because it is ${decision.reason.replaceAll('_', ' ')}.`)
        return
      }

      if (room.cleanStatus !== 'CLEAN' && room.cleanStatus !== 'INSPECTED') {
        toast.error(`Room ${room.number} must be clean or inspected before check-in.`)
        return
      }

      setRooms((currentRooms) => 
        currentRooms.map(r => 
          r.roomId === room.roomId 
            ? {
                ...r,
                status: 'OCCUPIED_CLEAN',
                guestName: pendingReservation.guestName,
                reservationId: pendingReservation.id,
                checkIn: pendingReservation.checkIn,
                checkOut: pendingReservation.checkOut,
                guestCount: pendingReservation.guestCount,
                isArrivalToday: isSameDay(pendingReservation.checkIn, new Date()),
                isDepartureToday: isSameDay(pendingReservation.checkOut, new Date()),
                nightsRemaining: pendingReservation.nights,
                isVIP: pendingReservation.isVIP || false,
                lastUpdatedAt: new Date().toISOString(),
                lastUpdatedBy: 'Front desk',
              }
            : r
        )
      )
      
      setUnassignedReservations((current) => 
        current.filter(r => r.id !== pendingReservation.id)
      )
      
      addAudit(createAuditRecord('reservation', pendingReservation.id, 'CHECKED_IN', `${pendingReservation.guestName} checked in to Room ${room.number}.`, 'Front desk'))
      toast.success(`${pendingReservation.guestName} checked into Room ${room.number}`)
    } else {
      toast.error(`No unassigned ${room.type} reservation is ready for check-in.`)
    }
    
    setSelectedRoom(null)
  }

  const handleUpdateReservation = (roomId: string, updates: {
    guestName?: string
    checkIn?: Date
    checkOut?: Date
    guestCount?: number
    depositStatus?: 'NONE' | 'PENDING' | 'PARTIAL' | 'PAID'
    balanceDue?: number
    isVIP?: boolean
    specialRequests?: string
  }) => {
    setRooms((currentRooms) => 
      currentRooms.map(r => {
        if (r.roomId === roomId) {
          const updatedRoom = { ...r, ...updates }
          
          if (updates.checkIn || updates.checkOut) {
            updatedRoom.nightsRemaining = updates.checkOut 
              ? Math.ceil((updates.checkOut.getTime() - Date.now()) / (24 * 60 * 60 * 1000))
              : r.nightsRemaining
            updatedRoom.isArrivalToday = updates.checkIn ? isSameDay(updates.checkIn, new Date()) : r.isArrivalToday
            updatedRoom.isDepartureToday = updates.checkOut ? isSameDay(updates.checkOut, new Date()) : r.isDepartureToday
          }
          
          return updatedRoom
        }
        return r
      })
    )
  }

  const handleDeleteReservation = (roomId: string) => {
    setRooms((currentRooms) => 
      currentRooms.map(r => 
        r.roomId === roomId 
          ? {
              ...r,
              status: 'VACANT_DIRTY',
              cleanStatus: 'DIRTY',
              guestName: undefined,
              reservationId: undefined,
              checkIn: undefined,
              checkOut: undefined,
              guestCount: undefined,
              isArrivalToday: false,
              isDepartureToday: false,
              nightsRemaining: undefined,
              depositStatus: 'NONE',
              balanceDue: undefined,
              isVIP: false
            }
          : r
      )
    )
  }

  return (
    <div className="h-full flex gap-3 bg-background p-3">
      {showUnassigned && unassignedReservations.length > 0 && (
        <div className="w-60 flex-shrink-0 rounded-xl bg-card border border-border/50 flex flex-col overflow-hidden">
          <div className="px-3 py-2.5 border-b border-border/40">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h3 className="text-xs font-semibold text-foreground">Unassigned</h3>
                <span className="inline-flex items-center justify-center h-4.5 min-w-[18px] rounded-full bg-rose-100 text-rose-700 text-[10px] font-semibold px-1.5">
                  {unassignedReservations.length}
                </span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowUnassigned(false)}
                className="h-5 w-5 p-0 text-muted-foreground hover:text-foreground"
              >
                <X className="w-3 h-3" />
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground mt-0.5">Drag to assign a room</p>
          </div>
          <ScrollArea className="flex-1">
            <div className="p-2 space-y-1.5">
              {unassignedReservations.map((reservation) => (
                <div
                  key={reservation.id}
                  draggable
                  onDragStart={handleReservationDragStart(reservation)}
                  onDragEnd={handleDragEnd}
                  className={cn(
                    "rounded-lg border px-2.5 py-2 cursor-grab active:cursor-grabbing transition-all",
                    draggingReservation === reservation.id && "opacity-30 scale-95",
                    reservation.isVIP && "border-amber-300 bg-amber-50/60",
                    reservation.needsAttention && "border-rose-300 bg-rose-50/60",
                    !reservation.isVIP && !reservation.needsAttention && "border-border/60 bg-background hover:border-border hover:bg-muted/30"
                  )}
                >
                  <div className="space-y-1">
                    <div className="flex items-start justify-between gap-1.5">
                      <span className="text-[11px] font-semibold text-foreground truncate flex-1 leading-snug">
                        {reservation.guestName}
                      </span>
                      <span className="text-[9px] text-muted-foreground font-medium flex-shrink-0 bg-muted/60 px-1 py-0.5 rounded">
                        {reservation.roomType}
                      </span>
                    </div>
                    
                    <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                      <span>{format(reservation.checkIn, 'MMM d')}</span>
                      <span className="text-muted-foreground/40">–</span>
                      <span>{format(reservation.checkOut, 'MMM d')}</span>
                      <span className="text-muted-foreground/40 mx-0.5">·</span>
                      <span>{reservation.nights}n</span>
                    </div>
                    
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                        <Users className="w-2.5 h-2.5" />
                        <span>{reservation.guestCount}</span>
                      </div>
                      <span className="text-[9px] text-muted-foreground/70">{reservation.source}</span>
                    </div>
                    
                    {reservation.isVIP && (
                      <span className="inline-flex items-center text-[9px] font-medium text-amber-700">★ VIP</span>
                    )}
                    
                    {reservation.needsAttention && (
                      <div className="flex items-center gap-1 text-[9px] text-rose-600 font-medium">
                        <Warning className="w-2.5 h-2.5" weight="fill" />
                        Needs attention
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>
      )}
      
      <div className="flex-1 flex flex-col min-w-0 gap-3">
        {/* Top Bar: Title + Actions */}
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold leading-tight tracking-tight text-foreground">Room Board</h1>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {format(new Date(), 'EEEE, MMMM d, yyyy')} · 30 rooms
            </p>
          </div>
          
          <div className="flex items-center gap-2">
            {/* Primary CTA */}
            <Button
              onClick={() => {
                setPrefilledReservation(null)
                setShowNewReservationDialog(true)
              }}
              className="h-8 gap-1.5 text-xs font-medium px-3.5"
            >
              <Plus className="w-3.5 h-3.5" weight="bold" />
              New Reservation
            </Button>

            {/* Alert: Unassigned */}
            {!showUnassigned && unassignedReservations.length > 0 && (
              <button
                onClick={() => setShowUnassigned(true)}
                className="inline-flex items-center gap-1.5 h-8 rounded-lg border border-amber-300 bg-amber-50 px-3 text-xs font-medium text-amber-800 hover:bg-amber-100 transition-colors"
              >
                <span className="inline-flex items-center justify-center h-4.5 min-w-[18px] rounded-full bg-amber-600 text-white text-[10px] font-semibold px-1">
                  {unassignedReservations.length}
                </span>
                Unassigned
              </button>
            )}

            <div className="h-5 w-px bg-border/50" />

            {/* Utilities */}
            {lastUpdate && (
              <div className="hidden lg:flex items-center gap-1.5 text-[10px] text-emerald-600">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <span className="font-medium">Live</span>
              </div>
            )}
            <div className="relative w-40">
              <MagnifyingGlass className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                placeholder="Search rooms..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 h-8 text-xs border-border/50 bg-muted/30 focus:bg-background"
              />
            </div>
            <BoardFiltersPopover
              filters={filters}
              onFiltersChange={setFilters}
              activeCount={activeFilterCount}
            />
            <Button 
              variant="ghost" 
              size="sm"
              onClick={commandPalette.open}
              className="h-8 text-xs font-medium text-muted-foreground hover:text-foreground px-2"
            >
              <Command className="w-3.5 h-3.5" />
              <kbd className="pointer-events-none hidden h-4 select-none items-center gap-0.5 rounded border bg-muted px-1 font-mono text-[9px] text-muted-foreground ml-1.5 md:inline-flex">
                ⌘K
              </kbd>
            </Button>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground">
                  <Info className="w-3.5 h-3.5" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-[320px]">
                <StatusLegend />
              </PopoverContent>
            </Popover>
          </div>
        </div>

        <BoardStatsBar stats={stats} />

        <QuickActionsBar 
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          filterCount={activeFilterCount}
          automationEnabled={automation.config.enabled}
          onOpenAutomation={() => setShowAutomationSettings(true)}
        />

        <div className="flex-1 overflow-auto rounded-xl border border-border/40 bg-card">
          <div className="calendar-board">
            <div className="sticky top-0 z-20 bg-muted/80 backdrop-blur-sm border-b border-border/40">
              <div className="flex">
                <div className="w-28 flex-shrink-0 border-r border-border/30 py-2.5 px-3">
                  <div className="text-[10px] font-medium text-muted-foreground tracking-wide">Room</div>
                </div>
                
                <div className="flex-1 flex overflow-x-auto">
                  {dateColumns.map((date, i) => {
                    const isToday = isSameDay(date, new Date())
                    const isWeekendDay = isWeekend(date)
                    return (
                      <div 
                        key={i} 
                        className={cn(
                          "flex-1 min-w-[80px] border-r border-border/20 py-2 px-2 text-center transition-colors",
                          isToday && "bg-blue-50 border-x border-x-blue-200",
                          isWeekendDay && !isToday && "bg-muted/40"
                        )}
                      >
                        <div className={cn(
                          "text-[9px] font-medium uppercase tracking-wide",
                          isToday ? "text-blue-600" : "text-muted-foreground/70"
                        )}>
                          {format(date, 'EEE')}
                        </div>
                        <div className={cn(
                          "text-sm font-semibold leading-none my-0.5",
                          isToday ? "text-blue-600" : "text-foreground"
                        )}>
                          {format(date, 'd')}
                        </div>
                        <div className={cn(
                          "text-[9px] font-normal",
                          isToday ? "text-blue-500" : "text-muted-foreground/60"
                        )}>
                          {format(date, 'MMM')}
                        </div>
                        {isToday && (
                          <div className="mx-auto mt-1 w-1 h-1 rounded-full bg-blue-500" />
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>

            <div>
              <RoomTypeRow
                title="Twin Rooms"
                subtitle="Floor 2"
                rooms={twinRooms}
                dateColumns={dateColumns}
                isCollapsed={collapsedRoomTypes.has('TWIN')}
                onToggleCollapse={() => toggleRoomType('TWIN')}
                onRoomClick={handleRoomClick}
                onReservationClick={(room) => {
                  setEditingRoom(room)
                  setShowEditReservationDialog(true)
                }}
                draggingRoom={draggingRoom}
                draggingReservation={draggingReservation}
                dropTarget={dropTarget}
                resizingReservation={resizingReservation}
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                onDragLeave={handleDragLeave}
                onDragEnd={handleDragEnd}
                onStayResize={handleStayResize}
                onResizeStart={setResizingReservation}
                onResizeEnd={() => setResizingReservation(null)}
                onEmptyBlockClick={(room, date) => {
                  setPrefilledReservation({
                    roomId: room.roomId,
                    roomNumber: room.number,
                    roomType: room.type as 'TWIN' | 'DOUBLE',
                    checkIn: date,
                  })
                  setShowNewReservationDialog(true)
                }}
                contextMenuHandlers={{
                  onCheckOut: handleCheckOut,
                  onMarkClean: handleMarkClean,
                  onMarkDirty: handleMarkDirty,
                  onBlock: handleBlockRoom,
                  onUnblock: handleUnblockRoom,
                  onExtend: handleExtendStay,
                  onShorten: handleShortenStay,
                  onQuickCheckIn: handleQuickCheckIn,
                  onToggleVIP: handleToggleVIP,
                  onPostCharge: handlePostCharge,
                  onViewFolio: handleViewFolio,
                  onAddNote: handleAddNote,
                  onPrintRegistration: handlePrintRegistration,
                  onTransferRoom: handleTransferRoom,
                  onMarkOutOfService: handleMarkOutOfService,
                  onRequestHousekeeping: handleRequestHousekeeping,
                  onCopyReservation: handleCopyReservation,
                  onViewCalendar: handleViewCalendar,
                }}
              />

              <RoomTypeRow
                title="Double Rooms"
                subtitle="Floor 3"
                rooms={doubleRooms}
                dateColumns={dateColumns}
                isCollapsed={collapsedRoomTypes.has('DOUBLE')}
                onToggleCollapse={() => toggleRoomType('DOUBLE')}
                onRoomClick={handleRoomClick}
                onReservationClick={(room) => {
                  setEditingRoom(room)
                  setShowEditReservationDialog(true)
                }}
                draggingRoom={draggingRoom}
                draggingReservation={draggingReservation}
                dropTarget={dropTarget}
                resizingReservation={resizingReservation}
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                onDragLeave={handleDragLeave}
                onDragEnd={handleDragEnd}
                onStayResize={handleStayResize}
                onResizeStart={setResizingReservation}
                onResizeEnd={() => setResizingReservation(null)}
                onEmptyBlockClick={(room, date) => {
                  setPrefilledReservation({
                    roomId: room.roomId,
                    roomNumber: room.number,
                    roomType: room.type as 'TWIN' | 'DOUBLE',
                    checkIn: date,
                  })
                  setShowNewReservationDialog(true)
                }}
                contextMenuHandlers={{
                  onCheckOut: handleCheckOut,
                  onMarkClean: handleMarkClean,
                  onMarkDirty: handleMarkDirty,
                  onBlock: handleBlockRoom,
                  onUnblock: handleUnblockRoom,
                  onExtend: handleExtendStay,
                  onShorten: handleShortenStay,
                  onQuickCheckIn: handleQuickCheckIn,
                  onToggleVIP: handleToggleVIP,
                  onPostCharge: handlePostCharge,
                  onViewFolio: handleViewFolio,
                  onAddNote: handleAddNote,
                  onPrintRegistration: handlePrintRegistration,
                  onTransferRoom: handleTransferRoom,
                  onMarkOutOfService: handleMarkOutOfService,
                  onRequestHousekeeping: handleRequestHousekeeping,
                  onCopyReservation: handleCopyReservation,
                  onViewCalendar: handleViewCalendar,
                }}
              />
            </div>
          </div>
        </div>
      </div>

      <Sheet open={!!selectedRoom} onOpenChange={(open) => !open && setSelectedRoom(null)}>
        <SheetContent className="w-[500px] sm:w-[600px]">
          {selectedRoom && (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-3">
                  <span>Room {selectedRoom.number}</span>
                  <Badge variant="outline" className="text-xs">
                    {selectedRoom.type}
                  </Badge>
                  {selectedRoom.isVIP && (
                    <Badge className="text-xs bg-amber-500 hover:bg-amber-600">
                      VIP
                    </Badge>
                  )}
                </SheetTitle>
              </SheetHeader>
              
              <div className="mt-6 space-y-4">
                <Card className={cn(
                  "p-4 border-2 transition-colors",
                  selectedRoom.status.includes('OCCUPIED') && "bg-primary/5 border-primary/20",
                  selectedRoom.status.includes('VACANT_CLEAN') && "bg-green-500/5 border-green-500/20",
                  selectedRoom.status.includes('VACANT_DIRTY') && "bg-orange-500/5 border-orange-500/20"
                )}>
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-xs font-medium text-muted-foreground mb-1">Current Status</div>
                      <div className="text-lg font-bold">
                        {selectedRoom.status.replace('_', ' ')}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={selectedRoom.cleanStatus === 'CLEAN' ? 'default' : 'secondary'}>
                        {selectedRoom.cleanStatus}
                      </Badge>
                      {selectedRoom.operationalStatus !== 'AVAILABLE' && (
                        <Badge variant="destructive">
                          {selectedRoom.operationalStatus.replace('_', ' ')}
                        </Badge>
                      )}
                    </div>
                  </div>
                </Card>

                {selectedRoom.guestName && (
                  <Card className="p-4 space-y-4">
                    <div>
                      <div className="text-xs font-medium text-muted-foreground mb-2">Guest Information</div>
                      <div className="text-xl font-bold">{selectedRoom.guestName}</div>
                      {selectedRoom.guestCount && (
                        <div className="flex items-center gap-1 mt-2 text-sm text-muted-foreground">
                          <Users className="w-4 h-4" />
                          <span>{selectedRoom.guestCount} {selectedRoom.guestCount === 1 ? 'guest' : 'guests'}</span>
                        </div>
                      )}
                    </div>
                    
                    <Separator />
                    
                    {selectedRoom.checkIn && selectedRoom.checkOut && (
                      <div className="grid grid-cols-3 gap-4">
                        <div>
                          <div className="text-xs font-medium text-muted-foreground mb-1">Check-in</div>
                          <div className="text-sm font-semibold">
                            {format(selectedRoom.checkIn, 'MMM d, yyyy')}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {format(selectedRoom.checkIn, 'EEE')}
                          </div>
                        </div>
                        <div>
                          <div className="text-xs font-medium text-muted-foreground mb-1">Check-out</div>
                          <div className="text-sm font-semibold">
                            {format(selectedRoom.checkOut, 'MMM d, yyyy')}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {format(selectedRoom.checkOut, 'EEE')}
                          </div>
                        </div>
                        <div>
                          <div className="text-xs font-medium text-muted-foreground mb-1">Remaining</div>
                          <div className="text-2xl font-bold text-primary">
                            {selectedRoom.nightsRemaining}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {selectedRoom.nightsRemaining === 1 ? 'night' : 'nights'}
                          </div>
                        </div>
                      </div>
                    )}
                    
                    {selectedRoom.reservationId && (
                      <div className="pt-2">
                        <div className="text-[10px] text-muted-foreground uppercase tracking-wider">
                          Reservation ID
                        </div>
                        <div className="text-xs font-mono mt-1 text-foreground/70">
                          {selectedRoom.reservationId}
                        </div>
                      </div>
                    )}
                  </Card>
                )}

                {selectedRoom.balanceDue && selectedRoom.balanceDue > 0 && (
                  <Card className="p-4 bg-gradient-to-br from-orange-50 to-orange-100 border-2 border-orange-300">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-xs font-semibold text-orange-900 mb-1 uppercase tracking-wide">Outstanding Balance</div>
                        <div className="text-3xl font-bold text-orange-600">
                          ฿{selectedRoom.balanceDue.toLocaleString()}
                        </div>
                      </div>
                      <Badge variant="outline" className="bg-white border-orange-300 text-orange-700">
                        {selectedRoom.depositStatus}
                      </Badge>
                    </div>
                  </Card>
                )}

                {selectedRoom.hasIssue && (
                  <Card className="p-3 bg-destructive/5 border-destructive/20">
                    <div className="flex items-start gap-2">
                      <Warning weight="fill" className="w-4 h-4 text-destructive flex-shrink-0 mt-0.5" />
                      <div>
                        <div className="text-xs font-semibold text-destructive">Room Issue Reported</div>
                        <div className="text-xs text-muted-foreground mt-1">Maintenance required</div>
                      </div>
                    </div>
                  </Card>
                )}

                <Separator />

                <div className="space-y-2">
                  {selectedRoom.guestName && (
                    <>
                      <Button 
                        variant="outline"
                        className="w-full gap-2" 
                        size="lg"
                        onClick={() => {
                          setEditingRoom(selectedRoom)
                          setShowEditReservationDialog(true)
                          setSelectedRoom(null)
                        }}
                      >
                        <Pencil className="w-4 h-4" />
                        Edit Reservation
                      </Button>
                      <Button 
                        className="w-full gap-2" 
                        size="lg"
                        onClick={() => handleCheckOut(selectedRoom)}
                      >
                        <SignOut className="w-4 h-4" />
                        Check Out Guest
                      </Button>
                      <div className="grid grid-cols-3 gap-2">
                        <Button 
                          variant="outline" 
                          size="sm"
                          onClick={() => handleExtendStay(selectedRoom, 1)}
                        >
                          +1 Night
                        </Button>
                        <Button 
                          variant="outline" 
                          size="sm"
                          onClick={() => handleExtendStay(selectedRoom, 2)}
                        >
                          +2 Nights
                        </Button>
                        <Button 
                          variant="outline" 
                          size="sm"
                          onClick={() => handleShortenStay(selectedRoom, 1)}
                        >
                          -1 Night
                        </Button>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <Button 
                          variant="outline" 
                          size="sm"
                          onClick={() => toast.info('Drag guest to another room to move')}
                        >
                          Move Guest
                        </Button>
                        <Button 
                          variant="outline" 
                          size="sm"
                          onClick={() => {
                            navigate('cashier')
                            setSelectedRoom(null)
                            toast.info(`Opened cashier for Room ${selectedRoom.number}`)
                          }}
                        >
                          Add Charge
                        </Button>
                      </div>
                      {selectedRoom.cleanStatus === 'DIRTY' && (
                        <Button 
                          variant="secondary" 
                          className="w-full gap-2" 
                          size="sm"
                          onClick={() => handleMarkClean(selectedRoom)}
                        >
                          <Broom className="w-4 h-4" />
                          Mark as Clean
                        </Button>
                      )}
                      {selectedRoom.cleanStatus === 'CLEAN' && (
                        <Button 
                          variant="outline" 
                          className="w-full gap-2" 
                          size="sm"
                          onClick={() => handleMarkDirty(selectedRoom)}
                        >
                          Mark as Dirty
                        </Button>
                      )}
                      <Button 
                        variant="outline" 
                        className="w-full" 
                        size="sm"
                        onClick={() => {
                          navigate('cashier')
                          setSelectedRoom(null)
                          toast.info(`Opened folio tools for Room ${selectedRoom.number}`)
                        }}
                      >
                        View Folio
                      </Button>
                    </>
                  )}
                  
                  {!selectedRoom.guestName && selectedRoom.operationalStatus === 'AVAILABLE' && (
                    <>
                      {selectedRoom.cleanStatus === 'DIRTY' && (
                        <Button 
                          className="w-full gap-2" 
                          variant="secondary" 
                          size="lg"
                          onClick={() => handleMarkClean(selectedRoom)}
                        >
                          <Broom className="w-4 h-4" />
                          Mark as Clean
                        </Button>
                      )}
                      {selectedRoom.cleanStatus === 'CLEAN' && (
                        <Button 
                          className="w-full gap-2" 
                          size="lg"
                          onClick={() => handleQuickCheckIn(selectedRoom)}
                        >
                          <Check className="w-4 h-4" />
                          Quick Check-In
                        </Button>
                      )}
                      <Button 
                        variant="outline" 
                        className="w-full" 
                        size="sm"
                        onClick={() => handleBlockRoom(selectedRoom)}
                      >
                        Block Room
                      </Button>
                    </>
                  )}
                  
                  {selectedRoom.operationalStatus === 'BLOCKED' && (
                    <Button 
                      className="w-full" 
                      variant="outline"
                      onClick={() => handleUnblockRoom(selectedRoom)}
                    >
                      Unblock Room
                    </Button>
                  )}
                  
                  {selectedRoom.operationalStatus === 'OUT_OF_SERVICE' && (
                    <Button 
                      className="w-full" 
                      variant="outline"
                      onClick={() => handleUnblockRoom(selectedRoom)}
                    >
                      Mark Available
                    </Button>
                  )}
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      <CommandPalette
        open={commandPalette.isOpen}
        onOpenChange={commandPalette.close}
        commands={commands}
      />

      <NewReservationDialog
        open={showNewReservationDialog}
        onClose={() => {
          setShowNewReservationDialog(false)
          setPrefilledReservation(null)
        }}
        prefilledData={prefilledReservation}
        onSubmit={(reservation) => {
          setUnassignedReservations((current) => [
            ...current,
            {
              id: reservation.id,
              guestName: `${reservation.guest.firstName} ${reservation.guest.lastName}`,
              checkIn: reservation.checkIn,
              checkOut: reservation.checkOut,
              roomType: reservation.roomTypeName === 'Twin Room' ? 'TWIN' : 'DOUBLE',
              guestCount: reservation.adults + reservation.children,
              nights: Math.ceil((reservation.checkOut.getTime() - reservation.checkIn.getTime()) / (24 * 60 * 60 * 1000)),
              source: reservation.source === 'DIRECT' ? 'Direct' : reservation.source === 'BOOKING_COM' ? 'Booking.com' : reservation.source,
              isVIP: false,
            }
          ])
          toast.success('Reservation created and added to unassigned list')
          setShowNewReservationDialog(false)
          setPrefilledReservation(null)
        }}
      />

      <EditReservationDialog
        open={showEditReservationDialog}
        onClose={() => {
          setShowEditReservationDialog(false)
          setEditingRoom(null)
        }}
        room={editingRoom}
        onUpdate={handleUpdateReservation}
        onDelete={handleDeleteReservation}
      />

      <Dialog open={showAutomationSettings} onOpenChange={setShowAutomationSettings}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Automated Housekeeping Messaging</DialogTitle>
          </DialogHeader>
          <AutomatedMessagingSettings
            config={automation.config}
            onConfigChange={automation.setConfig}
            messageLog={automation.messageLog}
          />
        </DialogContent>
      </Dialog>
    </div>
  )
}

interface RoomTypeRowProps {
  title: string
  subtitle: string
  rooms: BoardRoomCard[]
  dateColumns: Date[]
  isCollapsed: boolean
  onToggleCollapse: () => void
  onRoomClick: (room: BoardRoomCard) => void
  onReservationClick: (room: BoardRoomCard) => void
  draggingRoom: string | null
  draggingReservation: string | null
  dropTarget: string | null
  resizingReservation: {
    roomId: string
    direction: 'start' | 'end'
    initialDate: Date
    currentDate: Date
  } | null
  onDragStart: (room: BoardRoomCard) => (e: React.DragEvent) => void
  onDragOver: (room: BoardRoomCard) => (e: React.DragEvent) => void
  onDrop: (room: BoardRoomCard) => (e: React.DragEvent) => void
  onDragLeave: () => void
  onDragEnd: () => void
  onStayResize: (roomId: string, newCheckIn?: Date, newCheckOut?: Date) => void
  onResizeStart: (state: { roomId: string; direction: 'start' | 'end'; initialDate: Date; currentDate: Date }) => void
  onResizeEnd: () => void
  onEmptyBlockClick: (room: BoardRoomCard, date: Date) => void
  contextMenuHandlers: {
    onCheckOut: (room: BoardRoomCard) => void
    onMarkClean: (room: BoardRoomCard) => void
    onMarkDirty: (room: BoardRoomCard) => void
    onBlock: (room: BoardRoomCard) => void
    onUnblock: (room: BoardRoomCard) => void
    onExtend: (room: BoardRoomCard, nights: number) => void
    onShorten: (room: BoardRoomCard, nights: number) => void
    onQuickCheckIn: (room: BoardRoomCard) => void
    onToggleVIP: (room: BoardRoomCard) => void
    onPostCharge: (room: BoardRoomCard) => void
    onViewFolio: (room: BoardRoomCard) => void
    onAddNote: (room: BoardRoomCard) => void
    onPrintRegistration: (room: BoardRoomCard) => void
    onTransferRoom: (room: BoardRoomCard) => void
    onMarkOutOfService: (room: BoardRoomCard) => void
    onRequestHousekeeping: (room: BoardRoomCard) => void
    onCopyReservation: (room: BoardRoomCard) => void
    onViewCalendar: (room: BoardRoomCard) => void
  }
}

function RoomTypeRow({
  title,
  subtitle,
  rooms,
  dateColumns,
  isCollapsed,
  onToggleCollapse,
  onRoomClick,
  onReservationClick,
  draggingRoom,
  draggingReservation,
  dropTarget,
  resizingReservation,
  onDragStart,
  onDragOver,
  onDrop,
  onDragLeave,
  onDragEnd,
  onStayResize,
  onResizeStart,
  onResizeEnd,
  onEmptyBlockClick,
  contextMenuHandlers,
}: RoomTypeRowProps) {
  const occupiedCount = rooms.filter(r => r.status.includes('OCCUPIED')).length
  const cleanCount = rooms.filter(r => r.cleanStatus === 'CLEAN').length
  const dirtyCount = rooms.filter(r => r.cleanStatus === 'DIRTY').length
  
  return (
    <div className="border-b border-border/30 last:border-b-0">
      <button
        onClick={onToggleCollapse}
        className="w-full flex items-center gap-2 px-3 py-1.5 bg-muted/30 hover:bg-muted/50 transition-colors border-b border-border/20 group"
      >
        {isCollapsed ? (
          <CaretRight className="w-3 h-3 text-muted-foreground group-hover:text-foreground flex-shrink-0 transition-colors" weight="bold" />
        ) : (
          <CaretDown className="w-3 h-3 text-muted-foreground group-hover:text-foreground flex-shrink-0 transition-colors" weight="bold" />
        )}
        <div className="flex items-center gap-2 text-[11px] flex-1 min-w-0">
          <span className="font-medium text-foreground">{title}</span>
          <span className="text-muted-foreground/40">·</span>
          <span className="text-muted-foreground font-normal">{subtitle}</span>
          <div className="flex items-center gap-1.5 ml-auto">
            <span className="text-[10px] text-muted-foreground">{rooms.length} rooms</span>
            <span className="text-muted-foreground/30">·</span>
            <span className="text-[10px] text-blue-600 font-medium">{occupiedCount} occ</span>
            {dirtyCount > 0 && (
              <>
                <span className="text-muted-foreground/30">·</span>
                <span className="text-[10px] text-orange-600 font-medium">{dirtyCount} dirty</span>
              </>
            )}
          </div>
        </div>
      </button>

      {!isCollapsed && (
        <div className="divide-y divide-border/20">
          {rooms.map((room) => (
            <CalendarRoomRow
              key={room.roomId}
              room={room}
              dateColumns={dateColumns}
              onClick={() => onRoomClick(room)}
              onReservationClick={() => onReservationClick(room)}
              isDragging={draggingRoom === room.roomId}
              isDropTarget={dropTarget === room.roomId}
              draggingReservation={draggingReservation}
              resizingReservation={resizingReservation}
              onDragStart={onDragStart(room)}
              onDragOver={onDragOver(room)}
              onDrop={onDrop(room)}
              onDragLeave={onDragLeave}
              onDragEnd={onDragEnd}
              onStayResize={onStayResize}
              onResizeStart={onResizeStart}
              onResizeEnd={onResizeEnd}
              onEmptyBlockClick={(date) => onEmptyBlockClick(room, date)}
              contextMenuHandlers={contextMenuHandlers}
            />
          ))}
        </div>
      )}
    </div>
  )
}

interface CalendarRoomRowProps {
  room: BoardRoomCard
  dateColumns: Date[]
  onClick: () => void
  onReservationClick: () => void
  isDragging: boolean
  isDropTarget: boolean
  draggingReservation: string | null
  resizingReservation: {
    roomId: string
    direction: 'start' | 'end'
    initialDate: Date
    currentDate: Date
  } | null
  onDragStart: (e: React.DragEvent) => void
  onDragOver: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent) => void
  onDragLeave: () => void
  onDragEnd: () => void
  onStayResize: (roomId: string, newCheckIn?: Date, newCheckOut?: Date) => void
  onResizeStart: (state: { roomId: string; direction: 'start' | 'end'; initialDate: Date; currentDate: Date }) => void
  onResizeEnd: () => void
  onEmptyBlockClick: (date: Date) => void
  contextMenuHandlers: {
    onCheckOut: (room: BoardRoomCard) => void
    onMarkClean: (room: BoardRoomCard) => void
    onMarkDirty: (room: BoardRoomCard) => void
    onBlock: (room: BoardRoomCard) => void
    onUnblock: (room: BoardRoomCard) => void
    onExtend: (room: BoardRoomCard, nights: number) => void
    onShorten: (room: BoardRoomCard, nights: number) => void
    onQuickCheckIn: (room: BoardRoomCard) => void
    onToggleVIP: (room: BoardRoomCard) => void
    onPostCharge: (room: BoardRoomCard) => void
    onViewFolio: (room: BoardRoomCard) => void
    onAddNote: (room: BoardRoomCard) => void
    onPrintRegistration: (room: BoardRoomCard) => void
    onTransferRoom: (room: BoardRoomCard) => void
    onMarkOutOfService: (room: BoardRoomCard) => void
    onRequestHousekeeping: (room: BoardRoomCard) => void
    onCopyReservation: (room: BoardRoomCard) => void
    onViewCalendar: (room: BoardRoomCard) => void
  }
}

function CalendarRoomRow({
  room,
  dateColumns,
  onClick,
  onReservationClick,
  isDragging,
  isDropTarget,
  draggingReservation,
  resizingReservation,
  onDragStart,
  onDragOver,
  onDrop,
  onDragLeave,
  onDragEnd,
  onStayResize,
  onResizeStart,
  onResizeEnd,
  onEmptyBlockClick,
  contextMenuHandlers,
}: CalendarRoomRowProps) {
  const getStatusColor = (status: BoardRoomCard['status']) => {
    switch (status) {
      case 'OCCUPIED_CLEAN':
        return 'bg-blue-100/80 border-blue-300/60 border-l-[3px] border-l-blue-500'
      case 'OCCUPIED_DIRTY':
        return 'bg-blue-100/60 border-blue-200/60 border-l-[3px] border-l-orange-500'
      case 'VACANT_CLEAN':
        return 'bg-emerald-50/80 border-emerald-200/60 border-l-[3px] border-l-emerald-500'
      case 'VACANT_DIRTY':
        return 'bg-orange-50/80 border-orange-200/60 border-l-[3px] border-l-orange-500'
      default:
        return 'bg-muted/30 border-border/40'
    }
  }

  const getCleanStatusIndicator = (cleanStatus: BoardRoomCard['cleanStatus']) => {
    switch (cleanStatus) {
      case 'CLEAN':
        return 'bg-emerald-500'
      case 'DIRTY':
        return 'bg-orange-500'
      case 'CLEANING':
        return 'bg-sky-500'
      case 'INSPECTED':
        return 'bg-blue-500'
    }
  }

  const isRoomOccupied = room.guestName && room.reservationId
  const isAvailableForAssignment = room.operationalStatus === 'AVAILABLE' && 
    (room.status === 'VACANT_CLEAN' || room.status === 'VACANT_DIRTY')

  const isResizing = resizingReservation?.roomId === room.roomId
  const [hoveredCell, setHoveredCell] = useState<number | null>(null)

  const normalizeDate = (date: Date) => {
    const normalized = new Date(date)
    normalized.setHours(0, 0, 0, 0)
    return normalized
  }

  const handleResizeMouseDown = (direction: 'start' | 'end', date: Date) => (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    
    if (!room.checkIn || !room.checkOut) return
    
    onResizeStart({
      roomId: room.roomId,
      direction,
      initialDate: direction === 'start' ? room.checkIn : room.checkOut,
      currentDate: date
    })
  }

  const handleResizeMouseMove = (date: Date) => (e: React.MouseEvent) => {
    if (!isResizing) return
    
    if (resizingReservation) {
      onResizeStart({
        ...resizingReservation,
        currentDate: date
      })
    }
  }

  const handleResizeMouseUp = () => {
    if (!isResizing || !resizingReservation || !room.checkIn || !room.checkOut) {
      onResizeEnd()
      return
    }

    const { direction, currentDate } = resizingReservation

    if (direction === 'end') {
      const newCheckOut = addDays(currentDate, 1)
      onStayResize(room.roomId, undefined, newCheckOut)
    } else {
      onStayResize(room.roomId, currentDate, undefined)
    }

    onResizeEnd()
  }

  return (
    <RoomContextMenu
      room={room}
      onCheckOut={() => contextMenuHandlers.onCheckOut(room)}
      onMarkClean={() => contextMenuHandlers.onMarkClean(room)}
      onMarkDirty={() => contextMenuHandlers.onMarkDirty(room)}
      onBlock={() => contextMenuHandlers.onBlock(room)}
      onUnblock={() => contextMenuHandlers.onUnblock(room)}
      onExtend={(nights) => contextMenuHandlers.onExtend(room, nights)}
      onShorten={(nights) => contextMenuHandlers.onShorten(room, nights)}
      onQuickCheckIn={() => contextMenuHandlers.onQuickCheckIn(room)}
      onViewDetails={onClick}
      onEditReservation={onReservationClick}
      onToggleVIP={() => contextMenuHandlers.onToggleVIP(room)}
      onPostCharge={() => contextMenuHandlers.onPostCharge(room)}
      onViewFolio={() => contextMenuHandlers.onViewFolio(room)}
      onAddNote={() => contextMenuHandlers.onAddNote(room)}
      onPrintRegistration={() => contextMenuHandlers.onPrintRegistration(room)}
      onTransferRoom={() => contextMenuHandlers.onTransferRoom(room)}
      onMarkOutOfService={() => contextMenuHandlers.onMarkOutOfService(room)}
      onRequestHousekeeping={() => contextMenuHandlers.onRequestHousekeeping(room)}
      onCopyReservation={() => contextMenuHandlers.onCopyReservation(room)}
      onViewCalendar={() => contextMenuHandlers.onViewCalendar(room)}
    >
      <div 
        className="flex hover:bg-muted/20 transition-colors group"
        onMouseUp={handleResizeMouseUp}
        onMouseLeave={handleResizeMouseUp}
      >
      <div 
        className="w-28 flex-shrink-0 border-r border-border/30 py-2 px-3 flex items-center gap-2 cursor-pointer transition-colors"
        onClick={onClick}
      >
        <div className={cn("w-1.5 h-1.5 rounded-full flex-shrink-0", getCleanStatusIndicator(room.cleanStatus))} />
        <div className="text-xs font-semibold tracking-tight text-foreground">{room.number}</div>
        <div className="ml-auto flex items-center gap-1">
          {room.operationalStatus === 'OUT_OF_SERVICE' && (
            <span className="text-[8px] font-medium text-rose-600 bg-rose-50 px-1 py-0.5 rounded">OOS</span>
          )}
          {room.operationalStatus === 'BLOCKED' && (
            <span className="text-[8px] font-medium text-gray-600 bg-gray-100 px-1 py-0.5 rounded">BLK</span>
          )}
          {room.isVIP && (
            <span className="text-[8px] font-medium text-amber-700 bg-amber-50 px-1 py-0.5 rounded">VIP</span>
          )}
        </div>
      </div>
      
      <div className="flex-1 flex overflow-x-auto">
        {dateColumns.map((date, i) => {
          const normalizedDate = normalizeDate(date)
          const normalizedCheckIn = room.checkIn ? normalizeDate(room.checkIn) : null
          const normalizedCheckOut = room.checkOut ? normalizeDate(room.checkOut) : null
          
          const isInStay = normalizedCheckIn && normalizedCheckOut &&
            normalizedDate >= normalizedCheckIn && normalizedDate < normalizedCheckOut

          const isCheckIn = room.checkIn && isSameDay(date, room.checkIn)
          const isCheckOut = room.checkOut && isSameDay(date, room.checkOut)
          const isToday = isSameDay(date, new Date())
          const isWeekendDay = isWeekend(date)

          const isFirstDay = isInStay && isCheckIn
          const isLastDay = isInStay && isCheckOut

          return (
            <div 
              key={i}
              className={cn(
                "flex-1 min-w-[80px] border-r border-border/15 py-1.5 px-1.5 relative transition-colors",
                isToday && "bg-blue-50/50 border-x border-x-blue-100",
                isWeekendDay && !isToday && "bg-muted/20",
                draggingReservation && isAvailableForAssignment && "bg-blue-50/40",
                isResizing && "cursor-col-resize"
              )}
              draggable={!!(isRoomOccupied && isInStay && !isResizing)}
              onDragStart={isInStay && !isResizing ? onDragStart : undefined}
              onDragOver={onDragOver}
              onDrop={onDrop}
              onDragLeave={onDragLeave}
              onDragEnd={onDragEnd}
              onMouseMove={handleResizeMouseMove(date)}
              onMouseEnter={() => setHoveredCell(i)}
              onMouseLeave={() => setHoveredCell(null)}
            >
              {isInStay && (
                <div 
                  className={cn(
                    "h-full rounded-md border transition-all relative overflow-hidden group/reservation",
                    getStatusColor(room.status),
                    isDragging && "opacity-30 scale-95",
                    isDropTarget && !isDragging && "ring-2 ring-blue-500 ring-offset-1 scale-[1.02]",
                    isFirstDay && "rounded-l-lg",
                    isLastDay && "rounded-r-lg",
                    isRoomOccupied && !isResizing && "cursor-grab active:cursor-grabbing hover:shadow-sm",
                    isResizing && "ring-2 ring-blue-500 shadow-lg z-10"
                  )}
                  onClick={(e) => {
                    if (isResizing) return
                    e.stopPropagation()
                    onReservationClick()
                  }}
                >
                  <div className="px-2 py-1 h-full flex flex-col justify-between">
                    {isCheckIn && (
                      <div className="space-y-0.5">
                        <div className="text-[11px] font-medium truncate text-foreground leading-snug">
                          {room.guestName}
                        </div>
                        {room.guestCount && (
                          <div className="text-[9px] text-foreground/50 flex items-center gap-1">
                            <Users className="w-2 h-2" />
                            <span>{room.guestCount}</span>
                          </div>
                        )}
                      </div>
                    )}
                    
                    <div className="flex items-center justify-between mt-auto">
                      {room.isArrivalToday && isCheckIn && (
                        <span className="text-[8px] font-medium text-amber-700 bg-amber-100 px-1 py-0.5 rounded">
                          IN
                        </span>
                      )}
                      {room.isDepartureToday && isCheckOut && (
                        <span className="text-[8px] font-medium text-rose-700 bg-rose-100 px-1 py-0.5 rounded ml-auto">
                          OUT
                        </span>
                      )}
                      {room.depositStatus === 'PENDING' && isCheckIn && (
                        <div className="w-1.5 h-1.5 rounded-full bg-orange-500 ml-auto" />
                      )}
                    </div>
                  </div>

                  {isCheckIn && isRoomOccupied && (
                    <div
                      className={cn(
                        "absolute left-0 top-0 bottom-0 w-2.5 cursor-col-resize hover:bg-blue-500/30 transition-colors opacity-0 group-hover/reservation:opacity-100",
                        isResizing && resizingReservation?.direction === 'start' && "opacity-100 bg-blue-500/40"
                      )}
                      onMouseDown={handleResizeMouseDown('start', date)}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="absolute left-0.5 top-1/2 -translate-y-1/2 w-1 h-8 bg-blue-500/70 rounded-full" />
                    </div>
                  )}

                  {isLastDay && isRoomOccupied && (
                    <div
                      className={cn(
                        "absolute right-0 top-0 bottom-0 w-2.5 cursor-col-resize hover:bg-blue-500/30 transition-colors opacity-0 group-hover/reservation:opacity-100",
                        isResizing && resizingReservation?.direction === 'end' && "opacity-100 bg-blue-500/40"
                      )}
                      onMouseDown={handleResizeMouseDown('end', date)}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="absolute right-0.5 top-1/2 -translate-y-1/2 w-1 h-8 bg-blue-500/70 rounded-full" />
                    </div>
                  )}
                  
                  {isDropTarget && !isDragging && (
                    <div className="absolute inset-0 bg-blue-500/20 backdrop-blur-[1px] flex items-center justify-center rounded-md">
                      <span className="text-[10px] font-medium text-blue-700 bg-white/80 px-2 py-0.5 rounded shadow-sm">
                        Drop here
                      </span>
                    </div>
                  )}

                  {isResizing && resizingReservation && (
                    <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-foreground text-background text-[10px] font-medium px-2 py-1 rounded-md shadow-lg whitespace-nowrap z-20">
                      {resizingReservation.direction === 'end' 
                        ? `Out: ${format(addDays(resizingReservation.currentDate, 1), 'MMM d')}`
                        : `In: ${format(resizingReservation.currentDate, 'MMM d')}`
                      }
                    </div>
                  )}
                </div>
              )}
              
              {!isInStay && draggingReservation && isAvailableForAssignment && (
                <div className="h-full rounded-md border border-dashed border-blue-300 bg-blue-50/50 flex items-center justify-center transition-colors">
                  <span className="text-[9px] text-blue-500 font-medium">Assign</span>
                </div>
              )}

              {!isInStay && !draggingReservation && !isResizing && isAvailableForAssignment && (
                <div 
                  className="h-full rounded-md hover:bg-muted/30 flex items-center justify-center transition-colors cursor-pointer group/empty"
                  onClick={(e) => {
                    e.stopPropagation()
                    onEmptyBlockClick(date)
                  }}
                >
                  <Plus className="w-3 h-3 text-transparent group-hover/empty:text-muted-foreground/40 transition-colors" weight="bold" />
                </div>
              )}

              {!isInStay && isResizing && resizingReservation && hoveredCell === i && (
                <div className={cn(
                  "h-full rounded-md border border-dashed transition-colors",
                  resizingReservation.direction === 'end' && date >= (room.checkIn || new Date()) && "border-blue-400 bg-blue-50/50",
                  resizingReservation.direction === 'start' && date < (room.checkOut || new Date()) && "border-blue-400 bg-blue-50/50"
                )} />
              )}
            </div>
          )
        })}
      </div>
    </div>
    </RoomContextMenu>
  )
}
