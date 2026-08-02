const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3'
const DRIVE_READONLY_SCOPE = 'https://www.googleapis.com/auth/drive.readonly'
const GOOGLE_DOC_MIME = 'application/vnd.google-apps.document'
const MAX_DOCUMENT_BYTES = 64_000
const MAX_DRIVE_FILES = 100
const MAX_EXPORTS_PER_SYNC = 20

const TOP_LEVEL_KEYS = new Set([
  'booking_type', 'booking_status', 'intent', 'email_category', 'booking_details', 'extracted_details',
  'guest_name', 'confirmation_number', 'check_in', 'check_out', 'check_in_date', 'check_out_date',
  'room_type', 'total_price', 'currency', 'special_requests', 'hotel_name', 'number_of_adults',
  'number_of_children', 'extra_beds', 'cancellation_fee', 'booking_details_link',
  'booking_accuracy_assessment', 'booking_accuracy_grade', 'justification',
])
const DETAIL_KEYS = new Set([
  'guest_name', 'confirmation_number', 'check_in', 'check_out', 'check_in_date', 'check_out_date',
  'room_type', 'total_price', 'currency', 'special_requests',
])
const MONTHS = Object.freeze({
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9,
  september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
})

function enabled(value) {
  return ['1', 'true', 'yes', 'on', 'enabled'].includes(String(value || '').trim().toLowerCase())
}

function nullableString(value, maxLength = 200) {
  if (value === undefined || value === null) return null
  const text = String(value).trim()
  const hasUnsafeControl = [...text].some((character) => {
    const code = character.codePointAt(0)
    return code !== undefined && code < 32 && ![9, 10, 13].includes(code)
  })
  if (!text || text.length > maxLength || hasUnsafeControl) return null
  return text
}

function normalizedReference(value) {
  return nullableString(value, 100)?.toUpperCase().replace(/[^A-Z0-9]+/g, '') || null
}

function validDate(year, month, day) {
  const y = Number(year)
  const m = Number(month)
  const d = Number(day)
  const date = new Date(Date.UTC(y, m - 1, d))
  if (date.getUTCFullYear() !== y || date.getUTCMonth() + 1 !== m || date.getUTCDate() !== d) return null
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

function normalizeDate(value) {
  const text = nullableString(value, 80)
  if (!text) return null
  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (iso) return validDate(iso[1], iso[2], iso[3])
  const monthFirst = text.match(/^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})$/)
  if (monthFirst) return validDate(monthFirst[3], MONTHS[monthFirst[1].toLowerCase()], monthFirst[2])
  const dayFirst = text.match(/^(\d{1,2})[\s-]+([A-Za-z]{3,9})[\s,-]+(\d{4})$/)
  if (dayFirst) return validDate(dayFirst[3], MONTHS[dayFirst[2].toLowerCase()], dayFirst[1])
  return null
}

function normalizeAmount(value, fallbackCurrency) {
  if (value === undefined || value === null || value === '' || /not specified/i.test(String(value))) return {}
  const text = String(value).trim()
  const match = text.match(/(?:([A-Z]{3})\s*)?([0-9][0-9,]*(?:\.\d{1,2})?)(?:\s*([A-Z]{3}))?/i)
  if (!match) return {}
  const amount = Number(match[2].replace(/,/g, ''))
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100_000_000) return {}
  return {
    amount: Math.round(amount * 100) / 100,
    currency: nullableString(match[1] || match[3] || fallbackCurrency, 3)?.toUpperCase() || 'THB',
  }
}

function extractJsonObject(text) {
  const input = String(text || '').replace(/^\uFEFF/, '')
  if (!input || Buffer.byteLength(input, 'utf8') > MAX_DOCUMENT_BYTES) throw new Error('Workspace JSON document exceeds the safe size limit.')
  const start = input.indexOf('{')
  if (start < 0) throw new Error('Workspace document does not contain a JSON object.')
  let depth = 0
  let quoted = false
  let escaped = false
  for (let index = start; index < input.length; index += 1) {
    const character = input[index]
    if (quoted) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '"') quoted = false
      continue
    }
    if (character === '"') quoted = true
    else if (character === '{') depth += 1
    else if (character === '}') {
      depth -= 1
      if (depth === 0) return input.slice(start, index + 1)
    }
  }
  throw new Error('Workspace JSON object is incomplete.')
}

function assertAllowedKeys(object, allowed, label) {
  if (!object || typeof object !== 'object' || Array.isArray(object)) throw new Error(`${label} must be an object.`)
  const unknown = Object.keys(object).filter((key) => !allowed.has(key))
  if (unknown.length > 0) throw new Error(`${label} contains unsupported fields.`)
}

function normalizeEventType(value) {
  const text = String(value || '').trim().toLowerCase()
  if (/new booking|confirmed|confirmation/.test(text)) return 'NEW_BOOKING'
  if (/cancel/.test(text)) return 'CANCELLATION'
  if (/modif|amend|change|update/.test(text)) return 'MODIFICATION'
  if (/special request|guest message|request/.test(text)) return 'GUEST_MESSAGE'
  if (/payment/.test(text)) return 'PAYMENT_NOTICE'
  return 'UNKNOWN'
}

export function parseBookingEmailWorkspaceJson(text, metadata = {}) {
  const parsed = JSON.parse(extractJsonObject(text))
  assertAllowedKeys(parsed, TOP_LEVEL_KEYS, 'Workspace booking analysis')
  const nested = parsed.booking_details || parsed.extracted_details || {}
  assertAllowedKeys(nested, DETAIL_KEYS, 'Workspace booking details')
  const details = { ...nested, ...Object.fromEntries(Object.entries(parsed).filter(([key]) => DETAIL_KEYS.has(key))) }
  const eventType = normalizeEventType(parsed.booking_type || parsed.booking_status || parsed.intent || parsed.email_category)
  const channelRef = nullableString(details.confirmation_number, 100)
  const normalizedChannelRef = normalizedReference(channelRef)
  if (!normalizedChannelRef || normalizedChannelRef.length < 4) throw new Error('Workspace booking analysis is missing a valid confirmation number.')
  const guestName = nullableString(details.guest_name, 120)
  const checkIn = normalizeDate(details.check_in || details.check_in_date)
  const checkOut = normalizeDate(details.check_out || details.check_out_date)
  const externalRoomType = nullableString(details.room_type, 120)
  const money = normalizeAmount(details.total_price, details.currency)
  const specialRequests = Array.isArray(details.special_requests)
    ? details.special_requests.map((item) => nullableString(item, 160)).filter(Boolean).slice(0, 10)
    : []
  return {
    schemaVersion: 'workspace-booking-analysis-v1',
    fileId: nullableString(metadata.fileId, 128),
    modifiedTime: nullableString(metadata.modifiedTime, 40),
    eventType,
    channelRef,
    normalizedChannelRef,
    details: {
      ...(guestName ? { guestName } : {}),
      ...(checkIn ? { checkIn } : {}),
      ...(checkOut ? { checkOut } : {}),
      ...(externalRoomType ? { externalRoomType } : {}),
      ...money,
      ...(specialRequests.length ? { specialRequests } : {}),
    },
    ignoredSelfAssessment: Boolean(parsed.booking_accuracy_assessment || parsed.booking_accuracy_grade || parsed.justification),
  }
}

export function bookingEmailWorkspaceJsonStatus(env = process.env) {
  const requested = enabled(env.BOOKING_EMAIL_WORKSPACE_JSON_ENABLED)
  const folderId = nullableString(env.BOOKING_EMAIL_WORKSPACE_JSON_FOLDER_ID, 128)
  const scopes = String(env.BOOKING_EMAIL_GMAIL_SCOPES || env.GMAIL_SCOPES || '')
    .split(/[\s,]+/).map((scope) => scope.trim()).filter(Boolean)
  const driveScopeConfigured = scopes.includes(DRIVE_READONLY_SCOPE)
  const missing = []
  if (requested && !folderId) missing.push('BOOKING_EMAIL_WORKSPACE_JSON_FOLDER_ID')
  if (requested && !driveScopeConfigured) missing.push('BOOKING_EMAIL_GMAIL_SCOPES including drive.readonly')
  return {
    requested,
    configured: requested && Boolean(folderId) && driveScopeConfigured,
    folderConfigured: Boolean(folderId),
    driveScopeConfigured,
    requireForAutonomy: requested && enabled(env.BOOKING_EMAIL_REQUIRE_WORKSPACE_JSON ?? 'true'),
    missing,
  }
}

async function googleResponse(fetchImpl, url, accessToken) {
  const response = await fetchImpl(url, { headers: { authorization: `Bearer ${accessToken}` } })
  if (!response.ok) throw new Error(`Google Drive request failed with status ${response.status}.`)
  return response
}

function driveNameMatchesReference(name, reference) {
  return normalizedReference(name)?.includes(reference) || false
}

export function bookingEmailWorkspaceAnalysisKey(channelRef, eventType) {
  return `${normalizedReference(channelRef) || 'MISSING'}:${nullableString(eventType, 40)?.toUpperCase() || 'UNKNOWN'}`
}

export async function fetchBookingEmailWorkspaceAnalyses(targets, options = {}) {
  const env = options.env || process.env
  const status = bookingEmailWorkspaceJsonStatus(env)
  if (!status.configured) return { status, analyses: {}, matchedCount: 0, error: null }
  const accessToken = nullableString(options.accessToken, 4096)
  if (!accessToken) return { status, analyses: {}, matchedCount: 0, error: 'Workspace JSON OAuth access is unavailable.' }
  const targetList = (Array.isArray(targets) ? targets : [])
    .map((target) => ({
      channelRef: nullableString(target?.channelRef, 100),
      normalizedChannelRef: normalizedReference(target?.channelRef),
      eventType: nullableString(target?.eventType, 40)?.toUpperCase() || 'UNKNOWN',
    }))
    .filter((target) => target.normalizedChannelRef)
    .slice(0, 50)
  if (targetList.length === 0) return { status, analyses: {}, matchedCount: 0, error: null }

  try {
    const folderId = String(env.BOOKING_EMAIL_WORKSPACE_JSON_FOLDER_ID).trim()
    const query = `'${folderId.replaceAll("'", "\\'")}' in parents and trashed = false`
    const listUrl = new URL(`${DRIVE_API_BASE}/files`)
    listUrl.searchParams.set('q', query)
    listUrl.searchParams.set('pageSize', String(MAX_DRIVE_FILES))
    listUrl.searchParams.set('orderBy', 'modifiedTime desc')
    listUrl.searchParams.set('fields', 'files(id,name,mimeType,modifiedTime)')
    const payload = await (await googleResponse(options.fetchImpl || fetch, listUrl, accessToken)).json()
    const files = Array.isArray(payload?.files) ? payload.files : []
    const analyses = {}
    let exportsUsed = 0

    for (const target of targetList) {
      const candidates = files
        .filter((file) => nullableString(file?.id, 128) && driveNameMatchesReference(file?.name, target.normalizedChannelRef))
        .slice(0, 5)
      for (const file of candidates) {
        if (exportsUsed >= MAX_EXPORTS_PER_SYNC) break
        exportsUsed += 1
        const url = file.mimeType === GOOGLE_DOC_MIME
          ? `${DRIVE_API_BASE}/files/${encodeURIComponent(file.id)}/export?mimeType=text%2Fplain`
          : `${DRIVE_API_BASE}/files/${encodeURIComponent(file.id)}?alt=media`
        const text = await (await googleResponse(options.fetchImpl || fetch, url, accessToken)).text()
        let analysis
        try {
          analysis = parseBookingEmailWorkspaceJson(text, { fileId: file.id, modifiedTime: file.modifiedTime })
        } catch {
          continue
        }
        if (analysis.normalizedChannelRef !== target.normalizedChannelRef) continue
        if (target.eventType !== 'UNKNOWN' && analysis.eventType !== target.eventType) continue
        analyses[bookingEmailWorkspaceAnalysisKey(target.channelRef, target.eventType)] = analysis
        break
      }
    }
    return { status, analyses, matchedCount: Object.keys(analyses).length, error: null }
  } catch {
    return { status, analyses: {}, matchedCount: 0, error: 'Workspace JSON Drive lookup failed.' }
  }
}
