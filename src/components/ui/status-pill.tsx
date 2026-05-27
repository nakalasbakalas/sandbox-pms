import { Badge } from '@/components/ui/badge'
import { useI18n } from '@/lib/i18n'
import { getStatusDefinition, type StatusGroup } from '@/lib/hotel/status'
import { cn } from '@/lib/utils'

interface StatusPillProps {
  group: StatusGroup
  status: string
  className?: string
}

export function StatusPill({ group, status, className }: StatusPillProps) {
  const { language } = useI18n()
  const definition = getStatusDefinition(group, status)

  return (
    <Badge
      variant="outline"
      className={cn('gap-1.5 border text-[11px] font-semibold', definition.className, className)}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', definition.dotClassName)} aria-hidden="true" />
      {definition.label[language]}
    </Badge>
  )
}

export function RoomStatusBadge({ status, className }: Omit<StatusPillProps, 'group'>) {
  return <StatusPill group="room" status={status} className={className} />
}
