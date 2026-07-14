import { useQuery } from '@tanstack/react-query'

import { liteApi } from '../api'
import { EmptyBlock, ErrorBlock, formatMoney, LoadingBlock, StatusPill } from '../components'
import { providerLabel, statusLabel, useI18n } from '../i18n'
import type { Language, LiteUser, ManualChannelConnection } from '../types'

function today() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

function tomorrow(value: string) {
  const date = new Date(`${value}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + 1)
  return date.toISOString().slice(0, 10)
}

function localizedError(error: unknown, language: Language, englishFallback: string, thaiFallback: string) {
  if (language === 'th') return thaiFallback
  return error instanceof Error && error.message ? error.message : englishFallback
}

function formatDateTime(value: string | null | undefined, language: Language) {
  if (!value) return language === 'th' ? 'ยังไม่ยืนยัน' : 'Not yet confirmed'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return language === 'th' ? 'ข้อมูลเวลาไม่ถูกต้อง' : 'Invalid timestamp'
  return new Intl.DateTimeFormat(language === 'th' ? 'th-TH' : 'en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Bangkok',
  }).format(date)
}

const safeProviderDomains: Record<string, string[]> = {
  booking_com: ['booking.com'],
  bookingcom: ['booking.com'],
  agoda: ['agoda.com'],
  trip_com: ['trip.com'],
  tripcom: ['trip.com'],
}

function safeExtranetUrl(connection: ManualChannelConnection) {
  if (!connection.extranetUrl) return null
  const provider = String(connection.providerCode || '').trim().toLowerCase().replaceAll('.', '_').replaceAll('-', '_')
  const allowedDomains = safeProviderDomains[provider] || []
  if (allowedDomains.length === 0) return null
  try {
    const url = new URL(connection.extranetUrl)
    const host = url.hostname.toLowerCase().replace(/\.$/, '')
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return null
    if (url.port && url.port !== '443') return null
    if (!allowedDomains.some((domain) => host === domain || host.endsWith(`.${domain}`))) return null
    return url.toString()
  } catch {
    return null
  }
}

export function SettingsView({ user }: { user: LiteUser }) {
  const { t, language } = useI18n()
  const hotelDate = today()
  const setup = useQuery({
    queryKey: ['lite', 'settings-snapshot', hotelDate],
    queryFn: () => liteApi.board(hotelDate, tomorrow(hotelDate)),
    staleTime: 60_000,
  })
  const users = useQuery({ queryKey: ['lite', 'users'], queryFn: liteApi.users, enabled: user.role === 'ADMIN' })
  const version = useQuery({ queryKey: ['lite', 'version'], queryFn: liteApi.version, staleTime: Infinity })
  const channels = useQuery({ queryKey: ['lite', 'channel-desk'], queryFn: liteApi.channelDesk, refetchInterval: 30_000 })

  if (setup.isLoading) return <LoadingBlock />
  if (setup.error || !setup.data) return <ErrorBlock error={localizedError(setup.error, language, 'Settings are unavailable.', 'ไม่สามารถโหลดข้อมูลการตั้งค่าได้')} retry={() => setup.refetch()} />

  const property = setup.data.property
  const health = channels.data?.syncHealth
  return (
    <div className="view-stack">
      <header className="view-heading"><div><p className="eyebrow">{user.displayName}</p><h1>{t('settings')}</h1></div></header>

      <section className="panel">
        <header className="panel__header"><h2>{t('propertyRooms')}</h2></header>
        <div className="settings-grid">
          <article className="settings-card">
            <span>{language === 'th' ? 'โรงแรม' : 'Property'}</span>
            <strong>{String(property.name || 'Sandbox Hotel')}</strong>
            <dl>
              <div><dt>{language === 'th' ? 'รหัสโรงแรม' : 'Property code'}</dt><dd>{property.code || '—'}</dd></div>
              <div><dt>{language === 'th' ? 'เขตเวลา' : 'Timezone'}</dt><dd>{String(property.timezone || 'Asia/Bangkok')}</dd></div>
              <div><dt>{language === 'th' ? 'สกุลเงิน' : 'Currency'}</dt><dd>{String(property.currency || 'THB')}</dd></div>
              <div><dt>{language === 'th' ? 'เช็กอิน' : 'Check-in'}</dt><dd>{String(property.defaultCheckIn || '14:00')}</dd></div>
              <div><dt>{language === 'th' ? 'เช็กเอาต์' : 'Check-out'}</dt><dd>{String(property.defaultCheckOut || '12:00')}</dd></div>
            </dl>
          </article>
          <article className="settings-card">
            <span>{t('roomType')}</span>
            <strong>{setup.data.roomTypes.length}</strong>
            <div className="mini-list">
              {setup.data.roomTypes.map((item) => (
                <div key={item.id}>
                  <span><strong>{item.name}</strong><small>{item.code} · {formatMoney(item.baseRateSatang, language)}</small></span>
                  <span>{item.roomCount} {language === 'th' ? 'ห้อง' : item.roomCount === 1 ? 'room' : 'rooms'}</span>
                </div>
              ))}
            </div>
          </article>
          <article className="settings-card">
            <span>{language === 'th' ? 'ห้องจริง' : 'Physical rooms'}</span>
            <strong>{setup.data.rooms.length}</strong>
            <div className="mini-list settings-room-list">
              {setup.data.rooms.map((item) => (
                <div key={item.id}>
                  <span><strong>{item.number}</strong><small>{item.roomType.name} · {language === 'th' ? `ชั้น ${item.floor}` : `Floor ${item.floor}`}</small></span>
                  <span><StatusPill value={item.operationalStatus} /> <StatusPill value={item.housekeepingStatus} /></span>
                </div>
              ))}
            </div>
          </article>
        </div>
      </section>

      <section className="panel">
        <header className="panel__header"><h2>{t('staffUsers')}</h2></header>
        {user.role !== 'ADMIN' ? <EmptyBlock>{language === 'th' ? 'เฉพาะผู้ดูแลระบบเท่านั้นที่ดูรายชื่อผู้ใช้ได้' : 'Administrator access is required to view staff users.'}</EmptyBlock> : users.isLoading ? <LoadingBlock /> : users.error ? <ErrorBlock error={localizedError(users.error, language, 'Staff users are unavailable.', 'ไม่สามารถโหลดรายชื่อผู้ใช้งานได้')} /> : (
          <div className="mini-list">
            {users.data?.map((item) => (
              <div key={item.id}><span><strong>{item.displayName}</strong><small>{item.username}</small></span><span><StatusPill value={item.active === false ? 'DISABLED' : 'ENABLED'} /> {statusLabel(item.role, language)}</span></div>
            ))}
          </div>
        )}
      </section>

      <section className="panel">
        <header className="panel__header"><div><h2>{language === 'th' ? 'แหล่งอีเมล Gmail' : 'Gmail booking source'}</h2><p>{language === 'th' ? 'รับเฉพาะผู้ส่ง OTA ที่อนุมัติ และต้องให้พนักงานตรวจสอบก่อนเปลี่ยนการจอง' : 'Approved OTA senders only; every booking change remains staff-review gated.'}</p></div></header>
        {channels.isLoading ? <LoadingBlock /> : channels.error || !channels.data ? <ErrorBlock error={localizedError(channels.error, language, 'Mailbox health is unavailable.', 'ไม่สามารถโหลดสถานะกล่องอีเมลได้')} retry={() => channels.refetch()} /> : (
          <div className="settings-grid">
            <article className="settings-card">
              <span>{language === 'th' ? 'แหล่งข้อมูล' : 'Source'}</span>
              <strong>Gmail API</strong>
              <p>{language === 'th' ? 'ใช้ OAuth ฝั่งเซิร์ฟเวอร์เท่านั้น ไม่ใช้รหัสผ่านกล่องอีเมล' : 'Server-side OAuth only; mailbox passwords are never used.'}</p>
            </article>
            <article className="settings-card">
              <span>{language === 'th' ? 'สิทธิ์ OAuth' : 'OAuth authorization'}</span>
              <strong>{health?.credentialReady ? (language === 'th' ? 'พร้อม' : 'Ready') : (language === 'th' ? 'ยังไม่พร้อม' : 'Not ready')}</strong>
              <StatusPill value={health?.credentialReady ? 'READY' : 'NOT_READY'} />
            </article>
            <article className="settings-card">
              <span>{language === 'th' ? 'การรับข้อมูลใกล้เรียลไทม์' : 'Near-live delivery'}</span>
              <strong>{health?.watchReady ? (language === 'th' ? 'Gmail Push ทำงาน' : 'Gmail push active') : (language === 'th' ? 'ใช้การตรวจสอบซ้ำ' : 'Reconciliation fallback')}</strong>
              <StatusPill value={health?.watchReady ? 'WATCHING' : 'FALLBACK'} />
              <p>{language === 'th' ? 'เมื่อ Push ไม่พร้อม งานตรวจสอบทุก 5 นาทีคือเส้นทางสำรองที่กำหนดไว้' : 'When push is unavailable, the defined fallback is five-minute reconciliation.'}</p>
            </article>
            <article className="settings-card">
              <span>{language === 'th' ? 'หลักฐานการทำงานล่าสุด' : 'Latest activity evidence'}</span>
              <dl>
                <div><dt>{language === 'th' ? 'Push ล่าสุด' : 'Last push'}</dt><dd>{formatDateTime(health?.lastPushAt, language)}</dd></div>
                <div><dt>{language === 'th' ? 'ตรวจสอบซ้ำล่าสุด' : 'Last reconciliation'}</dt><dd>{formatDateTime(health?.lastReconciledAt || health?.lastSyncAt, language)}</dd></div>
                <div><dt>{language === 'th' ? 'Watch หมดอายุ' : 'Watch expires'}</dt><dd>{formatDateTime(health?.watchExpiresAt, language)}</dd></div>
              </dl>
            </article>
            <article className="settings-card">
              <span>{language === 'th' ? 'รายการส่งและการตั้งค่า' : 'Delivery and configuration'}</span>
              <dl>
                <div><dt>{language === 'th' ? 'รอประมวลผล' : 'Pending'}</dt><dd>{health?.pendingDeliveries || 0}</dd></div>
                <div><dt>{language === 'th' ? 'ล้มเหลว' : 'Failed'}</dt><dd>{health?.failedDeliveries || 0}</dd></div>
                <div><dt>{language === 'th' ? 'ค่าที่ต้องตั้งเพิ่ม' : 'Missing settings'}</dt><dd>{health?.missingConfiguration.length || 0}</dd></div>
              </dl>
              {health?.lastError ? <p className="notice notice--error">{language === 'th' ? 'การซิงก์กล่องอีเมลต้องได้รับการตรวจสอบ รายละเอียดที่ละเอียดอ่อนถูกซ่อนไว้' : 'Mailbox synchronization needs attention. Sensitive provider details are hidden here.'}</p> : null}
            </article>
          </div>
        )}
      </section>

      <section className="panel">
        <header className="panel__header"><div><h2>{language === 'th' ? 'การเชื่อมต่อและ mapping OTA' : 'Manual OTA mappings and links'}</h2><p>{t('manualWarning')}</p></div><a className="button button--secondary" href="/channel-desk">{language === 'th' ? 'เปิดหน้าช่องทาง OTA' : 'Open Channel Desk'}</a></header>
        {channels.isLoading ? <LoadingBlock /> : channels.error || !channels.data ? <ErrorBlock error={localizedError(channels.error, language, 'OTA settings are unavailable.', 'ไม่สามารถโหลดการตั้งค่า OTA ได้')} retry={() => channels.refetch()} /> : (
          <div className="settings-grid">
            {channels.data.connections.map((connection) => {
              const activeMappings = connection.mappings.filter((mapping) => mapping.active)
              const extranetUrl = safeExtranetUrl(connection)
              return (
                <article className="settings-card" key={connection.id}>
                  <span>{providerLabel(connection.providerCode)}</span>
                  <div className="settings-card__title"><strong>{connection.displayName || providerLabel(connection.providerCode)}</strong><StatusPill value={connection.enabled ? 'ENABLED' : 'DISABLED'} /></div>
                  <dl>
                    <div><dt>{language === 'th' ? 'โหมด' : 'Mode'}</dt><dd>{statusLabel(connection.deliveryMode, language)}</dd></div>
                    <div><dt>{language === 'th' ? 'การตั้งค่า' : 'Configuration'}</dt><dd>{statusLabel(connection.configured ? 'CONFIGURED' : 'NOT_CONFIGURED', language)}</dd></div>
                    <div><dt>{language === 'th' ? 'รหัสโรงแรมใน OTA' : 'OTA property ID'}</dt><dd>{connection.externalPropertyId || '—'}</dd></div>
                    <div><dt>Mapping</dt><dd>{activeMappings.length}/{channels.data.roomTypes.length}</dd></div>
                  </dl>
                  {connection.mappings.length ? (
                    <div className="mini-list settings-mapping-list">
                      {connection.mappings.map((mapping) => <div key={mapping.id}><span>{mapping.roomTypeName || mapping.roomTypeId}<small>{mapping.externalRoomTypeName || mapping.externalRoomTypeId}</small></span><StatusPill value={mapping.active ? 'ENABLED' : 'DISABLED'} /></div>)}
                    </div>
                  ) : <p>{language === 'th' ? 'ยังไม่มี mapping ประเภทห้อง' : 'No room-type mappings are configured.'}</p>}
                  <div className="settings-card__actions">
                    {extranetUrl ? <a className="button button--secondary" href={extranetUrl} target="_blank" rel="noreferrer">{t('openExtranet')}</a> : <span className="muted">{language === 'th' ? 'ยังไม่มีลิงก์ Extranet ที่ปลอดภัย' : 'No safe Extranet link configured'}</span>}
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </section>

      <section className="panel">
        <header className="panel__header"><h2>{t('release')}</h2></header>
        {version.isLoading ? <LoadingBlock /> : version.error ? <ErrorBlock error={localizedError(version.error, language, 'Release identity is unavailable.', 'ไม่สามารถโหลดข้อมูลเวอร์ชันได้')} retry={() => version.refetch()} /> : (
          <dl className="release-grid">
            <div><dt>Commit</dt><dd>{version.data?.commitSha || (language === 'th' ? 'โหมดพัฒนา' : 'development')}</dd></div>
            <div><dt>UI</dt><dd>{statusLabel((version.data?.uiVariant || 'unknown').toUpperCase(), language)}</dd></div>
            <div><dt>{language === 'th' ? 'เวลาสร้าง' : 'Build time'}</dt><dd>{version.data?.buildTime || (language === 'th' ? 'ในเครื่อง' : 'local')}</dd></div>
            <div><dt>Asset</dt><dd>{version.data?.assetIdentifier || 'vite-dev'}</dd></div>
            <div><dt>{language === 'th' ? 'สภาพแวดล้อม' : 'Environment'}</dt><dd>{version.data?.environment || '—'}</dd></div>
            <div><dt>{language === 'th' ? 'บริการ' : 'Service'}</dt><dd>{version.data?.serviceName || '—'}</dd></div>
          </dl>
        )}
      </section>

      <section className="panel">
        <header className="panel__header"><h2>{language === 'th' ? 'การกู้คืนและย้อนกลับ' : 'Recovery and rollback'}</h2></header>
        <div className="settings-grid">
          <article className="settings-card">
            <span>{language === 'th' ? 'ขอบเขตการควบคุม' : 'Control boundary'}</span>
            <strong>{language === 'th' ? 'เจ้าของระบบดำเนินการภายนอก Lite' : 'Owner-controlled outside Lite'}</strong>
            <p>{language === 'th' ? 'หน้าจอนี้ไม่สร้าง recovery point ไม่ restore ฐานข้อมูล และไม่ใช่หลักฐานว่าทดสอบการกู้คืนผ่านแล้ว' : 'This screen does not create recovery points, restore databases, or prove that a recovery test passed.'}</p>
          </article>
          <article className="settings-card">
            <span>{language === 'th' ? 'ก่อนเปลี่ยนข้อมูลสำคัญ' : 'Before sensitive data changes'}</span>
            <strong>{language === 'th' ? 'ต้องมี recovery point และทดสอบ restore' : 'Recovery point plus restore test required'}</strong>
            <p>{language === 'th' ? 'ตรวจสอบ recovery point ของ Render ที่สร้างใหม่และการ restore ลงฐานข้อมูลทดสอบตาม runbook ก่อนเปลี่ยนเงินหรือข้อมูลการจอง' : 'Verify a fresh Render recovery point and a disposable restore using the runbook before money or booking-data changes.'}</p>
          </article>
          <article className="settings-card">
            <span>{language === 'th' ? 'นโยบายช่วงย้อนกลับ' : 'Rollback policy'}</span>
            <strong>{language === 'th' ? 'เก็บระบบเดิม 30 วันหลัง cutover' : 'Retain legacy for 30 days after cutover'}</strong>
            <p>{language === 'th' ? 'ต้องเก็บสิทธิ์และ export ของ Little Hotelier ตลอดช่วงย้อนกลับ หน้านี้ไม่ยืนยันว่าเริ่มหรือจบช่วงดังกล่าวแล้ว' : 'Retain Little Hotelier access and exports throughout the rollback window. This screen does not claim that window has started or completed.'}</p>
          </article>
        </div>
      </section>
    </div>
  )
}
