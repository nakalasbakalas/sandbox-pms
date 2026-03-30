import type { BoardRoomCard, BoardStats } from '@/types/board'

export function generateMockBoardData(): BoardRoomCard[] {
  const rooms: BoardRoomCard[] = []
  
  const twinRooms = Array.from({ length: 15 }, (_, i) => {
    const num = 201 + i
    return num === 216 ? null : num
  }).filter(Boolean) as number[]
  
  const doubleRooms = Array.from({ length: 15 }, (_, i) => {
    const num = 301 + i
    return num === 316 ? null : num
  }).filter(Boolean) as number[]
  
  const allRooms = [...twinRooms, ...doubleRooms]
  
  allRooms.forEach((roomNumber) => {
    const floor = Math.floor(roomNumber / 100)
    const random = Math.random()
    
    let status: BoardRoomCard['status'] = 'VACANT_CLEAN'
    let operationalStatus: BoardRoomCard['operationalStatus'] = 'AVAILABLE'
    let guestName: string | undefined
    let reservationId: string | undefined
    let checkIn: Date | undefined
    let checkOut: Date | undefined
    let guestCount: number | undefined
    let cleanStatus: 'CLEAN' | 'DIRTY' | 'INSPECTED' = 'CLEAN'
    
    if (roomNumber === 216 || roomNumber === 316) {
      operationalStatus = 'OUT_OF_SERVICE'
      status = 'VACANT_CLEAN'
    } else if (random < 0.65) {
      status = 'OCCUPIED'
      guestName = generateGuestName()
      reservationId = `RES${roomNumber}${Math.floor(Math.random() * 1000)}`
      checkIn = new Date(Date.now() - Math.floor(Math.random() * 5) * 24 * 60 * 60 * 1000)
      checkOut = new Date(Date.now() + Math.floor(Math.random() * 7 + 1) * 24 * 60 * 60 * 1000)
      guestCount = Math.floor(Math.random() * 2) + 1
      cleanStatus = Math.random() < 0.3 ? 'DIRTY' : 'CLEAN'
      if (cleanStatus === 'DIRTY') {
        status = 'OCCUPIED_DIRTY'
      }
    } else if (random < 0.75) {
      status = 'VACANT_CLEAN'
      cleanStatus = 'CLEAN'
    } else if (random < 0.85) {
      status = 'VACANT_DIRTY'
      cleanStatus = 'DIRTY'
    } else if (random < 0.92) {
      operationalStatus = 'BLOCKED'
    }
    
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    
    const isArrivalToday = checkIn ? 
      checkIn.getTime() >= today.getTime() && checkIn.getTime() < today.getTime() + 24 * 60 * 60 * 1000 : 
      false
    
    const isDepartureToday = checkOut ? 
      checkOut.getTime() >= today.getTime() && checkOut.getTime() < today.getTime() + 24 * 60 * 60 * 1000 : 
      false
    
    const nightsRemaining = checkOut ? 
      Math.ceil((checkOut.getTime() - Date.now()) / (24 * 60 * 60 * 1000)) : 
      undefined
    
    const isVIP = Math.random() < 0.05
    const hasIssue = Math.random() < 0.03
    const needsAttention = hasIssue || (isDepartureToday && cleanStatus === 'DIRTY')
    
    const depositRandom = Math.random()
    const depositStatus = 
      status === 'OCCUPIED' ? 
        (depositRandom < 0.7 ? 'PAID' : depositRandom < 0.9 ? 'PENDING' : 'NONE') : 
        'NONE'
    
    const balanceDue = 
      status === 'OCCUPIED' && depositStatus !== 'PAID' ? 
        Math.floor(Math.random() * 5000) + 1000 : 
        undefined
    
    rooms.push({
      roomId: `room-${roomNumber}`,
      number: String(roomNumber),
      floor,
      type: floor === 2 ? 'TWIN' : 'DOUBLE',
      status,
      operationalStatus,
      guestName,
      reservationId,
      checkIn,
      checkOut,
      nightsRemaining,
      guestCount,
      isArrivalToday,
      isDepartureToday,
      isVIP,
      hasIssue,
      needsAttention,
      cleanStatus,
      depositStatus,
      balanceDue,
    })
  })
  
  return rooms.sort((a, b) => Number(a.number) - Number(b.number))
}

function generateGuestName(): string {
  const firstNames = ['John', 'Sarah', 'Michael', 'Emma', 'David', 'Lisa', 'James', 'Anna', 'Robert', 'Maria', 'Tom', 'Kate', 'Chris', 'Nina', 'Alex']
  const lastNames = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Miller', 'Davis', 'Garcia', 'Rodriguez', 'Wilson', 'Martinez', 'Anderson', 'Taylor', 'Thomas', 'Moore']
  
  const firstName = firstNames[Math.floor(Math.random() * firstNames.length)]
  const lastName = lastNames[Math.floor(Math.random() * lastNames.length)]
  
  return `${firstName} ${lastName}`
}

export function calculateBoardStats(rooms: BoardRoomCard[]): BoardStats {
  const activeRooms = rooms.filter(r => r.operationalStatus === 'AVAILABLE')
  const occupied = rooms.filter(r => r.status === 'OCCUPIED' || r.status === 'OCCUPIED_DIRTY').length
  const vacant = rooms.filter(r => (r.status === 'VACANT_CLEAN' || r.status === 'VACANT_DIRTY') && r.operationalStatus === 'AVAILABLE').length
  const arrivalsToday = rooms.filter(r => r.isArrivalToday).length
  const departuresToday = rooms.filter(r => r.isDepartureToday).length
  const dirty = rooms.filter(r => r.cleanStatus === 'DIRTY').length
  const outOfService = rooms.filter(r => r.operationalStatus === 'OUT_OF_SERVICE' || r.operationalStatus === 'BLOCKED').length
  
  return {
    totalRooms: activeRooms.length,
    occupied,
    vacant,
    arrivalsToday,
    departuresToday,
    dirty,
    outOfService,
    occupancyRate: activeRooms.length > 0 ? (occupied / activeRooms.length) * 100 : 0,
  }
}
