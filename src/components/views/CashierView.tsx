import { useState, useMemo, useCallback, useEffect } from 'react'
import { z } from 'zod'
import { useKV } from '@github/spark/hooks'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { 
  MagnifyingGlass, Plus, Receipt, CreditCard, Money, CalendarBlank,
  Warning, CheckCircle, Clock, Printer, Download
} from '@phosphor-icons/react'
import { format } from 'date-fns'
import { cn } from '@/lib/utils'
import { AccountingDashboard } from '@/components/cashier/AccountingDashboard'
import { CashReconciliation } from '@/components/cashier/CashReconciliation'
import { useRoomSync } from '@/hooks/use-room-sync'
import { nightsBetween } from '@/lib/hotel/business-rules'
import { pmsApi, SERVER_API_ENABLED } from '@/lib/pms-api-client'
import { durableAttemptKeys } from '@/lib/durable-attempt-key'
import {
  clearAuthoritativeWorkflowQuery,
  readAuthoritativeWorkflowQuery,
  useAuthoritativeWorkflowNavigationVersion,
} from '@/lib/authoritative-workflow-navigation'
import { escapeHtml } from '@/lib/html-escape'
import { toast } from 'sonner'
import type { BoardRoomCard } from '@/types/board'
import type { PropertySetup } from '@/types/onboarding'
import { capabilityEnabled, useSystemCapabilities } from '@/hooks/use-system-capabilities'
import { formatMoneySatang, parseMoneySatang, type MoneySatang } from '@/types/money'
import { useAuth } from '@/hooks/use-auth'

function calculateTax(amount: number, taxRate: number = 7) {
  const subtotal = amount / (1 + taxRate / 100)
  const taxAmount = amount - subtotal
  return {
    subtotal: Math.round(subtotal * 100) / 100,
    taxAmount: Math.round(taxAmount * 100) / 100,
    total: Math.round(amount * 100) / 100
  }
}

interface FolioCharge {
  id: string
  date: Date
  category: 'ROOM' | 'EXTRA_GUEST' | 'CHILD' | 'CAFE' | 'LAUNDRY' | 'MINIBAR' | 'DAMAGE' | 'OTHER'
  description: string
  quantity: number
  unitPrice: number
  subtotal: number
  tax: number
  total: number
  postedBy: string
  unitPriceSatang?: MoneySatang
  totalSatang?: MoneySatang
}

interface FolioPayment {
  id: string
  date: Date
  method: 'CASH' | 'CARD' | 'BANK_TRANSFER' | 'ONLINE' | 'OTHER'
  amount: number
  reference?: string
  receivedBy: string
  amountSatang?: MoneySatang
}

interface Folio {
  id: string
  reservationId: string
  guestName: string
  roomNumber: string
  checkIn: Date
  checkOut?: Date
  status: 'OPEN' | 'CLOSED' | 'VOID' | 'REFUNDED'
  
  charges: FolioCharge[]
  payments: FolioPayment[]
  
  subtotal: number
  tax: number
  total: number
  paid: number
  balance: number
  
  createdAt: Date
  updatedAt: Date
  closedAt?: Date
  subtotalSatang?: MoneySatang
  taxSatang?: MoneySatang
  totalSatang?: MoneySatang
  paidSatang?: MoneySatang
  balanceSatang?: MoneySatang
}

interface AccountingEntry {
  id: string
  date: string
  type: 'REVENUE' | 'EXPENSE' | 'REFUND' | 'ADJUSTMENT'
  category: string
  subcategory?: string
  amount: number
  description: string
  referenceType?: 'FOLIO' | 'RESERVATION' | 'MANUAL'
  referenceId?: string
  paymentMethod?: string
  taxAmount?: number
  createdBy: string
  createdAt: string
}

type ServerCashierState = 'loading' | 'ready' | 'error'
type FolioListSetter = (updater: Folio[] | ((current: Folio[]) => Folio[])) => void
type AccountingEntrySetter = (updater: AccountingEntry[] | ((current: AccountingEntry[]) => AccountingEntry[])) => void

interface CashierWorkspaceSource {
  foliosRaw: Folio[]
  setFoliosRaw: FolioListSetter
  canonicalFoliosRaw: Folio[]
  setCanonicalFolios: FolioListSetter
  setAccountingEntries: AccountingEntrySetter
  propertyData: Pick<PropertySetup, 'name' | 'currency'>
  rooms: BoardRoomCard[]
  serverFolios: Folio[]
  setServerFolios: FolioListSetter
  serverCashierState: ServerCashierState
  serverSnapshotError: string | null
  refreshServerFolios: () => Promise<Folio[]>
}

const noOpFolioListSetter: FolioListSetter = () => undefined
const noOpAccountingEntrySetter: AccountingEntrySetter = () => undefined

function folioFromRoom(room: BoardRoomCard): Folio | null {
  if (!room.guestName || !room.checkIn) return null

  const balance = room.balanceDue || 0
  const total = room.reservation?.totalAmount ?? balance
  const nights = room.checkOut ? Math.max(1, nightsBetween(room.checkIn, room.checkOut)) : 1
  const paid = Math.max(0, total - balance)
  const roomRate = nights > 0 ? Math.round(total / nights) : total
  const checkIn = new Date(room.checkIn)
  const updatedAt = room.lastUpdatedAt ? new Date(room.lastUpdatedAt) : new Date()

  return {
    id: `folio-${room.reservationId || room.currentReservationId || room.roomId}`,
    reservationId: room.reservationId || room.currentReservationId || room.roomId,
    guestName: room.guestName,
    roomNumber: room.number,
    checkIn,
    checkOut: room.checkOut ? new Date(room.checkOut) : undefined,
    status: room.status === 'VACANT_DIRTY' ? 'CLOSED' : 'OPEN',
    charges: total > 0 ? [{
      id: `charge-${room.roomId}`,
      date: checkIn,
      category: 'ROOM',
      description: `Room ${room.number} - ${nights} night${nights === 1 ? '' : 's'}`,
      quantity: nights,
      unitPrice: roomRate,
      subtotal: total,
      tax: 0,
      total,
      postedBy: 'Front desk',
    }] : [],
    payments: paid > 0 ? [{
      id: `payment-${room.roomId}`,
      date: updatedAt,
      method: room.depositStatus === 'PAID' ? 'CASH' : 'BANK_TRANSFER',
      amount: paid,
      reference: room.depositStatus === 'PAID' ? 'Deposit recorded' : undefined,
      receivedBy: 'Front desk',
    }] : [],
    subtotal: total,
    tax: 0,
    total,
    paid,
    balance,
    createdAt: checkIn,
    updatedAt,
    closedAt: room.status === 'VACANT_DIRTY' ? updatedAt : undefined,
  }
}

function normalizeChargeCategory(category: string): FolioCharge['category'] {
  if (['ROOM', 'EXTRA_GUEST', 'CHILD', 'CAFE', 'LAUNDRY', 'MINIBAR', 'DAMAGE'].includes(category)) {
    return category as FolioCharge['category']
  }
  return 'OTHER'
}

function normalizePaymentMethod(method: string): FolioPayment['method'] {
  if (['CASH', 'CARD', 'BANK_TRANSFER', 'ONLINE'].includes(method)) {
    return method as FolioPayment['method']
  }
  return 'OTHER'
}

function satangToDisplayBaht(value: MoneySatang): number {
  const satang = parseMoneySatang(value)
  const whole = satang / 100n
  if (whole > BigInt(Number.MAX_SAFE_INTEGER) || whole < BigInt(Number.MIN_SAFE_INTEGER)
    || satang > BigInt(Number.MAX_SAFE_INTEGER) || satang < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new TypeError('Cashier amount exceeds the safe display range.')
  }
  return Number(satang) / 100
}

function parseBahtInputToSatang(value: string): MoneySatang {
  const match = value.trim().match(/^(\d+)(?:\.(\d{1,2}))?$/)
  if (!match) throw new TypeError('Enter an amount with no more than two decimal places.')
  const whole = BigInt(match[1])
  const fraction = BigInt((match[2] || '').padEnd(2, '0') || '0')
  return (whole * 100n + fraction).toString() as MoneySatang
}

function moneySatangToDecimal(value: MoneySatang): string {
  const satang = parseMoneySatang(value)
  const sign = satang < 0n ? '-' : ''
  const absolute = satang < 0n ? -satang : satang
  return `${sign}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, '0')}`
}

const serverMoneySatangSchema = z.string()
  .regex(/^[+-]?\d+$/, 'Money satang must be a base-10 integer string.')
  .transform((value) => value as MoneySatang)
const serverTimestampSchema = z.string().datetime({ offset: true })
const serverChargeCategorySchema = z.enum(['ROOM', 'EXTRA_GUEST', 'CHILD', 'CAFE', 'LAUNDRY', 'MINIBAR', 'DAMAGE', 'OTHER'])
const serverPaymentMethodSchema = z.enum(['CASH', 'CARD', 'BANK_TRANSFER', 'ONLINE', 'OTHER'])

const serverCashierFolioSchema = z.object({
  id: z.string().min(1),
  reservationId: z.string().min(1),
  guestName: z.string().min(1),
  roomNumber: z.string().min(1),
  checkIn: serverTimestampSchema,
  checkOut: serverTimestampSchema.nullable(),
  status: z.enum(['OPEN', 'CLOSED', 'REFUNDED']),
  charges: z.array(z.object({
    id: z.string().min(1),
    postedAt: serverTimestampSchema,
    category: serverChargeCategorySchema,
    description: z.string().min(1),
    quantity: z.number().int().positive(),
    unitPriceSatang: serverMoneySatangSchema,
    totalSatang: serverMoneySatangSchema,
    postedBy: z.string().nullable().optional(),
  }).strict()),
  payments: z.array(z.object({
    id: z.string().min(1),
    postedAt: serverTimestampSchema,
    method: serverPaymentMethodSchema,
    amountSatang: serverMoneySatangSchema,
    reference: z.string().nullable().optional(),
    receivedBy: z.string().nullable().optional(),
  }).strict()),
  subtotalSatang: serverMoneySatangSchema,
  taxSatang: serverMoneySatangSchema,
  totalSatang: serverMoneySatangSchema,
  paidSatang: serverMoneySatangSchema,
  balanceSatang: serverMoneySatangSchema,
  createdAt: serverTimestampSchema,
  updatedAt: serverTimestampSchema,
}).strict()

const serverCashierFoliosResponseSchema = z.object({
  property: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    currency: z.string().regex(/^[A-Z]{3}$/, 'Property currency must be a three-letter ISO code.'),
  }).strict(),
  folios: z.array(serverCashierFolioSchema),
}).strict()

type ServerCashierFolio = z.infer<typeof serverCashierFolioSchema>

function folioFromServerDto(record: ServerCashierFolio): Folio {
  const charges = record.charges.map((charge): FolioCharge => ({
    id: charge.id,
    date: new Date(charge.postedAt),
    category: normalizeChargeCategory(charge.category),
    description: charge.description,
    quantity: charge.quantity,
    unitPrice: satangToDisplayBaht(charge.unitPriceSatang),
    subtotal: satangToDisplayBaht(charge.totalSatang),
    tax: 0,
    total: satangToDisplayBaht(charge.totalSatang),
    postedBy: charge.postedBy || 'System',
    unitPriceSatang: charge.unitPriceSatang,
    totalSatang: charge.totalSatang,
  }))
  const payments = record.payments.map((payment): FolioPayment => ({
    id: payment.id,
    date: new Date(payment.postedAt),
    method: normalizePaymentMethod(payment.method),
    amount: satangToDisplayBaht(payment.amountSatang),
    reference: payment.reference || undefined,
    receivedBy: payment.receivedBy || 'Cashier',
    amountSatang: payment.amountSatang,
  }))

  return {
    id: record.id,
    reservationId: record.reservationId,
    guestName: record.guestName,
    roomNumber: record.roomNumber,
    checkIn: new Date(record.checkIn),
    checkOut: record.checkOut ? new Date(record.checkOut) : undefined,
    status: record.status,
    charges,
    payments,
    subtotal: satangToDisplayBaht(record.subtotalSatang),
    tax: satangToDisplayBaht(record.taxSatang),
    total: satangToDisplayBaht(record.totalSatang),
    paid: satangToDisplayBaht(record.paidSatang),
    balance: satangToDisplayBaht(record.balanceSatang),
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt),
    subtotalSatang: record.subtotalSatang,
    taxSatang: record.taxSatang,
    totalSatang: record.totalSatang,
    paidSatang: record.paidSatang,
    balanceSatang: record.balanceSatang,
  }
}

function deserializeFolio(folio: Folio): Folio {
  return {
    ...folio,
    checkIn: new Date(folio.checkIn),
    checkOut: folio.checkOut ? new Date(folio.checkOut) : undefined,
    createdAt: new Date(folio.createdAt),
    updatedAt: new Date(folio.updatedAt),
    closedAt: folio.closedAt ? new Date(folio.closedAt) : undefined,
    charges: folio.charges.map(charge => ({
      ...charge,
      date: new Date(charge.date)
    })),
    payments: folio.payments.map(payment => ({
      ...payment,
      date: new Date(payment.date)
    }))
  }
}

export function CashierView() {
  return SERVER_API_ENABLED ? <ServerCashierView /> : <DemoCashierView />
}

function DemoCashierView() {
  const [foliosRaw, setFoliosRaw] = useKV<Folio[]>('cashier-folios', [])
  const [canonicalFoliosRaw, setCanonicalFolios] = useKV<Folio[]>('folios', [])
  const [, setAccountingEntries] = useKV<AccountingEntry[]>('accounting-entries', [])
  const [propertyData] = useKV<PropertySetup>('onboarding-property', {} as PropertySetup)
  const { rooms } = useRoomSync()

  return (
    <CashierWorkspace
      source={{
        foliosRaw,
        setFoliosRaw,
        canonicalFoliosRaw,
        setCanonicalFolios,
        setAccountingEntries,
        propertyData,
        rooms,
        serverFolios: [],
        setServerFolios: noOpFolioListSetter,
        serverCashierState: 'ready',
        serverSnapshotError: null,
        refreshServerFolios: async () => [],
      }}
    />
  )
}

function ServerCashierView() {
  const [serverFolios, setServerFolios] = useState<Folio[]>([])
  const [serverPropertyData, setServerPropertyData] = useState<Pick<PropertySetup, 'name' | 'currency'>>({ name: '', currency: '' })
  const [serverCashierState, setServerCashierState] = useState<ServerCashierState>('loading')
  const [serverSnapshotError, setServerSnapshotError] = useState<string | null>(null)

  const refreshServerFolios = useCallback(async () => {
    setServerCashierState('loading')
    setServerSnapshotError(null)
    try {
      const payload = await pmsApi<{ ok: true; data: unknown }>('/api/cashier/folios', null)
      const snapshot = serverCashierFoliosResponseSchema.parse(payload.data)
      const nextFolios = snapshot.folios.map(folioFromServerDto)
      setServerFolios(nextFolios)
      setServerPropertyData({ name: snapshot.property.name, currency: snapshot.property.currency })
      setServerCashierState('ready')
      return nextFolios
    } catch (error) {
      setServerFolios([])
      setServerPropertyData({ name: '', currency: '' })
      setServerCashierState('error')
      setServerSnapshotError('The PMS cashier snapshot is unavailable. Retry before recording a payment or charge.')
      throw error
    }
  }, [])

  useEffect(() => {
    void refreshServerFolios().catch(() => undefined)
  }, [refreshServerFolios])

  useEffect(() => {
    let refreshTimer: number | undefined
    const onDomainEvent = (event: Event) => {
      const detail = (event as CustomEvent<{ aggregateType?: unknown }>).detail
      const aggregateType = typeof detail?.aggregateType === 'string' ? detail.aggregateType.toLowerCase() : ''
      if (!['payment', 'charge', 'folio', 'reservation'].includes(aggregateType)) return
      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer)
      refreshTimer = window.setTimeout(() => {
        void refreshServerFolios().catch(() => undefined)
      }, 100)
    }

    window.addEventListener('pms:domain-event', onDomainEvent)
    return () => {
      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer)
      window.removeEventListener('pms:domain-event', onDomainEvent)
    }
  }, [refreshServerFolios])

  return (
    <CashierWorkspace
      source={{
        foliosRaw: [],
        setFoliosRaw: noOpFolioListSetter,
        canonicalFoliosRaw: [],
        setCanonicalFolios: noOpFolioListSetter,
        setAccountingEntries: noOpAccountingEntrySetter,
        propertyData: serverPropertyData,
        rooms: [],
        serverFolios,
        setServerFolios,
        serverCashierState,
        serverSnapshotError,
        refreshServerFolios,
      }}
    />
  )
}

function CashierWorkspace({ source }: { source: CashierWorkspaceSource }) {
  const workflowNavigationVersion = useAuthoritativeWorkflowNavigationVersion()
  const {
    foliosRaw,
    setFoliosRaw,
    canonicalFoliosRaw,
    setCanonicalFolios,
    setAccountingEntries,
    propertyData,
    rooms,
    serverFolios,
    setServerFolios,
    serverCashierState,
    serverSnapshotError,
    refreshServerFolios,
  } = source
  const authToken = null
  const { hasPermission } = useAuth()
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedFolio, setSelectedFolio] = useState<Folio | null>(null)
  const [selectedTab, setSelectedTab] = useState<'open' | 'closed' | 'all' | 'accounting' | 'reconciliation'>('open')
  const [paymentFolio, setPaymentFolio] = useState<Folio | null>(null)
  const [paymentAmount, setPaymentAmount] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<FolioPayment['method']>('CASH')
  const [paymentReference, setPaymentReference] = useState('')
  const [paymentError, setPaymentError] = useState<string | null>(null)
  const [isSubmittingPayment, setIsSubmittingPayment] = useState(false)
  const [chargeFolio, setChargeFolio] = useState<Folio | null>(null)
  const [chargeCategory, setChargeCategory] = useState<FolioCharge['category']>('OTHER')
  const [chargeDescription, setChargeDescription] = useState('')
  const [chargeAmount, setChargeAmount] = useState('')
  const [chargeQuantity, setChargeQuantity] = useState('1')
  const [chargeError, setChargeError] = useState<string | null>(null)
  const [isSubmittingCharge, setIsSubmittingCharge] = useState(false)
  const { registry } = useSystemCapabilities()
  // The browser-backed accounting widgets are demo-only until Accounting V2 has its own server authority surface.
  const accountingV2Available = !SERVER_API_ENABLED && capabilityEnabled(registry?.finance.accountingV2)

  useEffect(() => {
    if (!accountingV2Available && (selectedTab === 'accounting' || selectedTab === 'reconciliation')) {
      setSelectedTab('open')
    }
  }, [accountingV2Available, selectedTab])

  const paymentAmountNumber = Number(paymentAmount) || 0
  const paymentRemainingBalance = paymentFolio
    ? Math.max(0, Math.round((paymentFolio.balance - paymentAmountNumber) * 100) / 100)
    : 0
  const paymentPreview = useMemo(() => {
    if (!SERVER_API_ENABLED || !paymentFolio?.balanceSatang) return undefined
    try {
      const balance = parseMoneySatang(paymentFolio.balanceSatang)
      const payment = parseMoneySatang(parseBahtInputToSatang(paymentAmount || '0'))
      const remaining = balance - payment
      return {
        remainingSatang: (remaining > 0n ? remaining : 0n).toString() as MoneySatang,
        closesFolio: payment > 0n && payment === balance,
      }
    } catch {
      return { remainingSatang: paymentFolio.balanceSatang, closesFolio: false }
    }
  }, [paymentAmount, paymentFolio])
  const paymentRemainingBalanceSatang = paymentPreview?.remainingSatang
  const paymentWillClose = SERVER_API_ENABLED
    ? paymentPreview?.closesFolio === true
    : paymentAmountNumber > 0 && paymentAmountNumber <= (paymentFolio?.balance || 0) && paymentRemainingBalance <= 0
  const paymentReferenceRequired = ['CARD', 'BANK_TRANSFER', 'ONLINE'].includes(paymentMethod)
  const canProcessPayment = hasPermission('process:payment')
  const canPostCharges = hasPermission('post:charges')
  const currency = propertyData?.currency?.trim().toUpperCase() || 'THB'
  const formatAmount = useCallback((amount: number, satang?: MoneySatang) => {
    if (SERVER_API_ENABLED) {
      if (!satang) throw new TypeError('Authoritative Cashier money is missing exact satang.')
      return formatMoneySatang(satang, currency)
    }
    return new Intl.NumberFormat('en-TH', { style: 'currency', currency }).format(amount)
  }, [currency])
  const exportAmount = useCallback((amount: number, satang?: MoneySatang) => {
    if (SERVER_API_ENABLED) {
      if (!satang) throw new TypeError('Authoritative Cashier export is missing exact satang.')
      return moneySatangToDecimal(satang)
    }
    return amount.toFixed(2)
  }, [])

  const requireAuthoritativeSnapshot = () => {
    if (!SERVER_API_ENABLED || serverCashierState === 'ready') return true
    toast.error('Cashier is unavailable until the authoritative PMS snapshot is restored.')
    return false
  }
  const isLoadingFolios = SERVER_API_ENABLED && serverCashierState === 'loading'
  const folioError = SERVER_API_ENABLED && serverCashierState === 'error' ? serverSnapshotError : null

  const postAccountingReceipt = useCallback((folio: Folio, amount: number, method: FolioPayment['method'], reference?: string) => {
    if (SERVER_API_ENABLED) return null

    const recordedAt = new Date()
    const entry: AccountingEntry = {
      id: `ACC-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      date: recordedAt.toISOString(),
      type: 'REVENUE',
      category: 'Folio Payments',
      subcategory: method.replace('_', ' '),
      amount,
      description: `Payment received from ${folio.guestName} for room ${folio.roomNumber}${reference ? ` (${reference})` : ''}`,
      referenceType: 'FOLIO',
      referenceId: folio.id,
      paymentMethod: method,
      taxAmount: 0,
      createdBy: 'Cashier',
      createdAt: recordedAt.toISOString(),
    }

    setAccountingEntries((current) => [entry, ...(Array.isArray(current) ? current : [])])
    return entry
  }, [setAccountingEntries])

  const folios = useMemo(() => {
    if (SERVER_API_ENABLED) return serverFolios

    const merged = new Map<string, Folio>()
    ;(canonicalFoliosRaw || []).map(deserializeFolio).forEach((folio) => {
      merged.set(folio.id, folio)
    })
    ;(foliosRaw || []).map(deserializeFolio).forEach((folio) => {
      merged.set(folio.id, folio)
    })
    rooms.map(folioFromRoom).filter(Boolean).forEach((folio) => {
      if (folio && !merged.has(folio.id)) merged.set(folio.id, folio)
    })
    return [...merged.values()]
  }, [canonicalFoliosRaw, foliosRaw, rooms, serverFolios])
  
  const setFolios = (updater: Folio[] | ((current: Folio[]) => Folio[])) => {
    if (SERVER_API_ENABLED) {
      setServerFolios((current) => typeof updater === 'function' ? updater(current) : updater)
      return
    }

    setFoliosRaw((current) => {
      const base = current?.length ? current : canonicalFoliosRaw || []
      const deserialized = base.map(deserializeFolio)
      const updated = typeof updater === 'function' ? updater(deserialized) : updater
      setCanonicalFolios(updated)
      return updated
    })
  }
  
  const filteredFolios = useMemo(() => {
    let result = folios
    
    switch (selectedTab) {
      case 'open':
        result = result.filter(f => f.status === 'OPEN')
        break
      case 'closed':
        result = result.filter(f => f.status === 'CLOSED' || f.status === 'REFUNDED')
        break
    }
    
    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      result = result.filter(f =>
        f.guestName.toLowerCase().includes(query) ||
        f.roomNumber.includes(query) ||
        f.id.toLowerCase().includes(query)
      )
    }
    
    return result
  }, [folios, selectedTab, searchQuery])

  useEffect(() => {
    const query = readAuthoritativeWorkflowQuery()
    if (query?.workflow !== 'cashier' || serverCashierState !== 'ready') return

    const folio = folios.find((candidate) => (
      candidate.id === query.folioId
      && candidate.reservationId === query.reservationId
    ))
    clearAuthoritativeWorkflowQuery()
    if (!folio) {
      toast.error('The requested folio is not available to this cashier session.')
      return
    }
    setSelectedTab(folio.status === 'OPEN' ? 'open' : 'all')
    setSelectedFolio(folio)
  }, [folios, serverCashierState, workflowNavigationVersion])
  
  const stats = useMemo(() => {
    const open = folios.filter(f => f.status === 'OPEN')
    if (SERVER_API_ENABLED) {
      const sumSatang = (items: Folio[], field: 'balanceSatang' | 'totalSatang' | 'paidSatang') => items.reduce((total, folio) => {
        const value = folio[field]
        if (!value) throw new TypeError(`Authoritative folio ${folio.id} is missing ${field}.`)
        return total + parseMoneySatang(value)
      }, 0n)
      return {
        openFolios: open.length,
        totalOutstanding: satangToDisplayBaht(sumSatang(open, 'balanceSatang').toString() as MoneySatang),
        totalRevenue: satangToDisplayBaht(sumSatang(folios, 'totalSatang').toString() as MoneySatang),
        totalCollected: satangToDisplayBaht(sumSatang(folios, 'paidSatang').toString() as MoneySatang),
        totalOutstandingSatang: sumSatang(open, 'balanceSatang').toString() as MoneySatang,
        totalRevenueSatang: sumSatang(folios, 'totalSatang').toString() as MoneySatang,
        totalCollectedSatang: sumSatang(folios, 'paidSatang').toString() as MoneySatang,
      }
    }
    const totalOutstanding = open.reduce((sum, f) => sum + f.balance, 0)
    const totalRevenue = folios.reduce((sum, f) => sum + f.total, 0)
    const totalCollected = folios.reduce((sum, f) => sum + f.paid, 0)
    
    return {
      openFolios: open.length,
      totalOutstanding,
      totalRevenue,
      totalCollected,
      totalOutstandingSatang: undefined,
      totalRevenueSatang: undefined,
      totalCollectedSatang: undefined,
    }
  }, [folios])
  
  const getCategoryColor = (category: FolioCharge['category']) => {
    switch (category) {
      case 'ROOM': return 'bg-blue-100 text-blue-800'
      case 'EXTRA_GUEST': return 'bg-green-100 text-green-800'
      case 'CHILD': return 'bg-amber-100 text-amber-800'
      case 'CAFE': return 'bg-purple-100 text-purple-800'
      case 'LAUNDRY': return 'bg-cyan-100 text-cyan-800'
      case 'MINIBAR': return 'bg-pink-100 text-pink-800'
      case 'DAMAGE': return 'bg-red-100 text-red-800'
      default: return 'bg-slate-100 text-slate-800'
    }
  }
  
  const getPaymentMethodColor = (method: FolioPayment['method']) => {
    switch (method) {
      case 'CASH': return 'bg-emerald-100 text-emerald-800'
      case 'CARD': return 'bg-blue-100 text-blue-800'
      case 'BANK_TRANSFER': return 'bg-violet-100 text-violet-800'
      case 'ONLINE': return 'bg-pink-100 text-pink-800'
      case 'OTHER': return 'bg-slate-100 text-slate-800'
    }
  }

  const openPaymentDialog = (folio: Folio) => {
    if (!requireAuthoritativeSnapshot()) return
    if (!canProcessPayment) {
      toast.error('Payment processing permission is required.')
      return
    }
    setPaymentFolio(folio)
    setPaymentAmount(
      SERVER_API_ENABLED && folio.balanceSatang
        ? moneySatangToDecimal(folio.balanceSatang)
        : folio.balance > 0 ? String(folio.balance.toFixed(2)) : '',
    )
    setPaymentMethod('CASH')
    setPaymentReference('')
    setPaymentError(null)
  }

  const openChargeDialog = (folio: Folio) => {
    if (!requireAuthoritativeSnapshot()) return
    if (!canPostCharges) {
      toast.error('Charge posting permission is required.')
      return
    }
    setChargeFolio(folio)
    setChargeCategory('OTHER')
    setChargeDescription('')
    setChargeAmount('')
    setChargeQuantity('1')
    setChargeError(null)
  }

  const openPostChargeFromHeader = () => {
    if (!requireAuthoritativeSnapshot()) return
    if (!canPostCharges) {
      toast.error('Charge posting permission is required.')
      return
    }
    const openFolios = folios.filter((folio) => folio.status === 'OPEN')
    if (openFolios.length === 1) {
      openChargeDialog(openFolios[0])
      return
    }
    setSelectedTab('open')
    toast.message(openFolios.length > 1 ? 'Select an open folio, then add the charge.' : 'No open folios are available for charges.')
  }

  const printSelectedFolio = (folio: Folio) => {
    const printWindow = window.open('', '_blank')
    if (!printWindow) {
      toast.error('Allow pop-ups to print this folio.')
      return
    }

    const propertyName = propertyData?.name?.trim() || 'Hotel'
    const chargeRows = folio.charges.map((charge) => `
      <tr>
        <td>${format(charge.date, 'yyyy-MM-dd')}</td>
        <td>${escapeHtml(charge.category)}</td>
        <td>${escapeHtml(charge.description)}</td>
        <td class="num">${charge.quantity}</td>
        <td class="num">${escapeHtml(formatAmount(charge.unitPrice, charge.unitPriceSatang))}</td>
        <td class="num">${escapeHtml(formatAmount(charge.total, charge.totalSatang))}</td>
      </tr>
    `).join('')
    const paymentRows = folio.payments.map((payment) => `
      <tr>
        <td>${format(payment.date, 'yyyy-MM-dd HH:mm')}</td>
        <td>${escapeHtml(payment.method.replace('_', ' '))}</td>
        <td>${escapeHtml(payment.reference || '')}</td>
        <td class="num">${escapeHtml(formatAmount(payment.amount, payment.amountSatang))}</td>
      </tr>
    `).join('')

    printWindow.document.write(`
      <!doctype html>
      <html>
        <head>
          <title>Folio ${escapeHtml(folio.id)}</title>
          <style>
            body { font-family: Inter, Arial, sans-serif; margin: 32px; color: #111827; }
            h1 { margin: 0 0 4px; font-size: 24px; }
            .muted { color: #6b7280; margin-bottom: 24px; }
            table { width: 100%; border-collapse: collapse; margin: 16px 0 24px; }
            th, td { border-bottom: 1px solid #e5e7eb; padding: 8px; text-align: left; font-size: 12px; }
            th { background: #f3f4f6; }
            .num { text-align: right; }
            .totals { margin-left: auto; width: 280px; }
            .totals div { display: flex; justify-content: space-between; padding: 4px 0; }
            .balance { font-weight: 700; font-size: 16px; }
          </style>
        </head>
        <body>
          <h1>${escapeHtml(propertyName)} Folio ${escapeHtml(folio.id)}</h1>
          <div class="muted">${escapeHtml(folio.guestName)} · Room ${escapeHtml(folio.roomNumber)} · ${format(folio.checkIn, 'yyyy-MM-dd')} to ${folio.checkOut ? format(folio.checkOut, 'yyyy-MM-dd') : 'In-house'}</div>
          <h2>Charges</h2>
          <table><thead><tr><th>Date</th><th>Category</th><th>Description</th><th class="num">Qty</th><th class="num">Unit</th><th class="num">Total</th></tr></thead><tbody>${chargeRows || '<tr><td colspan="6">No charges</td></tr>'}</tbody></table>
          <h2>Payments</h2>
          <table><thead><tr><th>Date</th><th>Method</th><th>Reference</th><th class="num">Amount</th></tr></thead><tbody>${paymentRows || '<tr><td colspan="4">No payments</td></tr>'}</tbody></table>
          <div class="totals">
            <div><span>Subtotal</span><span>${escapeHtml(formatAmount(folio.subtotal, folio.subtotalSatang))}</span></div>
            <div><span>Paid</span><span>${escapeHtml(formatAmount(folio.paid, folio.paidSatang))}</span></div>
            <div class="balance"><span>Balance</span><span>${escapeHtml(formatAmount(folio.balance, folio.balanceSatang))}</span></div>
          </div>
        </body>
      </html>
    `)
    printWindow.document.close()
    printWindow.focus()
    printWindow.print()
  }

  const exportSelectedFolio = (folio: Folio) => {
    const rows = [
      ['type', 'date', 'category_or_method', 'description_or_reference', 'quantity', 'amount', 'total'],
      ...folio.charges.map((charge) => ['charge', format(charge.date, 'yyyy-MM-dd'), charge.category, charge.description, String(charge.quantity), exportAmount(charge.unitPrice, charge.unitPriceSatang), exportAmount(charge.total, charge.totalSatang)]),
      ...folio.payments.map((payment) => ['payment', format(payment.date, 'yyyy-MM-dd HH:mm'), payment.method, payment.reference || '', '', exportAmount(payment.amount, payment.amountSatang), exportAmount(payment.amount, payment.amountSatang)]),
      ['summary', '', 'subtotal', '', '', '', exportAmount(folio.subtotal, folio.subtotalSatang)],
      ['summary', '', 'paid', '', '', '', exportAmount(folio.paid, folio.paidSatang)],
      ['summary', '', 'balance', '', '', '', exportAmount(folio.balance, folio.balanceSatang)],
    ]
    const csv = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `${folio.id}.csv`
    link.click()
    URL.revokeObjectURL(url)
    toast.success(`Exported folio ${folio.id}.`)
  }

  const handleSubmitPayment = async () => {
    if (!paymentFolio) return
    if (!requireAuthoritativeSnapshot()) return
    if (!canProcessPayment) {
      setPaymentError('Payment processing permission is required.')
      return
    }
    let amount: number
    let amountSatang: MoneySatang | undefined
    if (SERVER_API_ENABLED) {
      try {
        amountSatang = parseBahtInputToSatang(paymentAmount)
        if (parseMoneySatang(amountSatang) <= 0n) throw new TypeError('Payment amount must be greater than zero.')
        if (!paymentFolio.balanceSatang) throw new TypeError('Authoritative folio balance is unavailable.')
        if (parseMoneySatang(amountSatang) > parseMoneySatang(paymentFolio.balanceSatang)) {
          throw new TypeError('Payment cannot exceed the remaining balance.')
        }
        amount = satangToDisplayBaht(amountSatang)
      } catch (error) {
        setPaymentError(error instanceof Error ? error.message : 'Payment amount must be a valid exact amount.')
        return
      }
    } else {
      amount = Number(paymentAmount)
      if (!Number.isFinite(amount) || amount <= 0) {
        setPaymentError('Payment amount must be greater than zero.')
        return
      }
      if (amount > paymentFolio.balance) {
        setPaymentError('Payment cannot exceed the remaining balance.')
        return
      }
    }
    if (paymentReferenceRequired && !paymentReference.trim()) {
      setPaymentError('Reference is required for card, transfer, and online payments.')
      return
    }

    setIsSubmittingPayment(true)
    setPaymentError(null)
    try {
      if (SERVER_API_ENABLED) {
        const requestBody = {
          folioId: paymentFolio.id,
          amountSatang: amountSatang!,
          method: paymentMethod,
          reference: paymentReference.trim() || undefined,
        }
        const attempt = {
          operation: 'cashier-payment' as const,
          entityId: paymentFolio.id,
          material: requestBody,
        }
        const idempotencyKey = await durableAttemptKeys.getOrCreate(attempt)
        await pmsApi('/api/payments', authToken, {
          method: 'POST',
          headers: { 'x-idempotency-key': idempotencyKey },
          body: JSON.stringify(requestBody),
        })
        const nextFolios = await refreshServerFolios()
        await durableAttemptKeys.confirmSuccess(attempt)
        const updated = nextFolios.find((folio) => folio.id === paymentFolio.id)
        if (updated) setSelectedFolio(updated)
      } else {
        const payment: FolioPayment = {
          id: `payment-${Date.now()}`,
          date: new Date(),
          method: paymentMethod,
          amount,
          reference: paymentReference.trim() || undefined,
          receivedBy: 'Cashier',
        }
        setFolios((current) => current.map((folio) => {
          if (folio.id !== paymentFolio.id) return folio
          const paid = Math.round((folio.paid + amount) * 100) / 100
          const balance = Math.round(Math.max(0, folio.total - paid) * 100) / 100
          const updated = {
            ...folio,
            payments: [...folio.payments, payment],
            paid,
            balance,
            status: balance <= 0 ? 'CLOSED' as const : 'OPEN' as const,
            updatedAt: new Date(),
            closedAt: balance <= 0 ? new Date() : folio.closedAt,
          }
          setSelectedFolio(updated)
          return updated
        }))
      }
      if (!SERVER_API_ENABLED) {
        postAccountingReceipt(paymentFolio, amount, paymentMethod, paymentReference.trim() || undefined)
      }
      toast.success(`Payment recorded for folio ${paymentFolio.id}.`)
      setPaymentFolio(null)
    } catch (error) {
      setPaymentError(error instanceof Error ? error.message : 'Payment could not be recorded.')
    } finally {
      setIsSubmittingPayment(false)
    }
  }

  const handleSubmitCharge = async () => {
    if (!chargeFolio) return
    if (!requireAuthoritativeSnapshot()) return
    if (!canPostCharges) {
      setChargeError('Charge posting permission is required.')
      return
    }
    let amount: number
    let amountSatang: MoneySatang | undefined
    const quantity = Number(chargeQuantity)
    if (!chargeDescription.trim()) {
      setChargeError('Charge description is required.')
      return
    }
    if (SERVER_API_ENABLED) {
      try {
        amountSatang = parseBahtInputToSatang(chargeAmount)
        if (parseMoneySatang(amountSatang) <= 0n) throw new TypeError('Charge amount must be greater than zero.')
        amount = satangToDisplayBaht(amountSatang)
      } catch (error) {
        setChargeError(error instanceof Error ? error.message : 'Charge amount must be a valid exact amount.')
        return
      }
    } else {
      amount = Number(chargeAmount)
      if (!Number.isFinite(amount) || amount <= 0) {
        setChargeError('Charge amount must be greater than zero.')
        return
      }
    }
    if (!Number.isInteger(quantity) || quantity < 1) {
      setChargeError('Quantity must be at least 1.')
      return
    }

    setIsSubmittingCharge(true)
    setChargeError(null)
    try {
      if (SERVER_API_ENABLED) {
        const requestBody = {
          folioId: chargeFolio.id,
          category: chargeCategory,
          description: chargeDescription,
          amountSatang: amountSatang!,
          quantity,
        }
        const attempt = {
          operation: 'cashier-charge' as const,
          entityId: chargeFolio.id,
          material: requestBody,
        }
        const idempotencyKey = await durableAttemptKeys.getOrCreate(attempt)
        await pmsApi('/api/charges', authToken, {
          method: 'POST',
          headers: { 'x-idempotency-key': idempotencyKey },
          body: JSON.stringify(requestBody),
        })
        const nextFolios = await refreshServerFolios()
        await durableAttemptKeys.confirmSuccess(attempt)
        const updated = nextFolios.find((folio) => folio.id === chargeFolio.id)
        if (updated) setSelectedFolio(updated)
      } else {
        const { subtotal, taxAmount, total } = calculateTax(amount * quantity, 0)
        const charge: FolioCharge = {
          id: `charge-${Date.now()}`,
          date: new Date(),
          category: chargeCategory,
          description: chargeDescription.trim(),
          quantity,
          unitPrice: amount,
          subtotal,
          tax: taxAmount,
          total,
          postedBy: 'Cashier',
        }
        setFolios((current) => current.map((folio) => {
          if (folio.id !== chargeFolio.id) return folio
          const updatedTotal = Math.round((folio.total + total) * 100) / 100
          const updated = {
            ...folio,
            charges: [...folio.charges, charge],
            subtotal: Math.round((folio.subtotal + subtotal) * 100) / 100,
            tax: Math.round((folio.tax + taxAmount) * 100) / 100,
            total: updatedTotal,
            balance: Math.round((updatedTotal - folio.paid) * 100) / 100,
            status: 'OPEN' as const,
            updatedAt: new Date(),
          }
          setSelectedFolio(updated)
          return updated
        }))
      }
      toast.success(`Charge posted to folio ${chargeFolio.id}.`)
      setChargeFolio(null)
    } catch (error) {
      setChargeError(error instanceof Error ? error.message : 'Charge could not be posted.')
    } finally {
      setIsSubmittingCharge(false)
    }
  }

  if (SERVER_API_ENABLED && serverCashierState !== 'ready') {
    if (serverCashierState === 'loading') {
      return (
        <div className="flex min-h-full items-center justify-center bg-muted/20 p-6" data-testid="server-cashier-loading">
          <div className="rounded-lg border bg-background px-4 py-3 text-sm text-muted-foreground shadow-sm">
            Loading authoritative cashier folios…
          </div>
        </div>
      )
    }

    return (
      <div className="flex min-h-full items-center justify-center bg-muted/20 p-6" data-testid="server-cashier-error">
        <Card className="max-w-md p-6 text-center shadow-sm">
          <h1 className="text-lg font-semibold text-foreground">Cashier unavailable</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {serverSnapshotError || 'The PMS cashier snapshot is unavailable. Retry before recording a payment or charge.'}
          </p>
          <Button className="mt-4" variant="outline" onClick={() => void refreshServerFolios().catch(() => undefined)}>
            Retry
          </Button>
        </Card>
      </div>
    )
  }
  
  return (
    <div className="h-screen flex flex-col bg-background" data-testid={SERVER_API_ENABLED ? 'server-cashier-view' : undefined}>
      <div className="flex-none border-b border-border bg-card">
        <div className="px-4 py-2.5">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h1 className="text-lg font-semibold text-foreground">Cashier</h1>
              <p className="text-xs text-muted-foreground mt-0.5">
                Manage guest folios and payments
              </p>
            </div>
            {canPostCharges && (
              <Button size="sm" className="gap-1.5 h-7 text-xs" onClick={openPostChargeFromHeader}>
                <Plus size={14} weight="bold" />
                Post Charge
              </Button>
            )}
          </div>
          
          <div className="relative max-w-sm">
            <MagnifyingGlass className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" size={14} />
            <Input
              placeholder="Search by guest, room, or folio..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 h-7 text-xs"
            />
          </div>
          {folioError && (
            <div className="mt-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {folioError}
            </div>
          )}
        </div>
        
        <div className="px-4 pb-2.5">
          <div className="grid grid-cols-4 gap-2">
            <Card className="p-2">
              <div className="text-[10px] font-medium text-muted-foreground mb-0.5">Open Folios</div>
              <div className="text-lg font-bold text-foreground">{stats.openFolios}</div>
            </Card>
            <Card className="p-2">
              <div className="text-[10px] font-medium text-muted-foreground mb-0.5">Outstanding</div>
              <div className="text-lg font-bold text-orange-600">{formatAmount(stats.totalOutstanding, stats.totalOutstandingSatang)}</div>
            </Card>
            <Card className="p-2">
              <div className="text-[10px] font-medium text-muted-foreground mb-0.5">Revenue</div>
              <div className="text-lg font-bold text-emerald-600">{formatAmount(stats.totalRevenue, stats.totalRevenueSatang)}</div>
            </Card>
            <Card className="p-2">
              <div className="text-[10px] font-medium text-muted-foreground mb-0.5">Collected</div>
              <div className="text-lg font-bold text-blue-600">{formatAmount(stats.totalCollected, stats.totalCollectedSatang)}</div>
            </Card>
          </div>
        </div>
      </div>
      
      <Tabs value={selectedTab} onValueChange={(v) => setSelectedTab(v as any)} className="flex-1 flex flex-col">
        <div className="flex-none border-b border-border bg-card px-4">
          <TabsList className="bg-transparent h-8">
            <TabsTrigger value="open" className="text-xs">Open</TabsTrigger>
            <TabsTrigger value="closed" className="text-xs">Closed</TabsTrigger>
            <TabsTrigger value="all" className="text-xs">All</TabsTrigger>
            {accountingV2Available && <TabsTrigger value="accounting" className="text-xs">Accounting</TabsTrigger>}
            {accountingV2Available && <TabsTrigger value="reconciliation" className="text-xs">Reconciliation</TabsTrigger>}
          </TabsList>
        </div>
        
        {accountingV2Available && (
          <TabsContent value="accounting" className="flex-1 m-0 p-4">
            <ScrollArea className="h-full">
              <AccountingDashboard />
            </ScrollArea>
          </TabsContent>
        )}

        {accountingV2Available && (
          <TabsContent value="reconciliation" className="flex-1 m-0 p-4">
            <ScrollArea className="h-full">
              <CashReconciliation />
            </ScrollArea>
          </TabsContent>
        )}
        
        <TabsContent value={selectedTab} className="flex-1 m-0 p-4">
          <ScrollArea className="h-full">
            <div className="space-y-2">
              {filteredFolios.length === 0 ? (
                <Card className="p-8 text-center">
                  <Receipt className="mx-auto mb-3 text-muted-foreground" size={40} weight="light" />
                  <h3 className="text-base font-medium text-foreground mb-1.5">
                    {isLoadingFolios ? 'Loading folios...' : 'No folios found'}
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    {isLoadingFolios ? 'Checking persistent cashier records.' : searchQuery ? 'Try adjusting your search terms' : 'No folios in this category'}
                  </p>
                </Card>
              ) : (
                filteredFolios.map(folio => (
                  <Card 
                    key={folio.id}
                    className="p-3 hover:border-primary/50 transition-colors cursor-pointer"
                    onClick={() => setSelectedFolio(folio)}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1.5">
                          <h3 className="text-sm font-semibold text-foreground">{folio.guestName}</h3>
                          <Badge variant="outline" className="text-[10px] py-0 h-4">
                            Room {folio.roomNumber}
                          </Badge>
                          <Badge 
                            className={cn(
                              'text-[10px] border py-0 h-4',
                              folio.status === 'OPEN' && 'bg-blue-100 text-blue-800 border-blue-200',
                              (folio.status === 'CLOSED' || folio.status === 'REFUNDED') && 'bg-slate-100 text-slate-600 border-slate-200'
                            )}
                          >
                            {folio.status}
                          </Badge>
                          {folio.balance > 0 && folio.status === 'OPEN' && (
                            <Badge className="bg-orange-100 text-orange-800 border-orange-200 text-[10px] py-0 h-4">
                              <Warning size={10} weight="fill" className="mr-0.5" />
                              Due
                            </Badge>
                          )}
                        </div>
                        
                        <div className="grid grid-cols-4 gap-3 text-xs text-muted-foreground">
                          <div>
                            <span className="font-medium">Folio:</span> #{folio.id}
                          </div>
                          <div className="flex items-center gap-1">
                            <CalendarBlank size={12} />
                            {format(folio.checkIn, 'MMM d')} - {folio.checkOut ? format(folio.checkOut, 'MMM d, yy') : 'In-house'}
                          </div>
                          <div>
                            <span className="font-medium">Charges:</span> {folio.charges.length}
                          </div>
                          <div>
                            <span className="font-medium">Payments:</span> {folio.payments.length}
                          </div>
                        </div>
                      </div>
                      
                      <div className="text-right ml-4 min-w-[160px]">
                        <div className="space-y-0.5 text-xs mb-1.5">
                          <div className="flex justify-between text-muted-foreground">
                            <span>Subtotal:</span>
                            <span>{formatAmount(folio.subtotal, folio.subtotalSatang)}</span>
                          </div>
                          <div className="flex justify-between text-muted-foreground">
                            <span>Included tax:</span>
                            <span>{formatAmount(folio.tax, folio.taxSatang)}</span>
                          </div>
                          <Separator className="my-0.5" />
                          <div className="flex justify-between font-semibold text-sm text-foreground">
                            <span>Total:</span>
                            <span>{formatAmount(folio.total, folio.totalSatang)}</span>
                          </div>
                          <div className="flex justify-between text-emerald-600 text-xs">
                            <span>Paid:</span>
                            <span>{formatAmount(folio.paid, folio.paidSatang)}</span>
                          </div>
                          {folio.balance > 0 && (
                            <div className="flex justify-between font-bold text-orange-600 text-xs">
                              <span>Balance:</span>
                              <span>{formatAmount(folio.balance, folio.balanceSatang)}</span>
                            </div>
                          )}
                        </div>
                        {folio.balance === 0 && (folio.status === 'CLOSED' || folio.status === 'REFUNDED') && (
                          <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 text-[10px] w-full justify-center py-0 h-4">
                            <CheckCircle size={10} weight="fill" className="mr-0.5" />
                            Paid in Full
                          </Badge>
                        )}
                          {folio.status === 'OPEN' && folio.balance > 0 && canProcessPayment && (
                          <Button
                            size="sm"
                            className="mt-2 h-7 w-full gap-1.5 text-xs"
                            onClick={(event) => {
                              event.stopPropagation()
                              openPaymentDialog(folio)
                            }}
                          >
                            <Money size={14} />
                            Collect
                          </Button>
                        )}
                      </div>
                    </div>
                  </Card>
                ))
              )}
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>
      
      {selectedFolio && (
        <Dialog open={!!selectedFolio} onOpenChange={() => setSelectedFolio(null)}>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-3">
                    <span>Folio #{selectedFolio.id}</span>
                    <Badge 
                      className={cn(
                        'text-xs',
                        selectedFolio.status === 'OPEN' && 'bg-blue-100 text-blue-800',
                        (selectedFolio.status === 'CLOSED' || selectedFolio.status === 'REFUNDED') && 'bg-slate-100 text-slate-600'
                      )}
                    >
                      {selectedFolio.status}
                    </Badge>
                  </div>
                  <div className="text-sm font-normal text-muted-foreground mt-1">
                    {selectedFolio.guestName} • Room {selectedFolio.roomNumber}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" className="gap-2" onClick={() => printSelectedFolio(selectedFolio)}>
                    <Printer size={16} />
                    Print
                  </Button>
                  <Button variant="outline" size="sm" className="gap-2" onClick={() => exportSelectedFolio(selectedFolio)}>
                    <Download size={16} />
                    Export
                  </Button>
                </div>
              </DialogTitle>
            </DialogHeader>
            
            <div className="space-y-6 py-4">
              <div>
                <h4 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                  <Receipt size={18} />
                  Charges
                </h4>
                <div className="border border-border rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-muted">
                      <tr>
                        <th className="text-left p-3 font-medium text-muted-foreground">Date</th>
                        <th className="text-left p-3 font-medium text-muted-foreground">Category</th>
                        <th className="text-left p-3 font-medium text-muted-foreground">Description</th>
                        <th className="text-right p-3 font-medium text-muted-foreground">Qty</th>
                        <th className="text-right p-3 font-medium text-muted-foreground">Unit Price</th>
                        <th className="text-right p-3 font-medium text-muted-foreground">Tax</th>
                        <th className="text-right p-3 font-medium text-muted-foreground">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {selectedFolio.charges.map(charge => (
                        <tr key={charge.id} className="hover:bg-muted/50">
                          <td className="p-3 text-muted-foreground">{format(charge.date, 'MMM d, HH:mm')}</td>
                          <td className="p-3">
                            <Badge variant="outline" className={cn('text-xs', getCategoryColor(charge.category))}>
                              {charge.category}
                            </Badge>
                          </td>
                          <td className="p-3 text-foreground">{charge.description}</td>
                          <td className="p-3 text-right text-muted-foreground">{charge.quantity}</td>
                          <td className="p-3 text-right text-foreground">{formatAmount(charge.unitPrice, charge.unitPriceSatang)}</td>
                          <td className="p-3 text-right text-muted-foreground">{formatAmount(charge.tax, SERVER_API_ENABLED ? '0' as MoneySatang : undefined)}</td>
                          <td className="p-3 text-right font-medium text-foreground">{formatAmount(charge.total, charge.totalSatang)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              
              {selectedFolio.payments.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                    <CreditCard size={18} />
                    Payments
                  </h4>
                  <div className="border border-border rounded-lg overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-muted">
                        <tr>
                          <th className="text-left p-3 font-medium text-muted-foreground">Date</th>
                          <th className="text-left p-3 font-medium text-muted-foreground">Method</th>
                          <th className="text-left p-3 font-medium text-muted-foreground">Reference</th>
                          <th className="text-left p-3 font-medium text-muted-foreground">Received By</th>
                          <th className="text-right p-3 font-medium text-muted-foreground">Amount</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {selectedFolio.payments.map(payment => (
                          <tr key={payment.id} className="hover:bg-muted/50">
                            <td className="p-3 text-muted-foreground">{format(payment.date, 'MMM d, HH:mm')}</td>
                            <td className="p-3">
                              <Badge variant="outline" className={cn('text-xs', getPaymentMethodColor(payment.method))}>
                                {payment.method.replace('_', ' ')}
                              </Badge>
                            </td>
                            <td className="p-3 text-muted-foreground font-mono text-xs">{payment.reference || '—'}</td>
                            <td className="p-3 text-muted-foreground">{payment.receivedBy}</td>
                            <td className="p-3 text-right font-medium text-emerald-600">{formatAmount(payment.amount, payment.amountSatang)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              
              <div className="bg-muted p-4 rounded-lg">
                <div className="space-y-2 text-sm max-w-md ml-auto">
                  <div className="flex justify-between text-muted-foreground">
                    <span>Subtotal:</span>
                    <span>{formatAmount(selectedFolio.subtotal, selectedFolio.subtotalSatang)}</span>
                  </div>
                  <div className="flex justify-between text-muted-foreground">
                    <span>Included tax:</span>
                    <span>{formatAmount(selectedFolio.tax, selectedFolio.taxSatang)}</span>
                  </div>
                  <Separator className="my-2" />
                  <div className="flex justify-between font-semibold text-base text-foreground">
                    <span>Total:</span>
                    <span>{formatAmount(selectedFolio.total, selectedFolio.totalSatang)}</span>
                  </div>
                  <div className="flex justify-between text-emerald-600">
                    <span>Paid:</span>
                    <span>{formatAmount(selectedFolio.paid, selectedFolio.paidSatang)}</span>
                  </div>
                  <Separator className="my-2" />
                  <div className={cn(
                    "flex justify-between font-bold text-lg",
                    selectedFolio.balance > 0 ? 'text-orange-600' : 'text-emerald-600'
                  )}>
                    <span>Balance Due:</span>
                    <span>{formatAmount(selectedFolio.balance, selectedFolio.balanceSatang)}</span>
                  </div>
                </div>
              </div>
              
              {selectedFolio.status === 'OPEN' && selectedFolio.balance > 0 && (canProcessPayment || canPostCharges) && (
                <div className="flex gap-3">
                  {canProcessPayment && (
                    <Button className="flex-1 gap-2" onClick={() => openPaymentDialog(selectedFolio)}>
                      <Money size={18} />
                      Collect Payment
                    </Button>
                  )}
                  {canPostCharges && (
                    <Button variant="outline" className="flex-1 gap-2" onClick={() => openChargeDialog(selectedFolio)}>
                      <Plus size={18} />
                      Add Charge
                    </Button>
                  )}
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}

      {paymentFolio && (
        <Dialog open={!!paymentFolio} onOpenChange={(open) => !open && setPaymentFolio(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Collect payment</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="rounded-md border bg-muted/40 p-3 text-sm">
                <div className="font-medium">{paymentFolio.guestName}</div>
                <div className="text-muted-foreground">Folio #{paymentFolio.id} · Room {paymentFolio.roomNumber}</div>
                <div className="mt-2 font-semibold text-orange-600">
                  Balance due: {formatAmount(paymentFolio.balance, paymentFolio.balanceSatang)}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="payment-amount">Payment amount</Label>
                <div className="grid grid-cols-3 gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setPaymentAmount(
                      SERVER_API_ENABLED && paymentFolio.balanceSatang
                        ? moneySatangToDecimal(paymentFolio.balanceSatang)
                        : paymentFolio.balance.toFixed(2),
                    )}
                  >
                    Full
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setPaymentAmount(
                      SERVER_API_ENABLED && paymentFolio.balanceSatang
                        ? moneySatangToDecimal(((parseMoneySatang(paymentFolio.balanceSatang) + 1n) / 2n).toString() as MoneySatang)
                        : (Math.round((paymentFolio.balance / 2) * 100) / 100).toFixed(2),
                    )}
                  >
                    Half
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setPaymentAmount('')}
                  >
                    Clear
                  </Button>
                </div>
                <Input
                  id="payment-amount"
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={paymentAmount}
                  onChange={(event) => setPaymentAmount(event.target.value)}
                />
                <div className="rounded-md border bg-muted/40 p-3 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Remaining after payment</span>
                    <span className={cn('font-semibold', paymentWillClose ? 'text-emerald-600' : 'text-orange-600')}>
                      {formatAmount(paymentRemainingBalance, paymentRemainingBalanceSatang)}
                    </span>
                  </div>
                  {paymentWillClose && (
                    <div className="mt-1 flex items-center gap-1 text-emerald-600">
                      <CheckCircle size={12} weight="fill" />
                      This payment will close the folio.
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <Label>Payment method</Label>
                <Select value={paymentMethod} onValueChange={(value) => setPaymentMethod(value as FolioPayment['method'])}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CASH">Cash</SelectItem>
                    <SelectItem value="CARD">Card</SelectItem>
                    <SelectItem value="BANK_TRANSFER">Bank transfer</SelectItem>
                    <SelectItem value="ONLINE">Online / PromptPay</SelectItem>
                    <SelectItem value="OTHER">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="payment-reference">Reference</Label>
                <Input
                  id="payment-reference"
                  value={paymentReference}
                  onChange={(event) => setPaymentReference(event.target.value)}
                  placeholder={paymentReferenceRequired ? 'Required for this payment method' : 'Receipt, transfer, or card reference'}
                />
                {paymentReferenceRequired && (
                  <p className="text-xs text-muted-foreground">Card, transfer, and online receipts need a reference for audit export.</p>
                )}
              </div>

              {paymentError && (
                <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {paymentError}
                </div>
              )}

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setPaymentFolio(null)} disabled={isSubmittingPayment}>
                  Cancel
                </Button>
                <Button onClick={handleSubmitPayment} disabled={isSubmittingPayment}>
                  {isSubmittingPayment ? 'Recording...' : 'Record payment'}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {chargeFolio && (
        <Dialog open={!!chargeFolio} onOpenChange={(open) => !open && setChargeFolio(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Post charge</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="rounded-md border bg-muted/40 p-3 text-sm">
                <div className="font-medium">{chargeFolio.guestName}</div>
                <div className="text-muted-foreground">Folio #{chargeFolio.id} · Room {chargeFolio.roomNumber}</div>
              </div>

              <div className="space-y-2">
                <Label>Category</Label>
                <Select value={chargeCategory} onValueChange={(value) => setChargeCategory(value as FolioCharge['category'])}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ROOM">Room</SelectItem>
                    <SelectItem value="EXTRA_GUEST">Extra guest</SelectItem>
                    <SelectItem value="CHILD">Child</SelectItem>
                    <SelectItem value="CAFE">Cafe</SelectItem>
                    <SelectItem value="MINIBAR">Minibar</SelectItem>
                    <SelectItem value="LAUNDRY">Laundry</SelectItem>
                    <SelectItem value="DAMAGE">Damage</SelectItem>
                    <SelectItem value="OTHER">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="charge-description">Description</Label>
                <Textarea
                  id="charge-description"
                  value={chargeDescription}
                  onChange={(event) => setChargeDescription(event.target.value)}
                  placeholder="Extra towels, minibar, cafe order"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="charge-amount">Unit amount</Label>
                  <Input
                    id="charge-amount"
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={chargeAmount}
                    onChange={(event) => setChargeAmount(event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="charge-quantity">Quantity</Label>
                  <Input
                    id="charge-quantity"
                    type="number"
                    min="1"
                    step="1"
                    value={chargeQuantity}
                    onChange={(event) => setChargeQuantity(event.target.value)}
                  />
                </div>
              </div>

              {chargeError && (
                <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {chargeError}
                </div>
              )}

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setChargeFolio(null)} disabled={isSubmittingCharge}>
                  Cancel
                </Button>
                <Button onClick={handleSubmitCharge} disabled={isSubmittingCharge}>
                  {isSubmittingCharge ? 'Posting...' : 'Post charge'}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
