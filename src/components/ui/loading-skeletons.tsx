import { Skeleton } from '@/components/ui/skeleton'
import { Card } from '@/components/ui/card'

export function ReservationCardSkeleton() {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between">
        <div className="flex-1 space-y-3">
          <div className="flex items-center gap-3">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-5 w-16" />
            <Skeleton className="h-5 w-20" />
          </div>
          <div className="grid grid-cols-5 gap-4">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
          </div>
        </div>
        <div className="ml-6 space-y-2 text-right">
          <Skeleton className="h-6 w-24" />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-5 w-28" />
        </div>
      </div>
    </Card>
  )
}

export function GuestCardSkeleton() {
  return (
    <Card className="p-4">
      <div className="flex items-start gap-4">
        <Skeleton className="h-12 w-12 rounded-full" />
        <div className="flex-1 space-y-3">
          <div className="flex items-center gap-2">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-5 w-16" />
          </div>
          <div className="grid grid-cols-4 gap-6">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-4 text-right">
          <div className="space-y-1">
            <Skeleton className="h-8 w-12" />
            <Skeleton className="h-3 w-12" />
          </div>
          <div className="space-y-1">
            <Skeleton className="h-8 w-12" />
            <Skeleton className="h-3 w-14" />
          </div>
          <div className="space-y-1">
            <Skeleton className="h-6 w-16" />
            <Skeleton className="h-3 w-12" />
          </div>
        </div>
      </div>
    </Card>
  )
}

export function FolioCardSkeleton() {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between">
        <div className="flex-1 space-y-3">
          <div className="flex items-center gap-3">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-5 w-20" />
            <Skeleton className="h-5 w-16" />
          </div>
          <div className="grid grid-cols-4 gap-4">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
          </div>
        </div>
        <div className="ml-6 min-w-[200px] space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-5 w-24 ml-auto" />
        </div>
      </div>
    </Card>
  )
}

export function RoomCardSkeleton() {
  return (
    <div className="h-16 border border-border rounded-md p-2 space-y-1">
      <Skeleton className="h-4 w-16" />
      <Skeleton className="h-3 w-24" />
    </div>
  )
}

export function StatCardSkeleton() {
  return (
    <Card className="p-3 space-y-1">
      <Skeleton className="h-3 w-20" />
      <Skeleton className="h-8 w-12" />
    </Card>
  )
}

export function TableRowSkeleton({ columns = 5 }: { columns?: number }) {
  return (
    <tr>
      {Array.from({ length: columns }).map((_, i) => (
        <td key={i} className="p-3">
          <Skeleton className="h-4 w-full" />
        </td>
      ))}
    </tr>
  )
}

export function ListSkeleton({ 
  count = 5, 
  type = 'reservation' 
}: { 
  count?: number
  type?: 'reservation' | 'guest' | 'folio' | 'room'
}) {
  const SkeletonComponent = {
    reservation: ReservationCardSkeleton,
    guest: GuestCardSkeleton,
    folio: FolioCardSkeleton,
    room: RoomCardSkeleton
  }[type]

  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonComponent key={i} />
      ))}
    </div>
  )
}
