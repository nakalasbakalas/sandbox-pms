import { useQuery } from '@tanstack/react-query'

import { liteApi } from '../api'
import { EmptyBlock, ErrorBlock, LoadingBlock, StatusPill } from '../components'
import { useI18n } from '../i18n'
import type { LiteUser } from '../types'

function today() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

function tomorrow(value: string) {
  const date = new Date(`${value}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + 1)
  return date.toISOString().slice(0, 10)
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
  if (setup.error || !setup.data) return <ErrorBlock error={setup.error || 'Settings unavailable.'} retry={() => setup.refetch()} />

  const property = setup.data.property
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
              {setup.data.roomTypes.map((item) => <div key={item.id}><span>{item.name}</span><strong>{item.code}</strong></div>)}
            </div>
          </article>
          <article className="settings-card">
            <span>{language === 'th' ? 'จำนวนห้อง' : 'Physical rooms'}</span>
            <strong>{setup.data.rooms.length}</strong>
            <div className="mini-list mini-list--wrap">
              {setup.data.rooms.map((item) => <span className="room-number" key={item.id}>{item.number}</span>)}
            </div>
          </article>
        </div>
      </section>
      <section className="panel">
        <header className="panel__header"><h2>{t('staffUsers')}</h2></header>
        {user.role !== 'ADMIN' ? <EmptyBlock>{language === 'th' ? 'เฉพาะผู้ดูแลระบบเท่านั้น' : 'Administrator access required.'}</EmptyBlock> : users.isLoading ? <LoadingBlock /> : users.error ? <ErrorBlock error={users.error} /> : (
          <div className="mini-list">
            {users.data?.map((item) => (
              <div key={item.id}><span><strong>{item.displayName}</strong><small>{item.username}</small></span><span><StatusPill value={item.active === false ? 'DISABLED' : 'AVAILABLE'} /> {item.role.replaceAll('_', ' ')}</span></div>
            ))}
          </div>
        )}
      </section>
      <section className="panel">
        <header className="panel__header"><h2>{t('syncHealth')}</h2></header>
        {channels.error ? <ErrorBlock error={channels.error} /> : (
          <div className="settings-grid">
            <article className="settings-card"><span>Gmail OAuth</span><strong>{channels.data?.syncHealth.credentialReady ? 'Ready' : 'Not ready'}</strong><StatusPill value={channels.data?.syncHealth.credentialReady ? 'AVAILABLE' : 'ERROR'} /></article>
            <article className="settings-card"><span>Gmail Push</span><strong>{channels.data?.syncHealth.watchReady ? 'Watching' : 'Fallback polling'}</strong><StatusPill value={channels.data?.syncHealth.watchReady ? 'AVAILABLE' : 'PENDING'} /></article>
            <article className="settings-card"><span>{t('connections')}</span><strong>{channels.data?.connections.filter((item) => item.enabled).length || 0}</strong><p>{t('noLiveSync')}</p></article>
          </div>
        )}
      </section>
      <section className="panel">
        <header className="panel__header"><h2>{t('release')}</h2></header>
        {version.error ? <ErrorBlock error={version.error} /> : (
          <dl className="release-grid">
            <div><dt>Commit</dt><dd>{version.data?.commitSha || 'development'}</dd></div>
            <div><dt>UI</dt><dd>{version.data?.uiVariant || 'lite'}</dd></div>
            <div><dt>Build</dt><dd>{version.data?.buildTime || 'local'}</dd></div>
            <div><dt>Asset</dt><dd>{version.data?.assetIdentifier || 'vite-dev'}</dd></div>
          </dl>
        )}
      </section>
    </div>
  )
}
