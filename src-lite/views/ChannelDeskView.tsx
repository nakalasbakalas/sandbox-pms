import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { ApiError, liteApi } from '../api'
import { EmptyBlock, LoadingBlock, Modal, StatCard, StatusPill, formatDate } from '../components'
import { useI18n } from '../i18n'
import type {
  BookingEmailEvent,
  ChannelDeskPayload,
  Language,
  ManualChannelConnection,
  ManualChannelTask,
} from '../types'

const POLL_INTERVAL_MS = 30_000
const RECONCILIATION_FRESH_MS = 10 * 60_000
const WATCH_WARNING_MS = 24 * 60 * 60_000
const MIN_REASON_LENGTH = 5

type DeskCopy = {
  title: string
  subtitle: string
  refreshed: string
  refreshFailed: string
  sessionExpired: string
  forbidden: string
  invalidRequest: string
  changedConflict: string
  unavailable: string
  actionFailed: string
  actionSaved: string
  pushDelivery: string
  credentials: string
  reconciliation: string
  enabled: string
  disabled: string
  ready: string
  attention: string
  current: string
  stale: string
  unknown: string
  lastPush: string
  lastReconciled: string
  pendingDeliveries: string
  mailboxIssue: string
  parserErrors: string
  failedTasks: string
  reviewHelp: string
  availabilityHelp: string
  connectionHelp: string
  noReviewEvents: string
  noAvailabilityTasks: string
  noConnections: string
  reference: string
  received: string
  reason: string
  reasonRequired: string
  reasonPlaceholder: string
  approveTitle: string
  rejectTitle: string
  confirmApprove: string
  confirmReject: string
  incompleteEvent: string
  reviewCount: string
  taskCount: string
  activeConnections: string
  taskDate: string
  revision: string
  desiredAvailability: string
  confirmedAvailability: string
  completionNotes: string
  notesPlaceholder: string
  unsafeLink: string
  mappings: string
  externalRoomType: string
  externalRoomTypeId: string
  externalRatePlanId: string
  mappingMissing: string
  manualMode: string
  channexMode: string
  connectionEnabled: string
  connectionDisabled: string
  completeInvalid: string
  completing: string
  markComplete: string
  openExtranet: string
  actionReasonHelp: string
  guestSummary: string
  staySummary: string
  roomSummary: string
  amountSummary: string
  matchedReservation: string
  unmatchedReservation: string
  selectReservation: string
  noCandidateReservations: string
  linkRequired: string
}

const deskCopy: Record<Language, DeskCopy> = {
  en: {
    desiredAvailability: 'Availability to set',
    markComplete: 'Mark complete',
    openExtranet: 'Open Extranet',
    title: 'Channel Desk',
    subtitle: 'Review inbound OTA email and complete manual availability updates.',
    refreshed: 'Last refreshed',
    refreshFailed: 'Channel Desk could not refresh. The last confirmed data remains on screen.',
    sessionExpired: 'Your session has expired. Sign in again before continuing.',
    forbidden: 'Your role cannot perform this action.',
    invalidRequest: 'Check the required information and try again.',
    changedConflict: 'This item changed since it was loaded. The latest version is being refreshed.',
    unavailable: 'The service is temporarily unavailable. No change was recorded.',
    actionFailed: 'The action could not be completed. No success has been assumed.',
    actionSaved: 'The action was confirmed by the server.',
    pushDelivery: 'Gmail push',
    credentials: 'Mailbox credentials',
    reconciliation: 'Five-minute reconciliation',
    enabled: 'Enabled',
    disabled: 'Disabled',
    ready: 'Ready',
    attention: 'Needs attention',
    current: 'Current',
    stale: 'Late',
    unknown: 'Not yet confirmed',
    lastPush: 'Last push',
    lastReconciled: 'Last reconciliation',
    pendingDeliveries: 'Pending deliveries',
    mailboxIssue: 'Mailbox synchronization requires attention. Sensitive provider errors are hidden here.',
    parserErrors: 'email events could not be parsed and need manager review in the full Booking Inbox.',
    failedTasks: 'availability tasks failed and must be reconciled by a manager before they can be completed.',
    reviewHelp: 'Nothing changes a reservation until an authorized staff member reviews and applies the event.',
    availabilityHelp: 'Enter the displayed availability in the OTA Extranet, verify it there, then complete the matching revision.',
    connectionHelp: 'Connections store mappings and safe Extranet links only. OTA passwords and 2FA data are never stored here.',
    noReviewEvents: 'No booking, modification, or cancellation email is waiting for review.',
    noAvailabilityTasks: 'No manual availability update is currently pending.',
    noConnections: 'No OTA connection has been configured.',
    reference: 'OTA reference',
    received: 'Received',
    reason: 'Operational reason',
    reasonRequired: 'Enter a clear operational reason of at least five characters.',
    reasonPlaceholder: 'Why this event is being approved or rejected',
    approveTitle: 'Approve inbound event',
    rejectTitle: 'Reject inbound event',
    confirmApprove: 'Confirm approval',
    confirmReject: 'Confirm rejection',
    incompleteEvent: 'Required booking details or an exact reservation reference are missing. Review or reject this event instead of applying it.',
    reviewCount: 'Awaiting review',
    taskCount: 'Availability tasks',
    activeConnections: 'Enabled connections',
    taskDate: 'Stay date',
    revision: 'Revision',
    confirmedAvailability: 'Availability confirmed in OTA',
    completionNotes: 'Completion evidence',
    notesPlaceholder: 'Where or how the update was verified',
    unsafeLink: 'Extranet link unavailable',
    mappings: 'active mappings',
    externalRoomType: 'OTA room type',
    externalRoomTypeId: 'OTA room type ID',
    externalRatePlanId: 'OTA rate-plan ID',
    mappingMissing: 'Active OTA mapping missing. A manager must repair the mapping before this task can be completed.',
    manualMode: 'Manual updates',
    channexMode: 'Certified rail',
    connectionEnabled: 'Enabled',
    connectionDisabled: 'Disabled',
    completeInvalid: 'Confirmed availability must be a whole number of zero or more.',
    completing: 'Saving…',
    actionReasonHelp: 'Cancellation, modification, and rejection actions require an auditable reason.',
    guestSummary: 'Guest',
    staySummary: 'Stay',
    roomSummary: 'Room type',
    amountSummary: 'Amount',
    matchedReservation: 'Matched to a PMS reservation',
    unmatchedReservation: 'No exact PMS reservation match',
    selectReservation: 'Select the verified PMS reservation',
    noCandidateReservations: 'No candidate reservation was found. Verify the OTA reference, then create or locate the booking in Bookings before applying this event.',
    linkRequired: 'Select the reservation you verified in the official OTA Extranet.',
  },
  th: {
    desiredAvailability: 'จำนวนห้องว่างที่ต้องตั้ง',
    markComplete: 'ยืนยันว่าเสร็จแล้ว',
    openExtranet: 'เปิด Extranet',
    title: 'ช่องทาง OTA',
    subtitle: 'ตรวจสอบอีเมลการจองจาก OTA และอัปเดตจำนวนห้องว่างด้วยตนเอง',
    refreshed: 'รีเฟรชล่าสุด',
    refreshFailed: 'ไม่สามารถรีเฟรชข้อมูลช่องทางได้ ข้อมูลล่าสุดที่ยืนยันแล้วยังคงแสดงอยู่',
    sessionExpired: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง',
    forbidden: 'สิทธิ์ผู้ใช้ของคุณไม่สามารถดำเนินการนี้ได้',
    invalidRequest: 'กรุณาตรวจสอบข้อมูลที่จำเป็นแล้วลองอีกครั้ง',
    changedConflict: 'รายการนี้มีการเปลี่ยนแปลง ระบบกำลังโหลดเวอร์ชันล่าสุด',
    unavailable: 'ระบบไม่พร้อมใช้งานชั่วคราว และยังไม่ได้บันทึกการเปลี่ยนแปลง',
    actionFailed: 'ดำเนินการไม่สำเร็จ ระบบจะไม่แสดงว่าสำเร็จโดยไม่มีการยืนยัน',
    actionSaved: 'เซิร์ฟเวอร์ยืนยันการดำเนินการแล้ว',
    pushDelivery: 'Gmail Push',
    credentials: 'สิทธิ์เชื่อมต่อกล่องอีเมล',
    reconciliation: 'ตรวจสอบซ้ำทุก 5 นาที',
    enabled: 'เปิดใช้งาน',
    disabled: 'ปิดใช้งาน',
    ready: 'พร้อม',
    attention: 'ต้องตรวจสอบ',
    current: 'เป็นปัจจุบัน',
    stale: 'ล่าช้า',
    unknown: 'ยังไม่ยืนยัน',
    lastPush: 'Push ล่าสุด',
    lastReconciled: 'ตรวจสอบซ้ำล่าสุด',
    pendingDeliveries: 'รายการ Push ที่รอ',
    mailboxIssue: 'การซิงก์กล่องอีเมลต้องได้รับการตรวจสอบ รายละเอียดผู้ให้บริการที่ละเอียดอ่อนถูกซ่อนไว้',
    parserErrors: 'อีเมลไม่สามารถแยกข้อมูลได้ และผู้จัดการต้องตรวจสอบใน Booking Inbox แบบเต็ม',
    failedTasks: 'งานอัปเดตห้องว่างล้มเหลว และผู้จัดการต้องตรวจสอบก่อนจึงจะยืนยันได้',
    reviewHelp: 'ระบบจะไม่เปลี่ยนแปลงการจองจนกว่าพนักงานที่มีสิทธิ์จะตรวจสอบและยืนยันรายการ',
    availabilityHelp: 'กรอกจำนวนห้องว่างตามที่แสดงใน Extranet ตรวจสอบผล แล้วจึงยืนยันงานตามเลข revision',
    connectionHelp: 'ระบบเก็บเฉพาะ mapping และลิงก์ Extranet ที่ปลอดภัย ไม่เก็บรหัสผ่าน OTA หรือข้อมูล 2FA',
    noReviewEvents: 'ไม่มีอีเมลการจอง การแก้ไข หรือการยกเลิกที่รอตรวจสอบ',
    noAvailabilityTasks: 'ไม่มีงานอัปเดตจำนวนห้องว่างที่รอดำเนินการ',
    noConnections: 'ยังไม่ได้ตั้งค่าการเชื่อมต่อ OTA',
    reference: 'เลขอ้างอิง OTA',
    received: 'ได้รับเมื่อ',
    reason: 'เหตุผลในการดำเนินการ',
    reasonRequired: 'กรุณาระบุเหตุผลที่ชัดเจนอย่างน้อย 5 ตัวอักษร',
    reasonPlaceholder: 'เหตุผลที่อนุมัติหรือปฏิเสธรายการนี้',
    approveTitle: 'อนุมัติรายการจากอีเมล',
    rejectTitle: 'ปฏิเสธรายการจากอีเมล',
    confirmApprove: 'ยืนยันการอนุมัติ',
    confirmReject: 'ยืนยันการปฏิเสธ',
    incompleteEvent: 'ข้อมูลการจองหรือเลขอ้างอิงที่ตรงกันยังไม่ครบ กรุณาตรวจสอบหรือปฏิเสธแทนการนำไปใช้',
    reviewCount: 'รอตรวจสอบ',
    taskCount: 'งานอัปเดตห้องว่าง',
    activeConnections: 'ช่องทางที่เปิดใช้',
    taskDate: 'วันที่เข้าพัก',
    revision: 'Revision',
    confirmedAvailability: 'จำนวนห้องที่ยืนยันใน OTA',
    completionNotes: 'หลักฐานการยืนยัน',
    notesPlaceholder: 'ตรวจสอบการอัปเดตที่ใดหรืออย่างไร',
    unsafeLink: 'ไม่มีลิงก์ Extranet ที่ปลอดภัย',
    mappings: 'mapping ที่เปิดใช้',
    externalRoomType: 'ประเภทห้องใน OTA',
    externalRoomTypeId: 'รหัสประเภทห้องใน OTA',
    externalRatePlanId: 'รหัสแผนราคาใน OTA',
    mappingMissing: 'ไม่พบ mapping OTA ที่เปิดใช้ ผู้จัดการต้องแก้ไข mapping ก่อนจึงจะยืนยันงานนี้ได้',
    manualMode: 'อัปเดตด้วยตนเอง',
    channexMode: 'ระบบเชื่อมต่อที่ได้รับการรับรอง',
    connectionEnabled: 'เปิดใช้งาน',
    connectionDisabled: 'ปิดใช้งาน',
    completeInvalid: 'จำนวนห้องที่ยืนยันต้องเป็นเลขจำนวนเต็มตั้งแต่ 0 ขึ้นไป',
    completing: 'กำลังบันทึก…',
    actionReasonHelp: 'การยกเลิก การแก้ไข และการปฏิเสธต้องมีเหตุผลสำหรับการตรวจสอบย้อนหลัง',
    guestSummary: 'ผู้เข้าพัก',
    staySummary: 'วันเข้าพัก',
    roomSummary: 'ประเภทห้อง',
    amountSummary: 'ยอดเงิน',
    matchedReservation: 'พบการจองที่ตรงกันใน PMS',
    unmatchedReservation: 'ยังไม่พบการจองที่ตรงกันใน PMS',
    selectReservation: 'เลือกการจองใน PMS ที่ตรวจสอบแล้ว',
    noCandidateReservations: 'ไม่พบการจองที่อาจตรงกัน โปรดตรวจสอบเลขอ้างอิงใน OTA Extranet แล้วสร้างหรือค้นหาการจองในหน้าการจองก่อนนำรายการนี้ไปใช้',
    linkRequired: 'เลือกการจองที่คุณตรวจสอบแล้วใน OTA Extranet',
  },
}

type EmailAction = {
  kind: 'approve' | 'reject'
  event: BookingEmailEvent
}

type TaskDraft = {
  revision: number
  availability: string
  notes: string
}

function normalizedProviderCode(value: string | null | undefined) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replaceAll('.', '_')
    .replaceAll('-', '_')
}

function providerLabel(value: string | null | undefined) {
  const provider = normalizedProviderCode(value)
  if (provider === 'booking_com' || provider === 'bookingcom') return 'Booking.com'
  if (provider === 'agoda') return 'Agoda'
  if (provider === 'trip_com' || provider === 'tripcom') return 'Trip.com'
  if (provider === 'little_hotelier' || provider === 'littlehotelier') return 'Little Hotelier'
  return value ? String(value).replaceAll('_', ' ') : 'OTA'
}

const safeProviderDomains: Record<string, string[]> = {
  booking_com: ['booking.com'],
  bookingcom: ['booking.com'],
  agoda: ['agoda.com'],
  trip_com: ['trip.com'],
  tripcom: ['trip.com'],
}

function safeExtranetUrl(value: string | null | undefined, providerCode: string | null | undefined) {
  if (!value) return null
  const allowedDomains = safeProviderDomains[normalizedProviderCode(providerCode)] || []
  if (allowedDomains.length === 0) return null
  try {
    const url = new URL(value)
    const host = url.hostname.toLowerCase().replace(/\.$/, '')
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return null
    if (url.port && url.port !== '443') return null
    if (!allowedDomains.some((domain) => host === domain || host.endsWith(`.${domain}`))) return null
    return url.toString()
  } catch {
    return null
  }
}

function safeSummary(value: string | null | undefined) {
  if (!value) return null
  return String(value)
    .replace(/https?:\/\/\S+/gi, '[link hidden]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email hidden]')
    .replace(/\b(token|password|secret|authorization)\s*[:=]\s*\S+/gi, '$1=[hidden]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180)
}

function formatDateTime(value: string | null | undefined, language: Language) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat(language === 'th' ? 'th-TH' : 'en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function formatCurrencySatang(value: number, currency: string, language: Language) {
  try {
    return new Intl.NumberFormat(language === 'th' ? 'th-TH' : 'en-GB', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
    }).format(value / 100)
  } catch {
    return `${(value / 100).toFixed(2)} ${currency}`
  }
}

function safeErrorMessage(error: unknown, language: Language) {
  const text = deskCopy[language]
  if (error instanceof ApiError) {
    if (error.status === 401) return text.sessionExpired
    if (error.status === 403) return text.forbidden
    if (error.status === 400 || error.status === 422) return text.invalidRequest
    if (error.status === 404 || error.status === 409) return text.changedConflict
    if (error.status === 429 || error.status >= 500) return text.unavailable
  }
  return text.actionFailed
}

function eventCanBeApproved(event: BookingEmailEvent) {
  if (event.eventType === 'NEW_BOOKING') {
    return Boolean(event.channelRef && event.guestName && event.checkIn && event.checkOut && event.roomType)
  }
  if (event.eventType === 'MODIFICATION' || event.eventType === 'CANCELLATION') {
    return Boolean(event.channelRef || (event.guestName && event.checkIn && event.checkOut))
  }
  return false
}

function approvalNeedsReason(event: BookingEmailEvent) {
  return event.eventType !== 'NEW_BOOKING'
}

function HealthBadge({ tone, children }: { tone: 'success' | 'warning' | 'danger' | 'neutral'; children: string }) {
  return <span className={`status status--${tone}`}>{children}</span>
}

function healthState(data: ChannelDeskPayload, text: DeskCopy) {
  const health = data.syncHealth
  const watchExpiry = health.watchExpiresAt ? new Date(health.watchExpiresAt).getTime() : Number.NaN
  const watchRemaining = watchExpiry - Date.now()
  const reconciledAt = health.lastReconciledAt ? new Date(health.lastReconciledAt).getTime() : Number.NaN
  const reconciliationAge = Date.now() - reconciledAt

  return {
    credentials: health.credentialReady
      ? { tone: 'success' as const, label: text.ready }
      : { tone: 'danger' as const, label: text.attention },
    push: !health.enabled
      ? { tone: 'warning' as const, label: text.disabled }
      : health.watchReady
        ? { tone: 'success' as const, label: text.enabled }
        : { tone: 'warning' as const, label: text.attention },
    watch: !health.watchReady || !Number.isFinite(watchExpiry) || watchRemaining <= 0
      ? { tone: 'danger' as const, label: text.attention }
      : watchRemaining <= WATCH_WARNING_MS
        ? { tone: 'warning' as const, label: text.attention }
        : { tone: 'success' as const, label: text.ready },
    reconciliation: !Number.isFinite(reconciledAt)
      ? { tone: 'neutral' as const, label: text.unknown }
      : reconciliationAge <= RECONCILIATION_FRESH_MS
        ? { tone: 'success' as const, label: text.current }
        : { tone: 'warning' as const, label: text.stale },
  }
}

function ReviewEventCard({
  event,
  language,
  text,
  busy,
  openAction,
}: {
  event: BookingEmailEvent
  language: Language
  text: DeskCopy
  busy: boolean
  openAction: (kind: EmailAction['kind'], event: BookingEmailEvent) => void
}) {
  const canApprove = eventCanBeApproved(event)
  const summaryReason = safeSummary(event.reviewReason)

  return (
    <article className="channel-card channel-card--review">
      <header className="channel-card__header">
        <div>
          <strong>{providerLabel(event.providerCode)}</strong>
          <span className="muted">{text.received}: {formatDateTime(event.receivedAt, language)}</span>
        </div>
        <StatusPill value={event.eventType} />
      </header>

      <dl className="detail-grid detail-grid--compact">
        <div><dt>{text.reference}</dt><dd>{event.channelRef || '—'}</dd></div>
        <div><dt>{text.guestSummary}</dt><dd>{event.guestName || '—'}</dd></div>
        <div><dt>{text.staySummary}</dt><dd>{event.checkIn && event.checkOut ? `${formatDate(event.checkIn, language)} → ${formatDate(event.checkOut, language)}` : '—'}</dd></div>
        <div><dt>{text.roomSummary}</dt><dd>{event.roomType || '—'}</dd></div>
        <div><dt>{text.amountSummary}</dt><dd>{event.amountSatang == null ? '—' : formatCurrencySatang(event.amountSatang, event.currency, language)}</dd></div>
        <div><dt>{text.matchedReservation}</dt><dd>{event.reservationId ? text.matchedReservation : text.unmatchedReservation}</dd></div>
      </dl>

      {summaryReason ? <p className="notice notice--subtle">{summaryReason}</p> : null}
      {!canApprove ? <p className="notice notice--warning">{text.incompleteEvent}</p> : null}

      <footer className="channel-card__actions">
        <button className="button" disabled={!canApprove || busy} onClick={() => openAction('approve', event)}>{text.confirmApprove}</button>
        <button className="button button--secondary" disabled={busy} onClick={() => openAction('reject', event)}>{text.confirmReject}</button>
      </footer>
    </article>
  )
}

function ConnectionCard({ connection, text }: { connection: ManualChannelConnection; text: DeskCopy }) {
  const safeUrl = safeExtranetUrl(connection.extranetUrl, connection.providerCode)
  const activeMappings = connection.mappings?.filter((mapping) => mapping.active).length || 0
  return (
    <article className="channel-card channel-card--connection">
      <header className="channel-card__header">
        <div>
          <strong>{connection.displayName || providerLabel(connection.providerCode)}</strong>
          <span className="muted">{connection.deliveryMode === 'CHANNEX' ? text.channexMode : text.manualMode}</span>
        </div>
        <HealthBadge tone={connection.enabled ? 'success' : 'neutral'}>
          {connection.enabled ? text.connectionEnabled : text.connectionDisabled}
        </HealthBadge>
      </header>
      <p className="muted">{activeMappings} {text.mappings}</p>
      {safeUrl ? (
        <a className="button button--secondary" href={safeUrl} target="_blank" rel="noopener noreferrer">{text.openExtranet}</a>
      ) : (
        <span className="muted">{text.unsafeLink}</span>
      )}
    </article>
  )
}

function TaskCard({
  task,
  draft,
  language,
  text,
  pending,
  error,
  updateDraft,
  complete,
}: {
  task: ManualChannelTask
  draft: TaskDraft
  language: Language
  text: DeskCopy
  pending: boolean
  error: string | null
  updateDraft: (patch: Partial<TaskDraft>) => void
  complete: () => void
}) {
  const safeUrl = safeExtranetUrl(task.extranetUrl, task.providerCode)
  return (
    <article className="channel-card channel-card--task">
      <header className="channel-card__header">
        <div>
          <strong>{providerLabel(task.providerCode)} · {task.roomTypeName || task.roomTypeId}</strong>
          <span className="muted">{text.taskDate}: {formatDate(task.stayDate, language)} · {text.revision} {task.revision}</span>
        </div>
        <StatusPill value={task.status} />
      </header>

      <div className="availability-target">
        <span>{text.desiredAvailability}</span>
        <strong>{task.desiredAvailability}</strong>
      </div>

      <div className="detail-list">
        <div><span>{text.externalRoomType}</span><strong>{task.externalRoomTypeName || '—'}</strong></div>
        <div><span>{text.externalRoomTypeId}</span><strong>{task.externalRoomTypeId || '—'}</strong></div>
        <div><span>{text.externalRatePlanId}</span><strong>{task.externalRatePlanId || '—'}</strong></div>
      </div>
      {!task.externalRoomTypeId ? <p className="notice notice--warning">{text.mappingMissing}</p> : null}

      <div className="task-form-grid">
        <label className="field">
          <span>{text.confirmedAvailability}</span>
          <input
            type="number"
            min="0"
            step="1"
            inputMode="numeric"
            value={draft.availability}
            onChange={(event) => updateDraft({ availability: event.target.value })}
          />
        </label>
        <label className="field">
          <span>{text.completionNotes}</span>
          <input
            type="text"
            maxLength={240}
            placeholder={text.notesPlaceholder}
            value={draft.notes}
            onChange={(event) => updateDraft({ notes: event.target.value })}
          />
        </label>
      </div>

      {error ? <p className="notice notice--error" role="alert">{error}</p> : null}
      <footer className="channel-card__actions">
        {safeUrl ? (
          <a className="button button--secondary" href={safeUrl} target="_blank" rel="noopener noreferrer">{text.openExtranet}</a>
        ) : (
          <span className="muted">{text.unsafeLink}</span>
        )}
        <button className="button" disabled={pending || !task.externalRoomTypeId} onClick={complete}>{pending ? text.completing : text.markComplete}</button>
      </footer>
    </article>
  )
}

export function ChannelDeskView() {
  const { language, t } = useI18n()
  const text = deskCopy[language]
  const queryClient = useQueryClient()
  const [emailAction, setEmailAction] = useState<EmailAction | null>(null)
  const [selectedReservationId, setSelectedReservationId] = useState('')
  const [actionReason, setActionReason] = useState('')
  const [actionError, setActionError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [taskDrafts, setTaskDrafts] = useState<Record<string, TaskDraft>>({})
  const [taskErrors, setTaskErrors] = useState<Record<string, string>>({})

  const deskQuery = useQuery({
    queryKey: ['lite', 'channel-desk'],
    queryFn: liteApi.channelDesk,
    refetchInterval: POLL_INTERVAL_MS,
    refetchIntervalInBackground: true,
  })

  const candidateQueryText = emailAction?.event.channelRef || emailAction?.event.guestName || ''
  const reservationCandidates = useQuery({
    queryKey: ['lite', 'channel-link-candidates', candidateQueryText],
    queryFn: () => liteApi.bookings({ query: candidateQueryText, limit: 10 }),
    enabled: Boolean(emailAction?.kind === 'approve' && !emailAction.event.reservationId && candidateQueryText),
    staleTime: 15_000,
  })

  const emailMutation = useMutation({
    mutationFn: async ({ kind, event, reason, reservationId }: EmailAction & { reason: string; reservationId?: string }) => {
      if (kind === 'reject') return liteApi.rejectEmailEvent(event.id, reason)
      const linkedReservationId = reservationId || event.reservationId || undefined
      const mode = event.eventType === 'NEW_BOOKING'
        ? linkedReservationId ? 'link_reservation' : 'create_reservation'
        : 'apply_parsed'
      return liteApi.approveEmailEvent(event.id, {
        mode,
        reservationId: linkedReservationId,
        reason: reason || undefined,
      })
    },
    onSuccess: async () => {
      setEmailAction(null)
      setSelectedReservationId('')
      setActionReason('')
      setActionError(null)
      setSuccessMessage(text.actionSaved)
      await queryClient.invalidateQueries({ queryKey: ['lite'] })
    },
    onError: async (error) => {
      setActionError(safeErrorMessage(error, language))
      if (error instanceof ApiError && (error.status === 404 || error.status === 409)) {
        await queryClient.invalidateQueries({ queryKey: ['lite', 'channel-desk'] })
      }
    },
  })

  const completeTaskMutation = useMutation({
    mutationFn: async ({ task, confirmedAvailability, completionNotes }: {
      task: ManualChannelTask
      confirmedAvailability: number
      completionNotes?: string
    }) => liteApi.completeChannelTask(task.id, task.revision, confirmedAvailability, completionNotes),
    onSuccess: async (_result, variables) => {
      setTaskErrors((current) => {
        const next = { ...current }
        delete next[variables.task.id]
        return next
      })
      setSuccessMessage(text.actionSaved)
      await queryClient.invalidateQueries({ queryKey: ['lite'] })
    },
    onError: async (error, variables) => {
      setTaskErrors((current) => ({ ...current, [variables.task.id]: safeErrorMessage(error, language) }))
      if (error instanceof ApiError && (error.status === 404 || error.status === 409)) {
        await queryClient.invalidateQueries({ queryKey: ['lite', 'channel-desk'] })
      }
    },
  })

  useEffect(() => {
    const tasks = deskQuery.data?.tasks || []
    setTaskDrafts((current) => {
      const next: Record<string, TaskDraft> = {}
      for (const task of tasks) {
        const existing = current[task.id]
        next[task.id] = existing?.revision === task.revision
          ? existing
          : {
              revision: task.revision,
              availability: String(task.confirmedAvailability ?? task.desiredAvailability),
              notes: task.completionNotes || '',
            }
      }
      return next
    })
  }, [deskQuery.data?.tasks])

  const actionableTasks = useMemo(
    () => (deskQuery.data?.tasks || []).filter((task) => task.status === 'PENDING'),
    [deskQuery.data?.tasks],
  )
  const reviewEvents = useMemo(
    () => (deskQuery.data?.reviewEvents || []).filter((event) => event.status === 'NEEDS_REVIEW' && ['NEW_BOOKING', 'MODIFICATION', 'CANCELLATION'].includes(event.eventType)),
    [deskQuery.data?.reviewEvents],
  )
  const enabledConnections = deskQuery.data?.connections.filter((connection) => connection.enabled).length || 0

  function openEmailAction(kind: EmailAction['kind'], event: BookingEmailEvent) {
    setEmailAction({ kind, event })
    setSelectedReservationId(event.reservationId || '')
    setActionReason('')
    setActionError(null)
    setSuccessMessage(null)
  }

  function submitEmailAction() {
    if (!emailAction) return
    const reason = actionReason.trim()
    const requiresReason = emailAction.kind === 'reject' || approvalNeedsReason(emailAction.event)
    if (requiresReason && reason.length < MIN_REASON_LENGTH) {
      setActionError(text.reasonRequired)
      return
    }
    if (
      emailAction.kind === 'approve' &&
      (
        ['MODIFICATION', 'CANCELLATION'].includes(emailAction.event.eventType) ||
        (emailAction.event.eventType === 'NEW_BOOKING' && /possible duplicate/i.test(emailAction.event.reviewReason || ''))
      ) &&
      !(selectedReservationId || emailAction.event.reservationId)
    ) {
      setActionError(text.linkRequired)
      return
    }
    setActionError(null)
    emailMutation.mutate({ ...emailAction, reason, reservationId: selectedReservationId || undefined })
  }

  function completeTask(task: ManualChannelTask) {
    const draft = taskDrafts[task.id] || {
      revision: task.revision,
      availability: String(task.desiredAvailability),
      notes: '',
    }
    const confirmedAvailability = Number(draft.availability)
    if (!Number.isSafeInteger(confirmedAvailability) || confirmedAvailability < 0) {
      setTaskErrors((current) => ({ ...current, [task.id]: text.completeInvalid }))
      return
    }
    if (draft.notes.trim().length < MIN_REASON_LENGTH) {
      setTaskErrors((current) => ({ ...current, [task.id]: text.reasonRequired }))
      return
    }
    setTaskErrors((current) => {
      const next = { ...current }
      delete next[task.id]
      return next
    })
    setSuccessMessage(null)
    completeTaskMutation.mutate({
      task,
      confirmedAvailability,
      completionNotes: draft.notes.trim(),
    })
  }

  if (deskQuery.isLoading) return <LoadingBlock />
  if (!deskQuery.data) {
    return (
      <div className="state-card state-card--error" role="alert">
        <strong>{safeErrorMessage(deskQuery.error, language)}</strong>
        <button className="button button--secondary" onClick={() => void deskQuery.refetch()}>{t('retry')}</button>
      </div>
    )
  }

  const data = deskQuery.data
  const health = healthState(data, text)

  return (
    <main className="page channel-desk">
      <header className="page-header">
        <div>
          <h1>{text.title}</h1>
          <p>{text.subtitle}</p>
        </div>
        <div className="page-actions">
          <span className="muted">{text.refreshed}: {formatDateTime(new Date(deskQuery.dataUpdatedAt).toISOString(), language)}</span>
          <button className="button button--secondary" disabled={deskQuery.isFetching} onClick={() => void deskQuery.refetch()}>{t('refresh')}</button>
        </div>
      </header>

      <section className="warning-banner" role="alert">
        <strong>{t('manualWarning')}</strong>
        <span>{t('noLiveSync')}</span>
      </section>

      {deskQuery.error ? <p className="notice notice--error" role="alert">{text.refreshFailed}</p> : null}
      {successMessage ? <p className="notice notice--success" role="status">{successMessage}</p> : null}
      {(data.counts.parserErrors || 0) > 0 ? <p className="notice notice--error" role="alert"><strong>{data.counts.parserErrors}</strong> {text.parserErrors}</p> : null}
      {(data.counts.failedTasks || 0) > 0 ? <p className="notice notice--error" role="alert"><strong>{data.counts.failedTasks}</strong> {text.failedTasks}</p> : null}

      <section className="stats-grid" aria-label={text.title}>
        <StatCard label={text.reviewCount} value={reviewEvents.length} tone={reviewEvents.length > 0 ? 'warning' : 'success'} />
        <StatCard label={text.taskCount} value={actionableTasks.length} tone={actionableTasks.length > 0 ? 'warning' : 'success'} />
        <StatCard label={text.activeConnections} value={enabledConnections} />
        <StatCard label={text.pendingDeliveries} value={data.syncHealth.pendingDeliveries || 0} tone={(data.syncHealth.pendingDeliveries || 0) > 0 ? 'warning' : 'success'} />
      </section>

      <section className="panel" aria-labelledby="sync-health-title">
        <header className="panel__header">
          <div>
            <h2 id="sync-health-title">{t('syncHealth')}</h2>
            <p>{text.reviewHelp}</p>
          </div>
        </header>
        <div className="health-grid">
          <article className="health-card">
            <span>{text.credentials}</span>
            <HealthBadge tone={health.credentials.tone}>{health.credentials.label}</HealthBadge>
          </article>
          <article className="health-card">
            <span>{text.pushDelivery}</span>
            <HealthBadge tone={health.push.tone}>{health.push.label}</HealthBadge>
            <small>{text.lastPush}: {formatDateTime(data.syncHealth.lastPushAt, language)}</small>
          </article>
          <article className="health-card">
            <span>{t('watchExpires')}</span>
            <HealthBadge tone={health.watch.tone}>{health.watch.label}</HealthBadge>
            <small>{formatDateTime(data.syncHealth.watchExpiresAt, language)}</small>
          </article>
          <article className="health-card">
            <span>{text.reconciliation}</span>
            <HealthBadge tone={health.reconciliation.tone}>{health.reconciliation.label}</HealthBadge>
            <small>{text.lastReconciled}: {formatDateTime(data.syncHealth.lastReconciledAt || data.syncHealth.lastSyncAt, language)}</small>
          </article>
        </div>
        {data.syncHealth.lastError ? <p className="notice notice--error" role="alert">{text.mailboxIssue}</p> : null}
      </section>

      <section className="panel" aria-labelledby="review-inbox-title">
        <header className="panel__header">
          <div>
            <h2 id="review-inbox-title">{t('reviewInbox')}</h2>
            <p>{text.reviewHelp}</p>
          </div>
          <strong>{reviewEvents.length}</strong>
        </header>
        {reviewEvents.length === 0 ? (
          <EmptyBlock>{text.noReviewEvents}</EmptyBlock>
        ) : (
          <div className="channel-card-grid">
            {reviewEvents.map((event) => (
              <ReviewEventCard
                key={event.id}
                event={event}
                language={language}
                text={text}
                busy={emailMutation.isPending}
                openAction={openEmailAction}
              />
            ))}
          </div>
        )}
      </section>

      <section className="panel" aria-labelledby="availability-queue-title">
        <header className="panel__header">
          <div>
            <h2 id="availability-queue-title">{t('availabilityQueue')}</h2>
            <p>{text.availabilityHelp}</p>
          </div>
          <strong>{actionableTasks.length}</strong>
        </header>
        {actionableTasks.length === 0 ? (
          <EmptyBlock>{text.noAvailabilityTasks}</EmptyBlock>
        ) : (
          <div className="channel-card-grid">
            {actionableTasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                draft={taskDrafts[task.id] || { revision: task.revision, availability: String(task.desiredAvailability), notes: '' }}
                language={language}
                text={text}
                pending={completeTaskMutation.isPending && completeTaskMutation.variables?.task.id === task.id}
                error={taskErrors[task.id] || null}
                updateDraft={(patch) => setTaskDrafts((current) => ({
                  ...current,
                  [task.id]: {
                    ...(current[task.id] || { revision: task.revision, availability: String(task.desiredAvailability), notes: '' }),
                    ...patch,
                  },
                }))}
                complete={() => completeTask(task)}
              />
            ))}
          </div>
        )}
      </section>

      <section className="panel" aria-labelledby="connections-title">
        <header className="panel__header">
          <div>
            <h2 id="connections-title">{t('connections')}</h2>
            <p>{text.connectionHelp}</p>
          </div>
        </header>
        {data.connections.length === 0 ? (
          <EmptyBlock>{text.noConnections}</EmptyBlock>
        ) : (
          <div className="channel-card-grid channel-card-grid--connections">
            {data.connections.map((connection) => <ConnectionCard key={connection.id} connection={connection} text={text} />)}
          </div>
        )}
      </section>

      {emailAction ? (
        <Modal
          title={emailAction.kind === 'approve' ? text.approveTitle : text.rejectTitle}
          close={() => !emailMutation.isPending && setEmailAction(null)}
        >
          <div className="modal__body">
            <div className="review-action-summary">
              <strong>{providerLabel(emailAction.event.providerCode)} · {emailAction.event.channelRef || '—'}</strong>
              <StatusPill value={emailAction.event.eventType} />
            </div>
            {emailAction.kind === 'approve' && !emailAction.event.reservationId ? (
              <label className="field">
                <span>{text.selectReservation}</span>
                <select
                  value={selectedReservationId}
                  disabled={reservationCandidates.isLoading}
                  onChange={(event) => setSelectedReservationId(event.target.value)}
                >
                  <option value="">{reservationCandidates.isLoading ? text.completing : text.unmatchedReservation}</option>
                  {reservationCandidates.data?.items.map((reservation) => (
                    <option key={reservation.id} value={reservation.id}>
                      {reservation.confirmationCode} · {reservation.guest.displayName} · {reservation.checkIn.slice(0, 10)} → {reservation.checkOut.slice(0, 10)}
                    </option>
                  ))}
                </select>
                {!reservationCandidates.isLoading && reservationCandidates.data?.items.length === 0
                  ? <small className="inline-error">{text.noCandidateReservations}</small>
                  : null}
              </label>
            ) : null}
            <p>{text.actionReasonHelp}</p>
            <label className="field">
              <span>{text.reason}{emailAction.kind === 'reject' || approvalNeedsReason(emailAction.event) ? ' *' : ''}</span>
              <textarea
                rows={4}
                maxLength={500}
                autoFocus
                placeholder={text.reasonPlaceholder}
                value={actionReason}
                onChange={(event) => setActionReason(event.target.value)}
              />
            </label>
            {actionError ? <p className="notice notice--error" role="alert">{actionError}</p> : null}
          </div>
          <footer className="modal__footer">
            <button className="button button--secondary" disabled={emailMutation.isPending} onClick={() => setEmailAction(null)}>{t('close')}</button>
            <button className="button" disabled={emailMutation.isPending} onClick={submitEmailAction}>
              {emailMutation.isPending ? text.completing : emailAction.kind === 'approve' ? text.confirmApprove : text.confirmReject}
            </button>
          </footer>
        </Modal>
      ) : null}
    </main>
  )
}

export default ChannelDeskView
