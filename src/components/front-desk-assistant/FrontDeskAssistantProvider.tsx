import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useKV } from '@github/spark/hooks'
import { toast } from 'sonner'
import { Sparkle, ArrowClockwise, Warning, CheckCircle, PaperPlaneTilt, Database, Clock, ListMagnifyingGlass } from '@phosphor-icons/react'
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
import { getBangkokDateKey, nightsBetween } from '@/lib/hotel/business-rules'
import { mapServerBoardRooms, pmsApi, SERVER_API_ENABLED } from '@/lib/pms-api-client'
import { navigateToAuthoritativeWorkflow } from '@/lib/authoritative-workflow-navigation'
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

const HOUSEKEEPING_ACTIONS = new Set<AssistantAction['type']>([
  'MARK_ROOM_DIRTY',
  'MARK_ROOM_CLEANING',
  'MARK_ROOM_CLEAN',
  'MARK_ROOM_READY',
  'FLAG_PRIORITY_TURNOVER',
])

const ACTION_WORKFLOW_LABELS: Partial<Record<AssistantAction['type'], string>> = {
  ASSIGN_BEST_ROOM: 'Open assignment workflow',
  ASSIGN_SPECIFIC_ROOM: 'Open assignment workflow',
  COMPLETE_EXPRESS_CHECK_IN: 'Open check-in workflow',
  COMPLETE_EXPRESS_CHECK_OUT: 'Open check-out workflow',
  ADD_PAYMENT: 'Open cashier workflow',
  ADD_CHARGE: 'Open cashier workflow',
  ADD_NOTE: 'Open reservation workflow',
  MARK_NO_SHOW: 'Open reservation workflow',
  MARK_ROOM_DIRTY: 'Open Housekeeping',
  MARK_ROOM_CLEANING: 'Open Housekeeping',
  MARK_ROOM_CLEAN: 'Open Housekeeping',
  MARK_ROOM_READY: 'Open Housekeeping',
  FLAG_PRIORITY_TURNOVER: 'Open Housekeeping',
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
  const [context, setContext] = useState<OpenAssistantOptions>({})
  const [serverBoard, setServerBoard] = useState<ServerBoard | null>(null)
  const [serverBoardState, setServerBoardState] = useState<'loading' | 'ready' | 'error'>(SERVER_API_ENABLED ? 'loading' : 'ready')
  const [serverBoardError, setServerBoardError] = useState<string | null>(null)
  const authToken = null
  const [unassignedReservations] = useKV<UnassignedReservation[]>('unassigned-reservations', [])
  const [localReservations] = useKV<any[]>('reservations-data', [])
  const { user, hasPermission } = useAuth()
  const { currentRoute, navigate } = useNavigation()
  const { rooms, setRooms } = useRoomSync({ serverSync: false })

  const refreshServerBoard = useCallback(async () => {
    if (!SERVER_API_ENABLED) return
    setServerBoardState('loading')
    setServerBoardError(null)
    try {
      const payload = await pmsApi<{ ok: true; data: ServerBoard }>('/api/front-desk/board', authToken)
      setServerBoard(payload.data)
      setRooms(mapServerBoardRooms(payload.data))
      setServerBoardState('ready')
    } catch (error) {
      setServerBoard(null)
      setServerBoardState('error')
      setServerBoardError(error instanceof Error ? error.message : 'Live PMS board is unavailable.')
      throw error
    }
  }, [authToken, setRooms])

  useEffect(() => {
    if (!open) return
    void refreshServerBoard().catch(() => undefined)
  }, [open, refreshServerBoard])

  const snapshot = useMemo<AssistantSnapshot>(() => {
    const serverReservations = (serverBoard?.reservations || []).map(normalizeServerReservation)
    const fallbackReservations = SERVER_API_ENABLED
      ? []
      : [
          ...(localReservations || []).map(localReservationToAssistant),
          ...(unassignedReservations || []).map(unassignedToAssistant),
        ]
    return buildSnapshotFromData({
      hotelDateKey: getBangkokDateKey(new Date()),
      rooms: SERVER_API_ENABLED ? (serverBoard ? mapServerBoardRooms(serverBoard) : []) : rooms,
      reservations: [...serverReservations, ...fallbackReservations],
      currentRoute,
      currentRoomNumber: context.roomNumber,
      currentReservationId: context.reservationId,
      user: user ? { id: user.id, role: user.role, displayName: user.displayName } : null,
    })
  }, [context.reservationId, context.roomNumber, currentRoute, localReservations, rooms, serverBoard, unassignedReservations, user])

  const addAssistantAnswer = useCallback((prompt: string, answer: AssistantAnswer) => {
    const now = new Date().toISOString()
    const safeAnswer = {
      ...answer,
      actions: answer.actions.map((action) => {
        const denied = Boolean(action.permission && !hasPermission(action.permission))
        const workflowLabel = ACTION_WORKFLOW_LABELS[action.type]
        return {
          ...action,
          ...(workflowLabel ? {
            label: workflowLabel,
            description: 'Opens a staff-controlled, permission-checked PMS workflow. The assistant does not apply the change.',
            requiresConfirmation: false,
            risk: 'low' as const,
          } : {}),
          disabled: action.disabled || denied,
          disabledReason: denied
            ? `${action.permission} permission is required.`
            : action.disabledReason,
        }
      }),
    } satisfies AssistantAnswer
    setMessages((current) => [
      ...current,
      { id: `msg-user-${Date.now()}`, role: 'user', content: prompt, createdAt: now },
      { id: `msg-ai-${Date.now()}`, role: 'assistant', content: safeAnswer.directAnswer, answer: safeAnswer, createdAt: now },
    ])
  }, [hasPermission])

  const submitAssistantPrompt = useCallback((prompt: string, options?: OpenAssistantOptions) => {
    const trimmed = prompt.trim()
    if (!trimmed) return
    onOpenChange(true)
    setError(null)
    if (SERVER_API_ENABLED && serverBoardState !== 'ready') {
      const unavailable = serverBoardState === 'loading'
        ? 'Live PMS records are still loading. Please wait for the board to finish loading before asking about guests or rooms.'
        : `Live PMS records are unavailable${serverBoardError ? `: ${serverBoardError}` : ''}. Retry the live board before relying on this assistant.`
      addAssistantAnswer(trimmed, {
        id: `live-pms-unavailable-${Date.now()}`,
        intent: 'HELP',
        title: 'Live PMS unavailable',
        directAnswer: unavailable,
        records: [],
        warnings: ['No browser or demo guest data was used.'],
        nextAction: 'Retry the live PMS board, then ask again.',
        actions: [],
      })
      setInput('')
      return
    }
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
  }, [addAssistantAnswer, context, onOpenChange, serverBoardError, serverBoardState, snapshot])

  useEffect(() => {
    if (!request) return
    if (SERVER_API_ENABLED && serverBoardState === 'loading') return
    setContext((current) => ({ ...current, ...request }))
    if (request.prompt) submitAssistantPrompt(request.prompt, request)
    onRequestHandled(request.requestId)
  }, [onRequestHandled, request, serverBoardState, submitAssistantPrompt])

  const executeAction = useCallback((actionToRun: AssistantAction) => {
    if (actionToRun.disabled) return
    const reservationId = String(actionToRun.payload?.reservationId || '')
    const folioId = String(actionToRun.payload?.folioId || '')
    let opened = false

    if (HOUSEKEEPING_ACTIONS.has(actionToRun.type)) {
      navigate('housekeeping')
      opened = true
    } else if (actionToRun.type === 'OPEN_ROOM') {
      navigate('board')
      opened = true
    } else if (actionToRun.type === 'CREATE_WALK_IN_DRAFT') {
      opened = navigateToAuthoritativeWorkflow('front-desk', { workflow: 'walk-in' })
    } else if (actionToRun.type === 'OPEN_CHECK_IN' || actionToRun.type === 'COMPLETE_EXPRESS_CHECK_IN') {
      opened = navigateToAuthoritativeWorkflow('front-desk', { workflow: 'check-in', reservationId })
    } else if (actionToRun.type === 'OPEN_CHECK_OUT' || actionToRun.type === 'COMPLETE_EXPRESS_CHECK_OUT') {
      opened = navigateToAuthoritativeWorkflow('front-desk', { workflow: 'check-out', reservationId })
    } else if (actionToRun.type === 'OPEN_PAYMENT' || actionToRun.type === 'ADD_PAYMENT' || actionToRun.type === 'ADD_CHARGE') {
      opened = navigateToAuthoritativeWorkflow('cashier', { workflow: 'cashier', reservationId, folioId })
      if (!opened) {
        navigate('cashier')
        opened = true
      }
    } else if (reservationId) {
      opened = navigateToAuthoritativeWorkflow('board', { workflow: 'assignment', reservationId })
    } else if (actionToRun.type === 'OPEN_RESERVATION') {
      navigate('board')
      opened = true
    }

    if (opened) {
      onOpenChange(false)
      toast.info('Sent the request to the authoritative staff workflow. No change was applied by Front Desk AI.')
    } else {
      toast.error('The assistant could not open that workflow because its record identifier was missing or invalid.')
    }
  }, [navigate, onOpenChange])

  const resetConversation = () => {
    setMessages([])
    setError(null)
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
                {SERVER_API_ENABLED ? (serverBoardState === 'ready' ? 'Live PMS' : serverBoardState === 'loading' ? 'Loading PMS' : 'PMS unavailable') : 'Demo PMS'}
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

          {SERVER_API_ENABLED && serverBoardState !== 'ready' && (
            <div className="flex items-center justify-between gap-2 border-b bg-amber-50 px-4 py-2 text-xs text-amber-900" role="status">
              <span>{serverBoardState === 'loading' ? 'Loading live PMS records. Guest context is unavailable.' : `Live PMS unavailable${serverBoardError ? `: ${serverBoardError}` : ''}`}</span>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => void refreshServerBoard().catch(() => undefined)} disabled={serverBoardState === 'loading'}>
                {serverBoardState === 'loading' ? 'Loading…' : 'Retry'}
              </Button>
            </div>
          )}

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
                  {message.role === 'user' ? message.content : <AnswerCard answer={message.answer} onAction={executeAction} />}
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
