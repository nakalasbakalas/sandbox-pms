import { useMemo, useState } from 'react'
import type { Icon } from '@phosphor-icons/react'
import { Broom, CheckCircle, ClipboardText, Eye, FunnelSimple, Hammer, Sparkle, Warning } from '@phosphor-icons/react'
import { useKV } from '@github/spark/hooks'
import type { BoardRoomCard } from '@/types/board'
import type { CleanStatus } from '@/types/housekeeping'
import type { PropertySetup } from '@/types/onboarding'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { StatusPill } from '@/components/ui/status-pill'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useRoomSync } from '@/hooks/use-room-sync'
import { createAuditRecord, type AuditRecord } from '@/lib/hotel/operations'
import { formatBangkokTime, useI18n } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

type HousekeepingFilter = 'ALL' | 'DIRTY' | 'CLEANING' | 'CLEAN' | 'INSPECTED' | 'PRIORITY'

function getHousekeepingStatus(room: BoardRoomCard): 'DIRTY' | 'CLEANING' | 'CLEAN' | 'INSPECTED' | 'MAINTENANCE' {
  if (room.operationalStatus === 'OUT_OF_ORDER' || room.hasIssue) return 'MAINTENANCE'
  if (room.housekeepingStatus === 'CLEANING') return 'CLEANING'
  return room.cleanStatus
}

function getRoomPriority(room: BoardRoomCard) {
  if (room.operationalStatus === 'OUT_OF_ORDER' || room.hasIssue) return 95
  if (room.isDepartureToday && room.isArrivalToday) return 90
  if (room.isArrivalToday && room.cleanStatus !== 'INSPECTED') return 80
  if (room.isDepartureToday) return 70
  if (room.cleanStatus === 'DIRTY') return 60
  if (room.housekeepingStatus === 'CLEANING') return 50
  return 10
}

function getContextLabel(room: BoardRoomCard, t: ReturnType<typeof useI18n>['t']) {
  if (room.isDepartureToday && room.isArrivalToday) return `${t('housekeeping.departureToday')} / ${t('housekeeping.arrivalToday')}`
  if (room.isArrivalToday) return t('housekeeping.arrivalToday')
  if (room.isDepartureToday) return t('housekeeping.departureToday')
  if (room.guestName) return t('housekeeping.stayover')
  return t('housekeeping.vacant')
}

function sortRoomsForHousekeeping(a: BoardRoomCard, b: BoardRoomCard) {
  const priorityDiff = getRoomPriority(b) - getRoomPriority(a)
  return priorityDiff !== 0 ? priorityDiff : Number(a.number) - Number(b.number)
}

export function HousekeepingBoardView() {
  const { t, language } = useI18n()
  const { rooms, updateRoomStatus, setRooms } = useRoomSync()
  const [filter, setFilter] = useState<HousekeepingFilter>('ALL')
  const [auditRecords, setAuditRecords] = useKV<AuditRecord[]>('audit-records', [])
  const [propertyData] = useKV<PropertySetup>('onboarding-property', {} as PropertySetup)

  const operationalRooms = rooms

  const counts = useMemo(() => ({
    dirty: operationalRooms.filter((room) => getHousekeepingStatus(room) === 'DIRTY').length,
    cleaning: operationalRooms.filter((room) => getHousekeepingStatus(room) === 'CLEANING').length,
    clean: operationalRooms.filter((room) => getHousekeepingStatus(room) === 'CLEAN').length,
    inspected: operationalRooms.filter((room) => getHousekeepingStatus(room) === 'INSPECTED').length,
    priority: operationalRooms.filter((room) => getRoomPriority(room) >= 70).length,
  }), [operationalRooms])

  const filteredRooms = useMemo(() => {
    return operationalRooms
      .filter((room) => {
        const status = getHousekeepingStatus(room)
        if (filter === 'ALL') return true
        if (filter === 'PRIORITY') return getRoomPriority(room) >= 70
        return status === filter
      })
      .sort(sortRoomsForHousekeeping)
  }, [filter, operationalRooms])

  const addAudit = (record: AuditRecord) => {
    setAuditRecords((current) => [record, ...(current || [])].slice(0, 200))
  }

  const updateStatus = (room: BoardRoomCard, status: CleanStatus | 'MAINTENANCE') => {
    if (status === 'MAINTENANCE') {
      setRooms((current) => current.map((currentRoom) => currentRoom.roomId === room.roomId
        ? {
            ...currentRoom,
            operationalStatus: 'OUT_OF_ORDER',
            housekeepingStatus: 'MAINTENANCE',
            hasIssue: true,
            lastUpdatedAt: new Date().toISOString(),
            lastUpdatedBy: 'Housekeeping',
          }
        : currentRoom))
      addAudit(createAuditRecord('housekeeping', room.roomId, 'MAINTENANCE', `Room ${room.number} marked for maintenance.`, 'Housekeeping'))
      toast.success(`Room ${room.number} marked for maintenance.`)
      return
    }

    updateRoomStatus({
      roomId: room.roomId,
      cleanStatus: status,
      lastCleaned: status === 'CLEAN' || status === 'INSPECTED' ? new Date() : room.lastCleaned,
      cleanedBy: 'Housekeeping',
    })

    addAudit(createAuditRecord('housekeeping', room.roomId, status, `Room ${room.number} marked ${status.toLowerCase()}.`, 'Housekeeping'))
    toast.success(`Room ${room.number} marked ${status.toLowerCase()}.`)
  }

  return (
    <div className="min-h-full bg-[#f7f4ef]">
      <section className="border-b bg-white">
        <div className="mx-auto flex max-w-[1600px] flex-col gap-4 px-4 py-5 lg:flex-row lg:items-center lg:justify-between lg:px-6">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-[#9a6535]">
              <Broom size={15} weight="bold" />
              {propertyData?.name || 'Hotel'}
            </div>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight">{t('housekeeping.title')}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{t('housekeeping.subtitle')}</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <FilterButton active={filter === 'ALL'} onClick={() => setFilter('ALL')} label="All" />
            <FilterButton active={filter === 'PRIORITY'} onClick={() => setFilter('PRIORITY')} label={`${t('housekeeping.priority')} ${counts.priority}`} />
            <FilterButton active={filter === 'DIRTY'} onClick={() => setFilter('DIRTY')} label={`${t('rooms.dirty')} ${counts.dirty}`} />
            <FilterButton active={filter === 'CLEANING'} onClick={() => setFilter('CLEANING')} label={`${t('housekeeping.startCleaning')} ${counts.cleaning}`} />
            <FilterButton active={filter === 'INSPECTED'} onClick={() => setFilter('INSPECTED')} label={`${t('housekeeping.inspect')} ${counts.inspected}`} />
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-[1600px] space-y-4 px-4 py-4 lg:px-6">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <SummaryCard label={t('rooms.dirty')} value={counts.dirty} icon={Warning} tone="border-orange-100 bg-orange-50 text-orange-700" />
          <SummaryCard label={t('housekeeping.startCleaning')} value={counts.cleaning} icon={Broom} tone="border-cyan-100 bg-cyan-50 text-cyan-700" />
          <SummaryCard label={t('housekeeping.markClean')} value={counts.clean} icon={Sparkle} tone="border-green-100 bg-green-50 text-green-700" />
          <SummaryCard label={t('housekeeping.inspect')} value={counts.inspected} icon={Eye} tone="border-teal-100 bg-teal-50 text-teal-700" />
          <SummaryCard label={t('housekeeping.priority')} value={counts.priority} icon={ClipboardText} tone="border-rose-100 bg-rose-50 text-rose-700" />
        </div>

        <Card className="rounded-lg bg-white py-0 shadow-sm">
          <CardContent className="p-0">
            {filteredRooms.length === 0 ? (
              <EmptyState className="m-4" icon={<FunnelSimple size={32} weight="thin" />} title={t('housekeeping.noRooms')} />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40">
                    <TableHead className="w-[110px]">{t('common.room')}</TableHead>
                    <TableHead>{t('common.status')}</TableHead>
                    <TableHead>{t('housekeeping.guestContext')}</TableHead>
                    <TableHead>{t('housekeeping.priority')}</TableHead>
                    <TableHead>{t('today.lastUpdated')}</TableHead>
                    <TableHead>{t('housekeeping.updatedBy')}</TableHead>
                    <TableHead className="text-right">{t('common.actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredRooms.map((room) => {
                    const status = getHousekeepingStatus(room)
                    const priority = getRoomPriority(room)
                    return (
                      <TableRow key={room.roomId} className={cn(priority >= 70 && 'bg-amber-50/40')}>
                        <TableCell>
                          <div className="text-base font-semibold tabular-nums">{room.number}</div>
                          <div className="text-[11px] font-medium uppercase text-muted-foreground">{room.type}</div>
                        </TableCell>
                        <TableCell>
                          <StatusPill group="housekeeping" status={status} />
                        </TableCell>
                        <TableCell>
                          <div className="font-medium">{getContextLabel(room, t)}</div>
                          <div className="text-xs text-muted-foreground">{room.guestName || t('housekeeping.vacant')}</div>
                        </TableCell>
                        <TableCell>
                          <span className={cn('rounded-md px-2 py-1 text-xs font-semibold', priority >= 80 ? 'bg-rose-100 text-rose-800' : priority >= 60 ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-700')}>
                            {priority >= 80 ? 'High' : priority >= 60 ? 'Normal' : 'Low'}
                          </span>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {room.lastUpdatedAt ? formatBangkokTime(room.lastUpdatedAt, language) : t('common.none')}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {room.lastUpdatedBy || t('common.none')}
                        </TableCell>
                        <TableCell>
                          <div className="flex justify-end gap-1.5">
                            {status === 'DIRTY' && (
                              <Button size="sm" variant="outline" onClick={() => updateStatus(room, 'CLEANING')}>
                                {t('housekeeping.startCleaning')}
                              </Button>
                            )}
                            {(status === 'DIRTY' || status === 'CLEANING') && (
                              <Button size="sm" onClick={() => updateStatus(room, 'CLEAN')}>
                                {t('housekeeping.markClean')}
                              </Button>
                            )}
                            {status === 'CLEAN' && (
                              <Button size="sm" onClick={() => updateStatus(room, 'INSPECTED')}>
                                {t('housekeeping.inspect')}
                              </Button>
                            )}
                            {status !== 'DIRTY' && (
                              <Button size="sm" variant="outline" onClick={() => updateStatus(room, 'DIRTY')}>
                                {t('housekeeping.markDirty')}
                              </Button>
                            )}
                            <Button size="sm" variant="outline" onClick={() => updateStatus(room, 'MAINTENANCE')} aria-label={t('housekeeping.maintenance')}>
                              <Hammer size={14} />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <div className="text-xs text-muted-foreground">
          {auditRecords.length > 0 ? `${t('reservation.timeline')}: ${auditRecords[0].message}` : t('common.taxInclusive')}
        </div>
      </div>
    </div>
  )
}

function FilterButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <Button
      size="sm"
      variant={active ? 'default' : 'outline'}
      onClick={onClick}
      className="h-8"
    >
      {label}
    </Button>
  )
}

function SummaryCard({ label, value, icon: Icon, tone }: { label: string; value: number; icon: Icon; tone: string }) {
  return (
    <Card className="rounded-lg bg-white py-0">
      <CardContent className="flex items-center justify-between p-4">
        <div>
          <div className="text-xs font-semibold text-muted-foreground">{label}</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
        </div>
        <div className={cn('flex h-10 w-10 items-center justify-center rounded-md border', tone)}>
          <Icon size={20} weight="duotone" />
        </div>
      </CardContent>
    </Card>
  )
}
