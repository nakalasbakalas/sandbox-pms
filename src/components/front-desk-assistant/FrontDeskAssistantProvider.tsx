import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useKV } from '@github/spark/hooks'
import { toast } from 'sonner'
import { Sparkle, ArrowClockwise, Warning, CheckCircle, Lock, PaperPlaneTilt, X, Database, Clock, ListMagnifyingGlass } from '@phosphor-icons/react'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { useAuth } from '@/hooks/use-auth'
import { useNavigation } from '@/hooks/use-navigation'
import { useRoomSync } from '@/hooks/use-room-sync'
import type { BoardRoomCard } from '@/types/board'
import type { AuditRecord } from '@/lib/hotel/operations'
import { getBangkokDateKey, nightsBetween } from '@/lib/hotel/business-rules'
import { mapServerBoardRooms, pmsApi, SERVER_API_ENABLED } from '@/lib/pms-api-client'
import { createAIAssistedAuditRecord } from '@/lib/assistant/audit'
import { parseFrontDeskIntent } from '@/lib/assistant/intents'
import { FRONT_DESK_ASSISTANT_PROMPTS, FRONT_DESK_ASSISTANT_SHORTCUTS } from '@/lib/assistant/prompts'
import {
  buildSnapshotFromData,
  normalizeServerReservation,
  runAssistantTool,
} from '@/lib/assistant/tools'
import type { AssistantAction, AssistantAnswer, AssistantMessage, AssistantReservation, AssistantSnapshot } from '@/lib/assistant/types'

interface OpenAssistantOptions {
  prompt?: string
  roomNumber?: string
  reservationId?: string
}

interface FrontDeskAssistantContextValue {
  openAssistant: (options?: OpenAssistantOptions) => void
  askAssistant: (prompt: string, options?: OpenAssistantOptions) => void
}

const FrontDeskAssistantContext = createContext<FrontDeskAssistantContextValue | undefined>(undefined)

interface ServerBoard {
  rooms?: any[]
  reservations?: any[]
}

interface UnassignedReservation {
  id: string
  guestName: string
  checkIn: Date | string
  checkOut: Date | string
  roomType: 'TWIN' | 'DOUBLE'
  guestCount: number
  nights: number
  source: string
  ratePerNight?: number
  totalAmount?: number
  balanceDue?: number
  paidAmount?: number
  specialRequests?: string
  notes?: string
}

function localReservationToAssistant(reservation: any): AssistantReservation {
  return {
    id: reservation.id,
    confirmationCode: reservation.confirmationNumber || reservation.confirmationCode,
    guestName: reservation.guestName || `${reservation.guest?.firstName || ''} ${reservation.guest?.lastName || ''}`.trim() || 'Guest name required',
    roomType: reservation.roomType || (/twin/i.test(reservation.roomTypeName) ? 'TWIN' : 'DOUBLE'),
    status: reservation.status || 'CONFIRMED',
    checkIn: reservation.checkIn,
    checkOut: reservation.checkOut,
    adults: reservation.adults || Math.max(1, reservation.guestCount || 1),
    children: reservation.children || 0,
    assignedRoomId: reservation.roomId || reservation.assignedRoomId,
    roomNumber: reservation.roomNumber,
    balanceDue: Math.max(0, reservation.balanceDue ?? reservation.totalAmount ?? 0),
    paidAmount: reservation.depositPaid || 0,
    totalAmount: reservation.totalAmount,
    depositPaid: reservation.depositStatus === 'PAID',
    documentVerified: Boolean(reservation.guestNationality || reservation.guest?.nationality),
    guestNationality: reservation.guestNationality || reservation.guest?.nationality,
    specialRequests: reservation.specialRequests,
    notes: reservation.notes,
    source: reservation.source || 'PMS',
  }
}

function unassignedToAssistant(reservation: UnassignedReservation): AssistantReservation {
  return {
    id: reservation.id,
    confirmationCode: reservation.id,
    guestName: reservation.guestName,
    roomType: reservation.roomType,
    status: 'CONFIRMED',
    checkIn: reservation.checkIn,
    checkOut: reservation.checkOut,
    adults: Math.max(1, reservation.guestCount || 1),
    children: 0,
    balanceDue: Math.max(0, reservation.balanceDue ?? reservation.totalAmount ?? 0),
    paidAmount: reservation.paidAmount || 0,
    totalAmount: reservation.totalAmount || 0,
    depositPaid: (reservation.paidAmount || 0) > 0,
    documentVerified: false,
    specialRequests: reservation.specialRequests,
    notes: reservation.notes,
    source: reservation.source || 'Direct',
  }
}

function buildActionMessage(action: AssistantAction) {
  if (action.risk === 'high') return 'This changes stay, room, or payment state. Confirm only after checking the live record.'
  if (action.requiresConfirmation) return 'Please confirm before the assistant changes PMS data.'
  return action.description || 'This opens the existing PMS workflow.'
}

type PendingAssistantRequest = OpenAssistantOptions & {
  requestId: number
}

interface FrontDeskAssistantRuntimeProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  request: PendingAssistantRequest | null
  onRequestHandled: (requestId: number) => void
}

export function FrontDeskAssistantProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [request, setRequest] = useState<PendingAssistantRequest | null>(null)

  const queueAssistantRequest = useCallback((options: OpenAssistantOptions = {}) => {
    setRequest({ ...options, requestId: Date.now() })
    setOpen(true)
  }, [])

  const openAssistant = useCallback((options?: OpenAssistantOptions) => {
    queueAssistantRequest(options || {})
  }, [queueAssistantRequest])

  const askAssistant = useCallback((prompt: string, options?: OpenAssistantOptions) => {
    queueAssistantRequest({ ...options, prompt })
  }, [queueAssistantRequest])

  const handleRequestHandled = useCallback((requestId: number) => {
    setRequest((current) => current?.requestId === requestId ? null : current)
  }, [])

  return (
    <FrontDeskAssistantContext.Provider value={{ openAssistant, askAssistant }}>
      {children}
      {open && (
        <FrontDeskAssistantRuntime
          open={open}
          onOpenChange={setOpen}
          request={request}
          onRequestHandled={handleRequestHandled}
        />
      )}
    </FrontDeskAssistantContext.Provider>
  )
}

function FrontDeskAssistantRuntime({ open, onOpenChange, request, onRequestHandled }: FrontDeskAssistantRuntimeProps) {
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<AssistantMessage[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendingAction, setPendingAction] = useState<AssistantAction | null>(null)
  const [context, setContext] = useState<OpenAssistantOptions>({})
  const [serverBoard, setServerBoard] = useState<ServerBoard | null>(null)
  const authToken = null
  const [unassignedReservations] = useKV<UnassignedReservation[]>('unassigned-reservations', [])
  const [localReservations] = useKV<any[]>('reservations-data', [])
  const [auditRecords, setAuditRecords] = useKV<AuditRecord[]>('audit-records', [])
  const { user } = useAuth()
  const { currentRoute, navigate } = useNavigation()
  const { rooms, setRooms, updateRoomStatus } = useRoomSync({ serverSync: false })

  const refreshServerBoard = useCallback(async () => {
    if (!SERVER_API_ENABLED) return
    const payload = await pmsApi<{ ok: true; data: ServerBoard }>('/api/front-desk/board', authToken)
    setServerBoard(payload.data)
    setRooms(mapServerBoardRooms(payload.data))
  }, [authToken, setRooms])

  useEffect(() => {
    if (!open) return
    void refreshServerBoard().catch(() => undefined)
  }, [open, refreshServerBoard])

  const snapshot = useMemo<AssistantSnapshot>(() => {
    const serverReservations = (serverBoard?.reservations || []).map(normalizeServerReservation)
    const fallbackReservations = SERVER_API_ENABLED && serverReservations.length
      ? []
      : [
          ...(localReservations || []).map(localReservationToAssistant),
          ...(unassignedReservations || []).map(unassignedToAssistant),
        ]
    return buildSnapshotFromData({
      hotelDateKey: getBangkokDateKey(new Date()),
      rooms,
      reservations: [...serverReservations, ...fallbackReservations],
      currentRoute,
      currentRoomNumber: context.roomNumber,
      currentReservationId: context.reservationId,
      user: user ? { id: user.id, role: user.role, displayName: user.displayName } : null,
    })
  }, [context.reservationId, context.roomNumber, currentRoute, localReservations, rooms, serverBoard, unassignedReservations, user])

  const addAssistantAnswer = useCallback((prompt: string, answer: AssistantAnswer) => {
    const now = new Date().toISOString()
    setMessages((current) => [
      ...current,
      { id: `msg-user-${Date.now()}`, role: 'user', content: prompt, createdAt: now },
      { id: `msg-ai-${Date.now()}`, role: 'assistant', content: answer.directAnswer, answer, createdAt: now },
    ])
  }, [])

  const submitAssistantPrompt = useCallback((prompt: string, options?: OpenAssistantOptions) => {
    const trimmed = prompt.trim()
    if (!trimmed) return
    onOpenChange(true)
    setError(null)
    setLoading(true)
    if (options) setContext((current) => ({ ...current, ...options }))

    window.setTimeout(() => {
      try {
        const activeContext = { ...context, ...options }
        const parsed = parseFrontDeskIntent(trimmed, {
          currentRoomNumber: activeContext.roomNumber,
          currentReservationId: activeContext.reservationId,
        })
        const answer = runAssistantTool(
          {
            ...snapshot,
            currentRoomNumber: activeContext.roomNumber,
            currentReservationId: activeContext.reservationId,
          },
          trimmed,
          parsed,
        )
        addAssistantAnswer(trimmed, answer)
        setInput('')
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Front Desk AI could not answer that request.')
      } finally {
        setLoading(false)
      }
    }, 120)
  }, [addAssistantAnswer, context, onOpenChange, snapshot])

  useEffect(() => {
    if (!request) return
    setContext((current) => ({ ...current, ...request }))
    if (request.prompt) submitAssistantPrompt(request.prompt, request)
    onRequestHandled(request.requestId)
  }, [onRequestHandled, request, submitAssistantPrompt])

  const addLocalAudit = useCallback((record: AuditRecord) => {
    setAuditRecords((current) => [record, ...(current || auditRecords || [])].slice(0, 250))
  }, [auditRecords, setAuditRecords])

  const executeAction = useCallback(async (actionToRun: AssistantAction) => {
    if (actionToRun.disabled) return
    const reservationId = String(actionToRun.payload?.reservationId || '')
    const roomId = String(actionToRun.payload?.roomId || '')

    const dispatchFrontDeskAction = () => {
      const detail = {
        action: actionToRun.type,
        reservationId,
        roomId,
        roomType: actionToRun.payload?.roomType,
      }
      window.sessionStorage.setItem('front-desk-ai-pending-action', JSON.stringify(detail))
      window.dispatchEvent(new CustomEvent('front-desk-ai-action', { detail }))
    }

    try {
      if (actionToRun.type === 'OPEN_ROOM') {
        navigate('board')
        toast.info(`Opened room board${actionToRun.payload?.roomNumber ? ` for Room ${actionToRun.payload.roomNumber}` : ''}.`)
        return
      }
      if (actionToRun.type === 'OPEN_RESERVATION') {
        navigate('reservations')
        toast.info('Opened reservations.')
        return
      }
      if (actionToRun.type === 'OPEN_PAYMENT') {
        navigate('cashier')
        toast.info('Opened cashier/payment tools.')
        return
      }
      if (actionToRun.type === 'OPEN_CHECK_IN' || actionToRun.type === 'OPEN_CHECK_OUT' || actionToRun.type === 'CREATE_WALK_IN_DRAFT') {
        navigate('front-desk')
        window.setTimeout(dispatchFrontDeskAction, 250)
        toast.info('Opened front desk workflow.')
        return
      }

      if (SERVER_API_ENABLED) {
        if (actionToRun.type === 'ASSIGN_BEST_ROOM' || actionToRun.type === 'ASSIGN_SPECIFIC_ROOM') {
          await pmsApi(`/api/reservations/${reservationId}/assign-room`, authToken, {
            method: 'POST',
            body: JSON.stringify({ roomId }),
          })
        } else if (actionToRun.type === 'COMPLETE_EXPRESS_CHECK_IN') {
          await pmsApi(`/api/reservations/${reservationId}/check-in`, authToken, {
            method: 'POST',
            body: JSON.stringify({ additionalNotes: 'AI suggested express check-in; user confirmed.' }),
          })
        } else if (actionToRun.type === 'COMPLETE_EXPRESS_CHECK_OUT') {
          await pmsApi(`/api/reservations/${reservationId}/check-out`, authToken, {
            method: 'POST',
            body: JSON.stringify({ additionalNotes: 'AI suggested express checkout; user confirmed.' }),
          })
        } else if (['MARK_ROOM_DIRTY', 'MARK_ROOM_CLEANING', 'MARK_ROOM_CLEAN', 'MARK_ROOM_READY'].includes(actionToRun.type)) {
          const statusByAction: Record<string, string> = {
            MARK_ROOM_DIRTY: 'DIRTY',
            MARK_ROOM_CLEANING: 'CLEANING',
            MARK_ROOM_CLEAN: 'CLEAN',
            MARK_ROOM_READY: 'INSPECTED',
          }
          await pmsApi(`/api/housekeeping/rooms/${roomId}/status`, authToken, {
            method: 'POST',
            body: JSON.stringify({ status: statusByAction[actionToRun.type], notes: 'AI suggested housekeeping update; user confirmed.' }),
          })
        }
        await refreshServerBoard()
        toast.success(`${actionToRun.label} complete.`)
        return
      }

      const reservation = snapshot.reservations.find((candidate) => candidate.id === reservationId)
      const room = snapshot.rooms.find((candidate) => candidate.roomId === roomId)
      if (actionToRun.type === 'ASSIGN_BEST_ROOM' || actionToRun.type === 'ASSIGN_SPECIFIC_ROOM') {
        if (!reservation || !room) throw new Error('Reservation or room was not found.')
        setRooms((current) => current.map((candidate) => candidate.roomId === room.roomId
          ? {
              ...candidate,
              reservationId: reservation.id,
              currentReservationId: reservation.id,
              guestName: reservation.guestName,
              checkIn: new Date(reservation.checkIn),
              checkOut: new Date(reservation.checkOut),
              guestCount: reservation.adults + reservation.children,
              balanceDue: reservation.balanceDue,
              depositStatus: reservation.balanceDue > 0 ? 'PENDING' : 'PAID',
              lastUpdatedAt: new Date().toISOString(),
              lastUpdatedBy: user?.displayName || 'Front desk',
            }
          : candidate))
        addLocalAudit(createAIAssistedAuditRecord('reservation', reservation.id, 'ASSIGN_ROOM', `${reservation.guestName} assigned to Room ${room.number}.`, user?.displayName || 'Front desk AI', { roomId: room.roomId, aiSuggested: true, userConfirmed: true }))
      } else if (actionToRun.type === 'COMPLETE_EXPRESS_CHECK_IN') {
        if (!reservation?.assignedRoomId) throw new Error('Reservation has no assigned room.')
        setRooms((current) => current.map((candidate) => candidate.roomId === reservation.assignedRoomId
          ? {
              ...candidate,
              status: candidate.cleanStatus === 'DIRTY' ? 'OCCUPIED_DIRTY' : 'OCCUPIED_CLEAN',
              reservationId: reservation.id,
              currentReservationId: reservation.id,
              guestName: reservation.guestName,
              lastUpdatedAt: new Date().toISOString(),
              lastUpdatedBy: user?.displayName || 'Front desk',
            }
          : candidate))
        addLocalAudit(createAIAssistedAuditRecord('reservation', reservation.id, 'CHECKED_IN', `${reservation.guestName} checked in.`, user?.displayName || 'Front desk AI', { aiSuggested: true, userConfirmed: true }))
      } else if (actionToRun.type === 'COMPLETE_EXPRESS_CHECK_OUT') {
        if (!reservation?.assignedRoomId) throw new Error('Reservation has no assigned room.')
        setRooms((current) => current.map((candidate) => candidate.roomId === reservation.assignedRoomId
          ? {
              ...candidate,
              status: 'VACANT_DIRTY',
              cleanStatus: 'DIRTY',
              housekeepingStatus: 'DIRTY',
              reservationId: undefined,
              currentReservationId: undefined,
              guestName: undefined,
              balanceDue: undefined,
              depositStatus: 'NONE',
              lastUpdatedAt: new Date().toISOString(),
              lastUpdatedBy: user?.displayName || 'Front desk',
            }
          : candidate))
        addLocalAudit(createAIAssistedAuditRecord('reservation', reservation.id, 'CHECKED_OUT', `${reservation.guestName} checked out; room sent to housekeeping.`, user?.displayName || 'Front desk AI', { aiSuggested: true, userConfirmed: true }))
      } else if (['MARK_ROOM_DIRTY', 'MARK_ROOM_CLEANING', 'MARK_ROOM_CLEAN', 'MARK_ROOM_READY'].includes(actionToRun.type)) {
        const statusByAction: Record<string, 'DIRTY' | 'CLEANING' | 'CLEAN' | 'INSPECTED'> = {
          MARK_ROOM_DIRTY: 'DIRTY',
          MARK_ROOM_CLEANING: 'CLEANING',
          MARK_ROOM_CLEAN: 'CLEAN',
          MARK_ROOM_READY: 'INSPECTED',
        }
        updateRoomStatus({ roomId, cleanStatus: statusByAction[actionToRun.type], cleanedBy: user?.displayName || 'Front desk AI' })
        addLocalAudit(createAIAssistedAuditRecord('housekeeping', roomId, actionToRun.type, `${actionToRun.label}.`, user?.displayName || 'Front desk AI', { aiSuggested: true, userConfirmed: true }))
      }
      toast.success(`${actionToRun.label} complete.`)
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : 'Assistant action failed.')
      throw caught
    }
  }, [addLocalAudit, authToken, navigate, refreshServerBoard, setRooms, snapshot.reservations, snapshot.rooms, updateRoomStatus, user?.displayName])

  const resetConversation = () => {
    setMessages([])
    setError(null)
    setPendingAction(null)
  }

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="w-full gap-0 p-0 sm:max-w-[460px]">
          <SheetHeader className="border-b px-4 py-3">
            <SheetTitle className="flex items-center gap-2 text-base">
              <Sparkle size={17} weight="duotone" className="text-blue-600" />
              Front Desk AI
              <Badge variant="outline" className="ml-auto text-[10px]">
                Live PMS
              </Badge>
            </SheetTitle>
            <SheetDescription className="sr-only">
              Ask operational questions using current PMS room, reservation, folio, and housekeeping data.
            </SheetDescription>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Database size={13} />
              {snapshot.rooms.length} rooms
              <span className="text-muted-foreground/40">/</span>
              {snapshot.reservations.length} records
              <span className="text-muted-foreground/40">/</span>
              {snapshot.hotelDateKey}
            </div>
          </SheetHeader>

          <div className="border-b px-4 py-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase text-muted-foreground">Suggested prompts</span>
              <Button variant="ghost" size="sm" onClick={resetConversation} className="h-6 gap-1 px-2 text-xs">
                <ArrowClockwise size={12} />
                Reset
              </Button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {FRONT_DESK_ASSISTANT_PROMPTS.map((prompt) => (
                <Button
                  key={prompt}
                  variant="outline"
                  size="sm"
                  className="h-7 rounded-md px-2 text-[11px]"
                  onClick={() => submitAssistantPrompt(prompt)}
                >
                  {prompt}
                </Button>
              ))}
            </div>
          </div>

          <ScrollArea className="flex-1">
            <div className="space-y-3 p-4">
              {messages.length === 0 && !loading && (
                <div className="rounded-lg border bg-slate-50 p-4">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <ListMagnifyingGlass size={17} weight="duotone" className="text-blue-600" />
                    Operational questions only
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Ask about availability, arrivals, departures, balances, room readiness, check-in blockers, checkout blockers, or today&apos;s risks.
                  </p>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    {FRONT_DESK_ASSISTANT_SHORTCUTS.map((prompt) => (
                      <Button key={prompt} variant="secondary" size="sm" className="justify-start text-xs" onClick={() => submitAssistantPrompt(prompt)}>
                        {prompt}
                      </Button>
                    ))}
                  </div>
                </div>
              )}

              {messages.map((message) => (
                <div key={message.id} className={message.role === 'user' ? 'ml-8 rounded-lg bg-blue-600 px-3 py-2 text-sm text-white' : 'mr-3'}>
                  {message.role === 'user' ? message.content : <AnswerCard answer={message.answer} onAction={(actionToRun) => actionToRun.requiresConfirmation ? setPendingAction(actionToRun) : void executeAction(actionToRun)} />}
                </div>
              ))}

              {loading && (
                <div className="rounded-lg border bg-white p-3 text-sm text-muted-foreground">
                  Checking live PMS records...
                </div>
              )}

              {error && (
                <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
                  {error}
                </div>
              )}
            </div>
          </ScrollArea>

          <div className="border-t p-3">
            <div className="flex gap-2">
              <Textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault()
                    submitAssistantPrompt(input)
                  }
                }}
                placeholder="Ask about today, a room, reservation, or blocker..."
                className="min-h-10 resize-none text-sm"
              />
              <Button onClick={() => submitAssistantPrompt(input)} disabled={loading || !input.trim()} className="h-10 w-10 p-0" aria-label="Ask Front Desk AI">
                <PaperPlaneTilt size={16} weight="bold" />
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {pendingAction && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/45 p-4">
          <div className="w-full max-w-md rounded-lg border bg-background shadow-lg">
            <div className="flex items-start gap-3 border-b p-4">
              <div className="rounded-md bg-amber-100 p-2 text-amber-700">
                <Warning size={18} weight="fill" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-semibold">Confirm Assistant Action</div>
                <p className="mt-1 text-sm text-muted-foreground">{buildActionMessage(pendingAction)}</p>
              </div>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setPendingAction(null)}>
                <X size={14} />
              </Button>
            </div>
            <div className="p-4">
              <div className="rounded-md border bg-muted/40 p-3 text-sm font-medium">{pendingAction.label}</div>
              {pendingAction.permission && (
                <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                  <Lock size={13} />
                  Requires {pendingAction.permission}
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 border-t p-3">
              <Button variant="outline" onClick={() => setPendingAction(null)}>Cancel</Button>
              <Button
                onClick={() => {
                  const actionToRun = pendingAction
                  setPendingAction(null)
                  void executeAction(actionToRun)
                }}
              >
                Confirm
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function AnswerCard({ answer, onAction }: { answer?: AssistantAnswer; onAction: (action: AssistantAction) => void }) {
  if (!answer) return null
  return (
    <div className="rounded-lg border bg-white shadow-sm">
      <div className="border-b p-3">
        <div className="flex items-start gap-2">
          <CheckCircle size={17} weight="duotone" className="mt-0.5 text-emerald-600" />
          <div>
            <div className="text-sm font-semibold">{answer.title}</div>
            <p className="mt-1 text-sm leading-relaxed text-slate-700">{answer.directAnswer}</p>
          </div>
        </div>
      </div>

      {answer.records.length > 0 && (
        <div className="space-y-1.5 p-3">
          <div className="text-[11px] font-semibold uppercase text-muted-foreground">Records used</div>
          {answer.records.slice(0, 8).map((record) => (
            <div key={`${record.type}-${record.id}-${record.label}`} className="rounded-md border bg-slate-50 px-2 py-1.5">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="h-5 px-1.5 text-[10px]">{record.type}</Badge>
                <span className="truncate text-xs font-semibold">{record.label}</span>
              </div>
              {record.detail && <div className="mt-1 truncate text-[11px] text-muted-foreground">{record.detail}</div>}
            </div>
          ))}
        </div>
      )}

      {answer.warnings.length > 0 && (
        <>
          <Separator />
          <div className="space-y-1.5 p-3">
            <div className="text-[11px] font-semibold uppercase text-amber-700">Blockers or warnings</div>
            {answer.warnings.slice(0, 8).map((warning) => (
              <div key={warning} className="flex gap-2 text-xs text-amber-900">
                <Warning size={13} weight="fill" className="mt-0.5 shrink-0" />
                <span>{warning}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {answer.nextAction && (
        <>
          <Separator />
          <div className="flex gap-2 p-3 text-xs">
            <Clock size={14} className="mt-0.5 shrink-0 text-blue-600" />
            <div>
              <div className="font-semibold">Next best action</div>
              <div className="mt-0.5 text-muted-foreground">{answer.nextAction}</div>
            </div>
          </div>
        </>
      )}

      {answer.actions.length > 0 && (
        <div className="flex flex-wrap gap-2 border-t p-3">
          {answer.actions.map((actionItem) => (
            <Button
              key={actionItem.id}
              size="sm"
              variant={actionItem.risk === 'high' ? 'default' : 'outline'}
              disabled={actionItem.disabled}
              title={actionItem.disabledReason}
              onClick={() => onAction(actionItem)}
              className="h-8 text-xs"
            >
              {actionItem.label}
            </Button>
          ))}
        </div>
      )}
    </div>
  )
}

export function useFrontDeskAssistant() {
  const context = useContext(FrontDeskAssistantContext)
  if (!context) {
    throw new Error('useFrontDeskAssistant must be used within FrontDeskAssistantProvider')
  }
  return context
}
