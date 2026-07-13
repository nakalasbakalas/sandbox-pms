import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { ApiError, liteApi } from '../api'
import { EmptyBlock, LoadingBlock, Modal, StatCard, StatusPill, formatDate } from '../components'
import { useI18n } from '../i18n'
import type {
  BookingEmailEvent,
  ChannelDeskPayload,
  Language,
  LiteRole,
  ManualChannelConnection,
  ManualChannelProviderCode,
  ManualChannelRoomType,
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
  reprocess: string
  reprocessSaved: string
  parserRecovery: string
  incompleteEvent: string
  reviewCount: string
  taskCount: string
  activeConnections: string
  taskDate: string
  taskCreated: string
  taskAge: string
  taskAgeUnknown: string
  pendingTaskRisk: string
  failedTaskEscalation: string
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
  configure: string
  configurationTitle: string
  configurationIntro: string
  externalPropertyId: string
  extranetUrl: string
  officialUrlHelp: string
  officialUrlRequired: string
  officialUrlInvalid: string
  enableAfterSave: string
  enableAfterSaveHelp: string
  initialReconcileDays: string
  initialReconcileDaysHelp: string
  initialReconcileDaysInvalid: string
  externalRoomTypeName: string
  mappingCoverage: string
  physicalRooms: string
  saveConfiguration: string
  configurationSaved: string
  configurationFailedDisabled: string
  mappingRequired: string
  noPhysicalRoomTypes: string
  credentialsProhibited: string
  managerOnly: string
  reconcile: string
  reconcileTitle: string
  reconcileIntro: string
  fromDate: string
  throughDate: string
  rangeHelp: string
  runReconciliation: string
  reconciliationSaved: string
  rangeInvalid: string
  rangeTooLong: string
  setupReasonPlaceholder: string
  reconcileReasonPlaceholder: string
  retryTask: string
  retryTitle: string
  retryIntro: string
  retrySaved: string
  retryReasonPlaceholder: string
  failedQueue: string
  noFailedTasks: string
  returnedOfTotal: string
  listTruncated: string
  immutableTarget: string
  lastFailure: string
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
    parserErrors: 'email events could not be parsed and are visible below for recovery.',
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
    reprocess: 'Retry parsing',
    reprocessSaved: 'The email was reparsed and its current review state was confirmed by the server.',
    parserRecovery: 'Parsing failed. No booking changed. Retry parsing or reject the event with an operational reason.',
    incompleteEvent: 'Required booking details or an exact reservation reference are missing. Review or reject this event instead of applying it.',
    reviewCount: 'Awaiting review',
    taskCount: 'Availability tasks',
    activeConnections: 'Enabled connections',
    taskDate: 'Stay date',
    taskCreated: 'Created',
    taskAge: 'Open for',
    taskAgeUnknown: 'Age unavailable',
    pendingTaskRisk: 'This manual OTA update is still open. Complete it promptly; the Extranet may differ until staff confirm the task.',
    failedTaskEscalation: 'Escalate now to a manager. Reconcile this failed task before treating OTA inventory as current.',
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
    configure: 'Configure',
    configurationTitle: 'Configure manual OTA connection',
    configurationIntro: 'The connection is saved disabled first. Every physical room type is then mapped before the connection can be enabled.',
    externalPropertyId: 'OTA property ID (optional)',
    extranetUrl: 'Official Extranet URL',
    officialUrlHelp: 'Use the official HTTPS Extranet domain only; links with credentials, query parameters, or fragments are refused.',
    officialUrlRequired: 'Enter an official {domain} HTTPS Extranet URL before enabling this connection.',
    officialUrlInvalid: 'This is not a safe official {domain} Extranet URL.',
    enableAfterSave: 'Enable after all mappings save',
    enableAfterSaveHelp: 'If any mapping or initial availability staging fails, the provider remains disabled and no success is assumed.',
    initialReconcileDays: 'Initial availability horizon',
    initialReconcileDaysHelp: 'Enabling stages absolute availability tasks from today through this many stay dates (1–90).',
    initialReconcileDaysInvalid: 'Initial availability must cover 1 to 90 stay dates.',
    externalRoomTypeName: 'OTA room type name',
    mappingCoverage: 'Mapping coverage',
    physicalRooms: 'physical rooms',
    saveConfiguration: 'Save setup',
    configurationSaved: 'Connection and mappings were confirmed. When enabled, its initial availability tasks were staged in the same transaction.',
    configurationFailedDisabled: 'Setup did not finish. The connection was left disabled for safety.',
    mappingRequired: 'Enter the verified OTA room ID and OTA room name for every physical PMS room type.',
    noPhysicalRoomTypes: 'No physical room types are available to map. Add rooms before enabling an OTA connection.',
    credentialsProhibited: 'Never enter an OTA password, cookie, token, API key, or 2FA code. This form stores no credentials.',
    managerOnly: 'Connection setup, reconciliation, and task recovery are available only to managers and administrators.',
    reconcile: 'Reconcile queue',
    reconcileTitle: 'Recalculate availability tasks',
    reconcileIntro: 'Recalculate absolute PMS availability for every physical room type across a bounded future stay-date range.',
    fromDate: 'First stay date',
    throughDate: 'Last stay date',
    rangeHelp: 'Choose 1 to 90 stay dates. The end date is included.',
    runReconciliation: 'Run reconciliation',
    reconciliationSaved: 'Availability tasks were recalculated and confirmed by the server.',
    rangeInvalid: 'The last stay date must be on or after the first stay date.',
    rangeTooLong: 'Reconciliation is limited to 90 stay dates.',
    setupReasonPlaceholder: 'Why this provider setup or mapping is being changed',
    reconcileReasonPlaceholder: 'Why this availability range is being reconciled',
    retryTask: 'Retry task',
    retryTitle: 'Retry failed availability task',
    retryIntro: 'The failed revision will be superseded and a new pending revision will snapshot the current OTA mapping.',
    retrySaved: 'A new pending task revision was confirmed by the server.',
    retryReasonPlaceholder: 'What was checked or corrected before retrying',
    failedQueue: 'Failed task recovery',
    noFailedTasks: 'No failed availability task requires recovery.',
    returnedOfTotal: '{returned} shown of {total}',
    listTruncated: 'This list is truncated. The totals include all matching work; resolve the visible oldest work or refresh after changes.',
    immutableTarget: 'This task keeps the OTA room/rate target captured for this revision.',
    lastFailure: 'Last failure',
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
    parserErrors: 'อีเมลไม่สามารถแยกข้อมูลได้ และแสดงด้านล่างเพื่อดำเนินการแก้ไข',
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
    reprocess: 'ลองแยกข้อมูลอีกครั้ง',
    reprocessSaved: 'เซิร์ฟเวอร์ยืนยันการแยกข้อมูลใหม่และสถานะตรวจสอบปัจจุบันแล้ว',
    parserRecovery: 'การแยกข้อมูลล้มเหลวและยังไม่มีการเปลี่ยนแปลงการจอง โปรดลองอีกครั้งหรือปฏิเสธพร้อมระบุเหตุผล',
    incompleteEvent: 'ข้อมูลการจองหรือเลขอ้างอิงที่ตรงกันยังไม่ครบ กรุณาตรวจสอบหรือปฏิเสธแทนการนำไปใช้',
    reviewCount: 'รอตรวจสอบ',
    taskCount: 'งานอัปเดตห้องว่าง',
    activeConnections: 'ช่องทางที่เปิดใช้',
    taskDate: 'วันที่เข้าพัก',
    taskCreated: 'สร้างเมื่อ',
    taskAge: 'เปิดค้างมาแล้ว',
    taskAgeUnknown: 'ไม่ทราบอายุงาน',
    pendingTaskRisk: 'งานอัปเดต OTA แบบดำเนินการเองนี้ยังเปิดอยู่ โปรดดำเนินการโดยเร็ว เพราะข้อมูลใน Extranet อาจต่างจาก PMS จนกว่าพนักงานจะยืนยันงาน',
    failedTaskEscalation: 'แจ้งผู้จัดการทันที โปรดตรวจสอบและสร้างงานนี้ใหม่ก่อนถือว่าจำนวนห้องใน OTA เป็นปัจจุบัน',
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
    configure: 'ตั้งค่า',
    configurationTitle: 'ตั้งค่าการเชื่อมต่อ OTA แบบดำเนินการเอง',
    configurationIntro: 'ระบบจะบันทึกช่องทางเป็นปิดใช้งานก่อน จากนั้นจึงบันทึก mapping ของห้องจริงทุกประเภท และเปิดใช้งานได้เมื่อข้อมูลครบเท่านั้น',
    externalPropertyId: 'รหัสที่พักใน OTA (ไม่บังคับ)',
    extranetUrl: 'URL Extranet อย่างเป็นทางการ',
    officialUrlHelp: 'ใช้เฉพาะโดเมน Extranet แบบ HTTPS อย่างเป็นทางการ ระบบจะปฏิเสธลิงก์ที่มีรหัสผ่าน พารามิเตอร์ หรือ fragment',
    officialUrlRequired: 'กรุณาระบุ URL Extranet แบบ HTTPS ของ {domain} ก่อนเปิดใช้งานช่องทางนี้',
    officialUrlInvalid: 'URL นี้ไม่ใช่ Extranet อย่างเป็นทางการและปลอดภัยของ {domain}',
    enableAfterSave: 'เปิดใช้งานหลังบันทึก mapping ครบ',
    enableAfterSaveHelp: 'หาก mapping หรือการสร้างงานห้องว่างเริ่มต้นไม่สำเร็จ ช่องทางจะยังคงปิดเพื่อความปลอดภัย และระบบจะไม่ถือว่าสำเร็จ',
    initialReconcileDays: 'ช่วงวันห้องว่างเริ่มต้น',
    initialReconcileDaysHelp: 'เมื่อเปิดใช้งาน ระบบจะสร้างงานจำนวนห้องว่างจริงตั้งแต่วันนี้ตามจำนวนวันเข้าพักนี้ (1–90 วัน)',
    initialReconcileDaysInvalid: 'ช่วงวันห้องว่างเริ่มต้นต้องอยู่ระหว่าง 1 ถึง 90 วันเข้าพัก',
    externalRoomTypeName: 'ชื่อประเภทห้องใน OTA',
    mappingCoverage: 'ความครบถ้วนของ mapping',
    physicalRooms: 'ห้องจริง',
    saveConfiguration: 'บันทึกการตั้งค่า',
    configurationSaved: 'เซิร์ฟเวอร์ยืนยันการเชื่อมต่อและ mapping แล้ว หากเปิดใช้งาน ระบบจะสร้างงานห้องว่างเริ่มต้นใน transaction เดียวกัน',
    configurationFailedDisabled: 'การตั้งค่ายังไม่เสร็จ ระบบคงช่องทางไว้เป็นปิดใช้งานเพื่อความปลอดภัย',
    mappingRequired: 'กรอกรหัสห้องและชื่อห้องใน OTA ที่ตรวจสอบแล้วสำหรับประเภทห้องจริงทุกประเภทใน PMS',
    noPhysicalRoomTypes: 'ไม่มีประเภทห้องจริงสำหรับทำ mapping กรุณาเพิ่มห้องก่อนเปิดใช้งาน OTA',
    credentialsProhibited: 'ห้ามกรอกรหัสผ่าน คุกกี้ โทเคน API key หรือรหัส 2FA ของ OTA แบบฟอร์มนี้ไม่จัดเก็บข้อมูลเข้าสู่ระบบ',
    managerOnly: 'เฉพาะผู้จัดการและผู้ดูแลระบบเท่านั้นที่ตั้งค่าช่องทาง ตรวจสอบคิว และกู้งานได้',
    reconcile: 'ตรวจสอบคิวใหม่',
    reconcileTitle: 'คำนวณงานอัปเดตห้องว่างใหม่',
    reconcileIntro: 'คำนวณจำนวนห้องว่างจริงจาก PMS สำหรับประเภทห้องจริงทุกประเภทในช่วงวันที่เข้าพักที่จำกัด',
    fromDate: 'วันที่เข้าพักวันแรก',
    throughDate: 'วันที่เข้าพักวันสุดท้าย',
    rangeHelp: 'เลือก 1 ถึง 90 วันเข้าพัก โดยรวมวันสุดท้ายด้วย',
    runReconciliation: 'เริ่มตรวจสอบคิวใหม่',
    reconciliationSaved: 'เซิร์ฟเวอร์ยืนยันการคำนวณงานอัปเดตห้องว่างใหม่แล้ว',
    rangeInvalid: 'วันที่เข้าพักวันสุดท้ายต้องไม่น้อยกว่าวันแรก',
    rangeTooLong: 'ตรวจสอบคิวได้สูงสุด 90 วันเข้าพัก',
    setupReasonPlaceholder: 'เหตุผลที่เปลี่ยนการตั้งค่าช่องทางหรือ mapping นี้',
    reconcileReasonPlaceholder: 'เหตุผลที่ตรวจสอบจำนวนห้องว่างในช่วงวันนี้ใหม่',
    retryTask: 'ลองงานอีกครั้ง',
    retryTitle: 'ลองงานอัปเดตห้องว่างที่ล้มเหลวอีกครั้ง',
    retryIntro: 'ระบบจะยกเลิก revision ที่ล้มเหลวและสร้าง revision ใหม่ที่บันทึกเป้าหมายห้อง/แผนราคา OTA ปัจจุบัน',
    retrySaved: 'เซิร์ฟเวอร์ยืนยันงาน revision ใหม่ที่รอดำเนินการแล้ว',
    retryReasonPlaceholder: 'ตรวจสอบหรือแก้ไขสิ่งใดก่อนลองอีกครั้ง',
    failedQueue: 'กู้งานที่ล้มเหลว',
    noFailedTasks: 'ไม่มีงานอัปเดตห้องว่างที่ล้มเหลวและต้องกู้',
    returnedOfTotal: 'แสดง {returned} จากทั้งหมด {total}',
    listTruncated: 'รายการนี้ถูกจำกัดจำนวน ยอดรวมครอบคลุมงานที่ตรงเงื่อนไขทั้งหมด โปรดจัดการรายการเก่าที่แสดงอยู่หรือรีเฟรชหลังเปลี่ยนแปลง',
    immutableTarget: 'งานนี้ใช้เป้าหมายห้อง/แผนราคา OTA ที่บันทึกไว้สำหรับ revision นี้',
    lastFailure: 'ข้อผิดพลาดล่าสุด',
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

type MappingDraft = {
  externalRoomTypeId: string
  externalRoomTypeName: string
  externalRatePlanId: string
}

type ConnectionDraft = {
  externalPropertyId: string
  extranetUrl: string
  enableAfterSave: boolean
  initialReconcileDays: number
  reason: string
  mappings: Record<string, MappingDraft>
}

class ConnectionSetupFailure extends Error {
  causeError: unknown
  safelyDisabled: boolean

  constructor(causeError: unknown, safelyDisabled: boolean) {
    super('Manual channel setup failed.')
    this.name = 'ConnectionSetupFailure'
    this.causeError = causeError
    this.safelyDisabled = safelyDisabled
  }
}

function dateKeyInBangkok() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

function addDateKey(value: string, days: number) {
  const date = new Date(`${value}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function inclusiveDateCount(from: string, through: string) {
  const start = new Date(`${from}T00:00:00.000Z`).getTime()
  const end = new Date(`${through}T00:00:00.000Z`).getTime()
  if (!Number.isFinite(start) || !Number.isFinite(end)) return Number.NaN
  return Math.floor((end - start) / 86_400_000) + 1
}

function copyWithCounts(template: string, returned: number, total: number) {
  return template.replace('{returned}', String(returned)).replace('{total}', String(total))
}

function initialConnectionDraft(connection: ManualChannelConnection, roomTypes: ManualChannelRoomType[]): ConnectionDraft {
  const mappings: Record<string, MappingDraft> = {}
  for (const roomType of roomTypes) {
    const mapping = connection.mappings.find((candidate) => candidate.roomTypeId === roomType.id)
    mappings[roomType.id] = {
      externalRoomTypeId: mapping?.externalRoomTypeId || '',
      externalRoomTypeName: mapping?.externalRoomTypeName || '',
      externalRatePlanId: mapping?.externalRatePlanId || '',
    }
  }
  return {
    externalPropertyId: connection.externalPropertyId || '',
    extranetUrl: connection.extranetUrl || '',
    enableAfterSave: connection.enabled || connection.mappings.length === 0,
    initialReconcileDays: 90,
    reason: '',
    mappings,
  }
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

function officialProviderDomain(providerCode: string | null | undefined) {
  return safeProviderDomains[normalizedProviderCode(providerCode)]?.[0] || providerLabel(providerCode)
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

function formatTaskAge(ageMinutes: number | null, language: Language, unknownLabel: string) {
  if (ageMinutes === null || !Number.isSafeInteger(ageMinutes) || ageMinutes < 0) return unknownLabel
  if (ageMinutes < 1) return language === 'th' ? 'น้อยกว่า 1 นาที' : 'less than 1 min'
  if (ageMinutes < 60) return language === 'th' ? `${ageMinutes} นาที` : `${ageMinutes} min`
  if (ageMinutes < 1_440) {
    const hours = Math.floor(ageMinutes / 60)
    const minutes = ageMinutes % 60
    return language === 'th' ? `${hours} ชม. ${minutes} นาที` : `${hours}h ${minutes}m`
  }
  const days = Math.floor(ageMinutes / 1_440)
  const hours = Math.floor((ageMinutes % 1_440) / 60)
  return language === 'th' ? `${days} วัน ${hours} ชม.` : `${days}d ${hours}h`
}

function formatCurrencySatang(value: number, currency: string | null, language: Language) {
  if (!currency) {
    const amount = new Intl.NumberFormat(language === 'th' ? 'th-TH' : 'en-GB', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value / 100)
    return `${amount} (${language === 'th' ? 'ไม่ทราบสกุลเงิน' : 'currency unknown'})`
  }
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
  if (event.eventType === 'PAYMENT_NOTICE') {
    return Boolean(
      event.amountSatang !== null
      && event.currency
      && (event.reservationId || event.channelRef || (event.guestName && event.checkIn && event.checkOut)),
    )
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
  canApply,
  openAction,
  reprocess,
}: {
  event: BookingEmailEvent
  language: Language
  text: DeskCopy
  busy: boolean
  canApply: boolean
  openAction: (kind: EmailAction['kind'], event: BookingEmailEvent) => void
  reprocess: (event: BookingEmailEvent) => void
}) {
  const parserError = event.status === 'ERROR'
  const canApprove = canApply && eventCanBeApproved(event)
  const summaryReason = safeSummary(parserError ? event.errorReason : event.reviewReason)

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
      {parserError ? <p className="notice notice--warning">{text.parserRecovery}</p> : !canApply ? <p className="notice notice--warning">{text.forbidden}</p> : !canApprove ? <p className="notice notice--warning">{text.incompleteEvent}</p> : null}

      <footer className="channel-card__actions">
        {parserError
          ? <button className="button" disabled={busy} onClick={() => reprocess(event)}>{text.reprocess}</button>
          : <button className="button" disabled={!canApprove || busy} onClick={() => openAction('approve', event)}>{text.confirmApprove}</button>}
        <button className="button button--secondary" disabled={busy} onClick={() => openAction('reject', event)}>{text.confirmReject}</button>
      </footer>
    </article>
  )
}

function ConnectionCard({
  connection,
  text,
  physicalRoomTypeCount,
  canManage,
  configure,
}: {
  connection: ManualChannelConnection
  text: DeskCopy
  physicalRoomTypeCount: number
  canManage: boolean
  configure: () => void
}) {
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
      <p className="muted">{text.mappingCoverage}: {activeMappings}/{physicalRoomTypeCount} · {text.physicalRooms}</p>
      <footer className="channel-card__actions">
        {safeUrl ? (
          <a className="button button--secondary" href={safeUrl} target="_blank" rel="noopener noreferrer">{text.openExtranet}</a>
        ) : (
          <span className="muted">{text.unsafeLink}</span>
        )}
        {canManage ? <button className="button" onClick={configure}>{text.configure}</button> : null}
      </footer>
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
          <span className="muted">{text.taskAge}: {formatTaskAge(task.ageMinutes, language, text.taskAgeUnknown)} · {text.taskCreated}: {formatDateTime(task.createdAt, language)}</span>
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
      <p className="notice notice--subtle">{text.immutableTarget}</p>
      <p className="notice notice--warning">{text.pendingTaskRisk}</p>
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

function FailedTaskCard({
  task,
  language,
  text,
  canManage,
  retry,
}: {
  task: ManualChannelTask
  language: Language
  text: DeskCopy
  canManage: boolean
  retry: () => void
}) {
  const safeUrl = safeExtranetUrl(task.extranetUrl, task.providerCode)
  return (
    <article className="channel-card channel-card--task channel-card--failed">
      <header className="channel-card__header">
        <div>
          <strong>{providerLabel(task.providerCode)} · {task.roomTypeName || task.roomTypeId}</strong>
          <span className="muted">{text.taskDate}: {formatDate(task.stayDate, language)} · {text.revision} {task.revision}</span>
          <span className="muted">{text.taskAge}: {formatTaskAge(task.ageMinutes, language, text.taskAgeUnknown)} · {text.taskCreated}: {formatDateTime(task.createdAt, language)}</span>
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
      <p className="notice notice--subtle">{text.immutableTarget}</p>
      <p className="notice notice--error">{text.failedTaskEscalation}</p>
      {task.lastErrorMessage || task.lastErrorCode ? (
        <p className="notice notice--error"><strong>{text.lastFailure}:</strong> {safeSummary(task.lastErrorMessage) || task.lastErrorCode}</p>
      ) : null}
      <footer className="channel-card__actions">
        {safeUrl ? <a className="button button--secondary" href={safeUrl} target="_blank" rel="noopener noreferrer">{text.openExtranet}</a> : null}
        {canManage ? <button className="button" onClick={retry}>{text.retryTask}</button> : null}
      </footer>
    </article>
  )
}

function ConnectionSetupModal({
  connection,
  roomTypes,
  language,
  text,
  closeLabel,
  close,
  saved,
}: {
  connection: ManualChannelConnection
  roomTypes: ManualChannelRoomType[]
  language: Language
  text: DeskCopy
  closeLabel: string
  close: () => void
  saved: () => void
}) {
  const [draft, setDraft] = useState(() => initialConnectionDraft(connection, roomTypes))
  const [error, setError] = useState<string | null>(null)
  const mutation = useMutation({
    mutationFn: async (prepared: {
      reason: string
      extranetUrl: string | null
      mappings: Array<MappingDraft & { roomTypeId: string }>
    }) => {
      let safelyDisabled = !connection.enabled
      const connectionInput = {
        displayName: connection.displayName || providerLabel(connection.providerCode),
        deliveryMode: 'MANUAL' as const,
        externalPropertyId: draft.externalPropertyId.trim() || null,
        extranetUrl: prepared.extranetUrl,
        reason: prepared.reason,
      }
      try {
        const disabled = await liteApi.saveConnection(connection.providerCode, { ...connectionInput, enabled: false })
        safelyDisabled = true
        for (const mapping of prepared.mappings) {
          await liteApi.saveChannelMapping({
            connectionId: disabled.id,
            roomTypeId: mapping.roomTypeId,
            externalRoomTypeId: mapping.externalRoomTypeId,
            externalRoomTypeName: mapping.externalRoomTypeName,
            externalRatePlanId: mapping.externalRatePlanId || null,
            active: true,
            reason: prepared.reason,
          })
        }
        if (!draft.enableAfterSave) return disabled
        return liteApi.saveConnection(connection.providerCode, {
          ...connectionInput,
          enabled: true,
          initialReconcileDays: draft.initialReconcileDays,
        })
      } catch (causeError) {
        throw new ConnectionSetupFailure(causeError, safelyDisabled)
      }
    },
    onSuccess: saved,
    onError: (failure) => {
      if (failure instanceof ConnectionSetupFailure) {
        const detail = safeErrorMessage(failure.causeError, language)
        setError(failure.safelyDisabled ? `${text.configurationFailedDisabled} ${detail}` : detail)
        return
      }
      setError(safeErrorMessage(failure, language))
    },
  })

  function updateMapping(roomTypeId: string, patch: Partial<MappingDraft>) {
    setDraft((current) => ({
      ...current,
      mappings: {
        ...current.mappings,
        [roomTypeId]: { ...current.mappings[roomTypeId], ...patch },
      },
    }))
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    const reason = draft.reason.trim()
    if (reason.length < MIN_REASON_LENGTH) {
      setError(text.reasonRequired)
      return
    }
    if (roomTypes.length === 0) {
      setError(text.noPhysicalRoomTypes)
      return
    }
    const rawUrl = draft.extranetUrl.trim()
    const officialUrl = rawUrl ? safeExtranetUrl(rawUrl, connection.providerCode) : null
    const domain = officialProviderDomain(connection.providerCode)
    if (rawUrl && !officialUrl) {
      setError(text.officialUrlInvalid.replace('{domain}', domain))
      return
    }
    if (draft.enableAfterSave && !officialUrl) {
      setError(text.officialUrlRequired.replace('{domain}', domain))
      return
    }
    if (draft.enableAfterSave
      && (!Number.isInteger(draft.initialReconcileDays)
        || draft.initialReconcileDays < 1
        || draft.initialReconcileDays > 90)) {
      setError(text.initialReconcileDaysInvalid)
      return
    }
    const mappings = roomTypes.map((roomType) => ({
      roomTypeId: roomType.id,
      externalRoomTypeId: draft.mappings[roomType.id]?.externalRoomTypeId.trim() || '',
      externalRoomTypeName: draft.mappings[roomType.id]?.externalRoomTypeName.trim() || '',
      externalRatePlanId: draft.mappings[roomType.id]?.externalRatePlanId.trim() || '',
    }))
    if (mappings.some((mapping) => !mapping.externalRoomTypeId || !mapping.externalRoomTypeName)) {
      setError(text.mappingRequired)
      return
    }
    setError(null)
    mutation.mutate({ reason, extranetUrl: officialUrl, mappings })
  }

  return (
    <Modal title={`${text.configurationTitle} · ${providerLabel(connection.providerCode)}`} close={() => !mutation.isPending && close()}>
      <form onSubmit={submit}>
        <div className="modal__body setup-form">
          <p>{text.configurationIntro}</p>
          <p className="notice notice--warning">{text.credentialsProhibited}</p>
          <div className="setup-form__connection">
            <label className="field">
              <span>{text.externalPropertyId}</span>
              <input maxLength={200} value={draft.externalPropertyId} onChange={(event) => setDraft((current) => ({ ...current, externalPropertyId: event.target.value }))} />
            </label>
            <label className="field">
              <span>{text.extranetUrl}</span>
              <input type="url" inputMode="url" maxLength={1000} placeholder={`https://…${officialProviderDomain(connection.providerCode)}/`} value={draft.extranetUrl} onChange={(event) => setDraft((current) => ({ ...current, extranetUrl: event.target.value }))} />
              <small>{text.officialUrlHelp}</small>
            </label>
          </div>
          <div className="mapping-editor" aria-label={text.mappingCoverage}>
            {roomTypes.length === 0 ? <EmptyBlock>{text.noPhysicalRoomTypes}</EmptyBlock> : roomTypes.map((roomType) => {
              const mapping = draft.mappings[roomType.id] || { externalRoomTypeId: '', externalRoomTypeName: '', externalRatePlanId: '' }
              return (
                <fieldset key={roomType.id} className="mapping-row">
                  <legend>{roomType.name} · {roomType.code} · {roomType.physicalRoomCount} {text.physicalRooms}</legend>
                  <label className="field"><span>{text.externalRoomTypeId}</span><input required maxLength={200} value={mapping.externalRoomTypeId} onChange={(event) => updateMapping(roomType.id, { externalRoomTypeId: event.target.value })} /></label>
                  <label className="field"><span>{text.externalRoomTypeName}</span><input required maxLength={200} value={mapping.externalRoomTypeName} onChange={(event) => updateMapping(roomType.id, { externalRoomTypeName: event.target.value })} /></label>
                  <label className="field"><span>{text.externalRatePlanId}</span><input maxLength={200} value={mapping.externalRatePlanId} onChange={(event) => updateMapping(roomType.id, { externalRatePlanId: event.target.value })} /></label>
                </fieldset>
              )
            })}
          </div>
          <label className="field checkbox-field">
            <input type="checkbox" checked={draft.enableAfterSave} onChange={(event) => setDraft((current) => ({ ...current, enableAfterSave: event.target.checked }))} />
            <span>{text.enableAfterSave}</span>
          </label>
          <p className="form-note">{text.enableAfterSaveHelp}</p>
          {draft.enableAfterSave ? (
            <label className="field">
              <span>{text.initialReconcileDays}</span>
              <input
                type="number"
                min={1}
                max={90}
                step={1}
                required
                value={draft.initialReconcileDays}
                onChange={(event) => setDraft((current) => ({
                  ...current,
                  initialReconcileDays: Number(event.target.value),
                }))}
              />
              <small>{text.initialReconcileDaysHelp}</small>
            </label>
          ) : null}
          <label className="field">
            <span>{text.reason} *</span>
            <textarea rows={3} maxLength={1000} placeholder={text.setupReasonPlaceholder} value={draft.reason} onChange={(event) => setDraft((current) => ({ ...current, reason: event.target.value }))} />
          </label>
          {error ? <p className="notice notice--error" role="alert">{error}</p> : null}
        </div>
        <footer className="modal__footer">
          <button type="button" className="button button--secondary" disabled={mutation.isPending} onClick={close}>{closeLabel}</button>
          <button className="button" disabled={mutation.isPending || roomTypes.length === 0}>{mutation.isPending ? text.completing : text.saveConfiguration}</button>
        </footer>
      </form>
    </Modal>
  )
}

function ReconcileModal({
  roomTypes,
  text,
  language,
  closeLabel,
  close,
  saved,
}: {
  roomTypes: ManualChannelRoomType[]
  text: DeskCopy
  language: Language
  closeLabel: string
  close: () => void
  saved: () => void
}) {
  const today = dateKeyInBangkok()
  const [from, setFrom] = useState(today)
  const [through, setThrough] = useState(addDateKey(today, 13))
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const mutation = useMutation({
    mutationFn: () => liteApi.reconcileChannelTasks({
      from,
      through,
      roomTypeIds: roomTypes.map((roomType) => roomType.id),
      reason: reason.trim(),
    }),
    onSuccess: saved,
    onError: (cause) => setError(safeErrorMessage(cause, language)),
  })
  const dayCount = inclusiveDateCount(from, through)

  function submit(event: FormEvent) {
    event.preventDefault()
    if (reason.trim().length < MIN_REASON_LENGTH) {
      setError(text.reasonRequired)
      return
    }
    if (!Number.isFinite(dayCount) || dayCount < 1) {
      setError(text.rangeInvalid)
      return
    }
    if (dayCount > 90) {
      setError(text.rangeTooLong)
      return
    }
    if (roomTypes.length === 0) {
      setError(text.noPhysicalRoomTypes)
      return
    }
    setError(null)
    mutation.mutate()
  }

  return (
    <Modal title={text.reconcileTitle} close={() => !mutation.isPending && close()}>
      <form onSubmit={submit}>
        <div className="modal__body setup-form">
          <p>{text.reconcileIntro}</p>
          <div className="setup-form__connection">
            <label className="field"><span>{text.fromDate}</span><input type="date" min={today} value={from} onChange={(event) => setFrom(event.target.value)} /></label>
            <label className="field"><span>{text.throughDate}</span><input type="date" min={from || today} max={from ? addDateKey(from, 89) : undefined} value={through} onChange={(event) => setThrough(event.target.value)} /></label>
          </div>
          <p className="form-note">{text.rangeHelp} ({Number.isFinite(dayCount) && dayCount > 0 ? dayCount : '—'})</p>
          <label className="field"><span>{text.reason} *</span><textarea rows={4} maxLength={1000} placeholder={text.reconcileReasonPlaceholder} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
          {error ? <p className="notice notice--error" role="alert">{error}</p> : null}
        </div>
        <footer className="modal__footer">
          <button type="button" className="button button--secondary" disabled={mutation.isPending} onClick={close}>{closeLabel}</button>
          <button className="button" disabled={mutation.isPending || roomTypes.length === 0}>{mutation.isPending ? text.completing : text.runReconciliation}</button>
        </footer>
      </form>
    </Modal>
  )
}

function RetryTaskModal({
  task,
  text,
  language,
  closeLabel,
  close,
  saved,
}: {
  task: ManualChannelTask
  text: DeskCopy
  language: Language
  closeLabel: string
  close: () => void
  saved: () => void
}) {
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const mutation = useMutation({
    mutationFn: () => liteApi.reopenChannelTask(task.id, reason.trim()),
    onSuccess: saved,
    onError: (cause) => setError(safeErrorMessage(cause, language)),
  })

  function submit(event: FormEvent) {
    event.preventDefault()
    if (reason.trim().length < MIN_REASON_LENGTH) {
      setError(text.reasonRequired)
      return
    }
    setError(null)
    mutation.mutate()
  }

  return (
    <Modal title={`${text.retryTitle} · ${providerLabel(task.providerCode)}`} close={() => !mutation.isPending && close()}>
      <form onSubmit={submit}>
        <div className="modal__body setup-form">
          <p>{text.retryIntro}</p>
          <div className="detail-list">
            <div><span>{text.taskDate}</span><strong>{formatDate(task.stayDate, language)}</strong></div>
            <div><span>{text.externalRoomType}</span><strong>{task.externalRoomTypeName || task.externalRoomTypeId || '—'}</strong></div>
            <div><span>{text.desiredAvailability}</span><strong>{task.desiredAvailability}</strong></div>
          </div>
          <label className="field"><span>{text.reason} *</span><textarea rows={4} maxLength={1000} autoFocus placeholder={text.retryReasonPlaceholder} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
          {error ? <p className="notice notice--error" role="alert">{error}</p> : null}
        </div>
        <footer className="modal__footer">
          <button type="button" className="button button--secondary" disabled={mutation.isPending} onClick={close}>{closeLabel}</button>
          <button className="button" disabled={mutation.isPending}>{mutation.isPending ? text.completing : text.retryTask}</button>
        </footer>
      </form>
    </Modal>
  )
}

export function ChannelDeskView({ role }: { role: LiteRole }) {
  const { language, t } = useI18n()
  const text = deskCopy[language]
  const queryClient = useQueryClient()
  const [emailAction, setEmailAction] = useState<EmailAction | null>(null)
  const [selectedReservationId, setSelectedReservationId] = useState('')
  const [actionReason, setActionReason] = useState('')
  const [actionAdults, setActionAdults] = useState('')
  const [actionChildren, setActionChildren] = useState('')
  const [actionChildAges, setActionChildAges] = useState<string[]>([])
  const [actionError, setActionError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [taskDrafts, setTaskDrafts] = useState<Record<string, TaskDraft>>({})
  const [taskErrors, setTaskErrors] = useState<Record<string, string>>({})
  const [setupConnection, setSetupConnection] = useState<ManualChannelConnection | null>(null)
  const [reconcileOpen, setReconcileOpen] = useState(false)
  const [retryTask, setRetryTask] = useState<ManualChannelTask | null>(null)
  const canManage = role === 'ADMIN' || role === 'MANAGER'
  const canOperateBookings = ['ADMIN', 'MANAGER', 'FRONT_DESK'].includes(role)
  const canProcessPayments = ['ADMIN', 'MANAGER', 'FRONT_DESK', 'CASHIER'].includes(role)

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
    mutationFn: async ({ kind, event, reason, reservationId, editedDetails }: EmailAction & { reason: string; reservationId?: string; editedDetails?: Record<string, unknown> }) => {
      if (kind === 'reject') return liteApi.rejectEmailEvent(event.id, reason)
      const linkedReservationId = reservationId || event.reservationId || undefined
      const mode = event.eventType === 'NEW_BOOKING'
        ? linkedReservationId ? 'link_reservation' : 'create_reservation'
        : 'apply_parsed'
      return liteApi.approveEmailEvent(event.id, {
        mode,
        reservationId: linkedReservationId,
        reason: reason || undefined,
        editedDetails,
      })
    },
    onSuccess: async () => {
      setEmailAction(null)
      setSelectedReservationId('')
      setActionReason('')
      setActionAdults('')
      setActionChildren('')
      setActionChildAges([])
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

  const reprocessEmailMutation = useMutation({
    mutationFn: (event: BookingEmailEvent) => liteApi.reprocessEmailEvent(event.id),
    onSuccess: async () => {
      setActionError(null)
      setSuccessMessage(text.reprocessSaved)
      await queryClient.invalidateQueries({ queryKey: ['lite', 'channel-desk'] })
    },
    onError: async (error) => {
      setActionError(safeErrorMessage(error, language))
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
  const failedTasks = useMemo(
    () => (deskQuery.data?.tasks || []).filter((task) => task.status === 'FAILED'),
    [deskQuery.data?.tasks],
  )
  const reviewEvents = useMemo(
    () => (deskQuery.data?.reviewEvents || []).filter((event) => (
      event.status === 'ERROR'
      || (event.status === 'NEEDS_REVIEW' && ['NEW_BOOKING', 'MODIFICATION', 'CANCELLATION', 'PAYMENT_NOTICE'].includes(event.eventType))
    )),
    [deskQuery.data?.reviewEvents],
  )
  const enabledConnections = deskQuery.data?.connections.filter((connection) => connection.enabled).length || 0
  const linkingNewBooking = Boolean(
    emailAction?.kind === 'approve'
    && emailAction.event.eventType === 'NEW_BOOKING'
    && (selectedReservationId || emailAction.event.reservationId),
  )

  async function finishManagementAction(message: string) {
    setSetupConnection(null)
    setReconcileOpen(false)
    setRetryTask(null)
    setSuccessMessage(message)
    await queryClient.invalidateQueries({ queryKey: ['lite', 'channel-desk'] })
  }

  function openEmailAction(kind: EmailAction['kind'], event: BookingEmailEvent) {
    setEmailAction({ kind, event })
    setSelectedReservationId(event.reservationId || '')
    setActionReason('')
    setActionAdults(event.adults == null ? (event.eventType === 'NEW_BOOKING' ? '1' : '') : String(event.adults))
    setActionChildren(event.children == null ? (event.eventType === 'NEW_BOOKING' ? '0' : '') : String(event.children))
    setActionChildAges(Array.from({ length: event.children || 0 }, (_, index) => (
      event.childAges[index] == null ? '' : String(event.childAges[index])
    )))
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
        ['MODIFICATION', 'CANCELLATION', 'PAYMENT_NOTICE'].includes(emailAction.event.eventType) ||
        (emailAction.event.eventType === 'NEW_BOOKING' && /possible duplicate/i.test(emailAction.event.reviewReason || ''))
      ) &&
      !(selectedReservationId || emailAction.event.reservationId)
    ) {
      setActionError(text.linkRequired)
      return
    }
    let editedDetails: Record<string, unknown> | undefined
    const linkedReservationId = selectedReservationId || emailAction.event.reservationId
    if (
      emailAction.kind === 'approve'
      && (
        emailAction.event.eventType === 'MODIFICATION'
        || (emailAction.event.eventType === 'NEW_BOOKING' && !linkedReservationId)
      )
    ) {
      const adultsRequired = emailAction.event.eventType === 'NEW_BOOKING'
      const adultsText = actionAdults.trim()
      const childrenText = actionChildren.trim()
      const adults = adultsText ? Number(adultsText) : null
      const children = childrenText ? Number(childrenText) : adultsRequired ? 0 : null
      if ((adultsRequired || adultsText) && (!Number.isSafeInteger(adults) || Number(adults) < 1)) {
        setActionError(language === 'th' ? 'กรุณาระบุจำนวนผู้ใหญ่ที่ถูกต้อง' : 'Enter a valid adult count.')
        return
      }
      if (children !== null && (!Number.isSafeInteger(children) || Number(children) < 0)) {
        setActionError(language === 'th' ? 'กรุณาระบุจำนวนเด็กที่ถูกต้อง' : 'Enter a valid child count.')
        return
      }
      const childCount = children === null ? 0 : Number(children)
      const childAgeInputs = actionChildAges.slice(0, childCount)
      const childAges = childAgeInputs.map(Number)
      if (childAgeInputs.some((value) => !value.trim()) || childAges.length !== childCount || childAges.some((age) => !Number.isSafeInteger(age) || age < 0 || age > 17)) {
        setActionError(language === 'th' ? 'กรุณาระบุอายุ 0–17 ปีสำหรับเด็กทุกคน' : 'Enter an age from 0 to 17 for every child.')
        return
      }
      editedDetails = {
        ...(adults !== null ? { adults } : {}),
        ...(children !== null ? { children, childAges } : {}),
      }
    }
    setActionError(null)
    emailMutation.mutate({ ...emailAction, reason, reservationId: selectedReservationId || undefined, editedDetails })
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
          {canManage ? <button className="button" onClick={() => { setSuccessMessage(null); setReconcileOpen(true) }}>{text.reconcile}</button> : null}
          <button className="button button--secondary" disabled={deskQuery.isFetching} onClick={() => void deskQuery.refetch()}>{t('refresh')}</button>
        </div>
      </header>

      <section className="warning-banner" role="alert">
        <strong>{t('manualWarning')}</strong>
        <span>{t('noLiveSync')}</span>
      </section>

      {deskQuery.error ? <p className="notice notice--error" role="alert">{text.refreshFailed}</p> : null}
      {successMessage ? <p className="notice notice--success" role="status">{successMessage}</p> : null}
      {actionError && !emailAction ? <p className="notice notice--error" role="alert">{actionError}</p> : null}
      {!canManage ? <p className="notice notice--subtle">{text.managerOnly}</p> : null}
      {(data.counts.parserErrors || 0) > 0 ? <p className="notice notice--error" role="alert"><strong>{data.counts.parserErrors}</strong> {text.parserErrors}</p> : null}
      {(data.counts.failedTasks || 0) > 0 ? <p className="notice notice--error" role="alert"><strong>{data.counts.failedTasks}</strong> {text.failedTasks}</p> : null}

      <section className="stats-grid" aria-label={text.title}>
        <StatCard label={text.reviewCount} value={data.counts.activeReviewWork} tone={data.counts.activeReviewWork > 0 ? 'warning' : 'success'} />
        <StatCard label={text.taskCount} value={data.counts.pendingTasks} tone={data.counts.pendingTasks > 0 ? 'warning' : 'success'} />
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
          <strong>{copyWithCounts(text.returnedOfTotal, reviewEvents.length, data.counts.activeReviewWork)}</strong>
        </header>
        {data.pagination.reviewEvents.truncated ? <p className="notice notice--warning">{text.listTruncated}</p> : null}
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
                busy={emailMutation.isPending || reprocessEmailMutation.isPending}
                canApply={event.eventType === 'CANCELLATION'
                  ? canManage
                  : event.eventType === 'PAYMENT_NOTICE'
                    ? canProcessPayments
                    : canOperateBookings}
                openAction={openEmailAction}
                reprocess={(event) => {
                  setActionError(null)
                  setSuccessMessage(null)
                  reprocessEmailMutation.mutate(event)
                }}
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
          <strong>{copyWithCounts(text.returnedOfTotal, actionableTasks.length, data.counts.pendingTasks)}</strong>
        </header>
        {data.pagination.tasks.truncated ? <p className="notice notice--warning">{text.listTruncated}</p> : null}
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

      <section className="panel" aria-labelledby="failed-queue-title">
        <header className="panel__header">
          <div>
            <h2 id="failed-queue-title">{text.failedQueue}</h2>
            <p>{text.retryIntro}</p>
          </div>
          <strong>{copyWithCounts(text.returnedOfTotal, failedTasks.length, data.counts.failedTasks)}</strong>
        </header>
        {failedTasks.length === 0 ? (
          <EmptyBlock>{text.noFailedTasks}</EmptyBlock>
        ) : (
          <div className="channel-card-grid">
            {failedTasks.map((task) => (
              <FailedTaskCard
                key={task.id}
                task={task}
                language={language}
                text={text}
                canManage={canManage}
                retry={() => { setSuccessMessage(null); setRetryTask(task) }}
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
            {data.connections.map((connection) => (
              <ConnectionCard
                key={connection.id}
                connection={connection}
                text={text}
                physicalRoomTypeCount={data.roomTypes.length}
                canManage={canManage}
                configure={() => { setSuccessMessage(null); setSetupConnection(connection) }}
              />
            ))}
          </div>
        )}
      </section>

      {setupConnection && canManage ? (
        <ConnectionSetupModal
          key={setupConnection.id}
          connection={setupConnection}
          roomTypes={data.roomTypes}
          language={language}
          text={text}
          closeLabel={t('close')}
          close={() => setSetupConnection(null)}
          saved={() => void finishManagementAction(text.configurationSaved)}
        />
      ) : null}

      {reconcileOpen && canManage ? (
        <ReconcileModal
          roomTypes={data.roomTypes}
          language={language}
          text={text}
          closeLabel={t('close')}
          close={() => setReconcileOpen(false)}
          saved={() => void finishManagementAction(text.reconciliationSaved)}
        />
      ) : null}

      {retryTask && canManage ? (
        <RetryTaskModal
          key={retryTask.id}
          task={retryTask}
          language={language}
          text={text}
          closeLabel={t('close')}
          close={() => setRetryTask(null)}
          saved={() => void finishManagementAction(text.retrySaved)}
        />
      ) : null}

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
            {emailAction.kind === 'approve' && ['NEW_BOOKING', 'MODIFICATION'].includes(emailAction.event.eventType) && !linkingNewBooking ? (
              <>
                <div className="setup-form__connection">
                  <label className="field">
                    <span>{language === 'th' ? 'จำนวนผู้ใหญ่' : 'Adults'}</span>
                    <input
                      required={emailAction.event.eventType === 'NEW_BOOKING'}
                      min="1"
                      step="1"
                      type="number"
                      value={actionAdults}
                      onChange={(event) => setActionAdults(event.target.value)}
                    />
                  </label>
                  <label className="field">
                    <span>{language === 'th' ? 'จำนวนเด็ก' : 'Children'}</span>
                    <input
                      required={emailAction.event.eventType === 'NEW_BOOKING'}
                      min="0"
                      step="1"
                      type="number"
                      value={actionChildren}
                      onChange={(event) => {
                        const value = event.target.value
                        setActionChildren(value)
                        const count = Number(value)
                        if (Number.isSafeInteger(count) && count >= 0) {
                          setActionChildAges((current) => Array.from({ length: count }, (_, index) => current[index] || ''))
                        }
                      }}
                    />
                  </label>
                </div>
                {actionChildAges.map((age, index) => (
                  <label className="field" key={index}>
                    <span>{language === 'th' ? `อายุเด็กคนที่ ${index + 1}` : `Child ${index + 1} age`}</span>
                    <input
                      required
                      min="0"
                      max="17"
                      step="1"
                      type="number"
                      value={age}
                      onChange={(event) => setActionChildAges((current) => current.map((item, itemIndex) => itemIndex === index ? event.target.value : item))}
                    />
                  </label>
                ))}
                <p className="form-note">{language === 'th' ? 'ตรวจสอบจำนวนผู้เข้าพักและอายุเด็กกับ OTA ก่อนอนุมัติ เพื่อคำนวณราคาและความจุอย่างถูกต้อง' : 'Verify occupancy and every child age against the OTA before approval so capacity and pricing are exact.'}</p>
              </>
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
