# Sandbox Hotel PMS — Technical Architecture

**Production-Ready, Modular, Maintainable System Design**

---

## Executive Summary

This document defines the complete technical architecture for Sandbox Hotel PMS: a greenfield, production-grade property management system built for speed, clarity, and operational excellence.

**Core Philosophy:** Modular architecture, strong domain boundaries, clean separation of concerns, production-minded from day one.

**Not:** Monolithic god files, circular dependencies, duplicated business logic, or prototype code promoted to production.

---

## 1. Recommended Stack

### Frontend
- **Next.js 15** (App Router)
- **React 19** + TypeScript
- **Tailwind CSS v4** + shadcn components
- **TanStack Query (React Query)** for server state
- **Zustand** for complex client state (board interactions, UI state)
- **Zod** for runtime validation
- **React Hook Form** for form management
- **date-fns** for date manipulation

### Backend
- **Next.js API Routes** (Edge/Node.js runtime)
- **PostgreSQL 16** (managed: Vercel Postgres, Supabase, or Railway)
- **Prisma ORM** for type-safe database access
- **NextAuth.js v5** for authentication
- **Zod** for API validation

### Real-Time
- **Server-Sent Events (SSE)** for board/status updates
- **Fallback: Polling** (every 5s) if SSE unavailable
- **Future:** WebSockets for high-frequency operations (optional v2)

### Infrastructure
- **Vercel** (primary deployment target)
- **GitHub Actions** (CI/CD)
- **Sentry** (error tracking)
- **Vercel Analytics** (performance monitoring)

### Developer Tools
- **TypeScript 5.7** (strict mode)
- **ESLint + Prettier**
- **Vitest** (unit/integration tests)
- **Playwright** (E2E tests)
- **Husky** (pre-commit hooks)

---

## 2. Architecture Rationale

### Why Next.js?
- **Unified codebase:** Frontend + backend in one repo, shared types, unified deployment
- **Server components:** Faster initial loads, reduced client JS, better SEO for guest-facing pages
- **API routes:** Simple backend for small hotel operations, scales to dedicated services if needed
- **Edge runtime:** Low-latency API responses for critical operations
- **Vercel integration:** Deploy with zero config, automatic previews, edge caching

### Why PostgreSQL + Prisma?
- **Strong data integrity:** ACID transactions, foreign key constraints, unique indexes prevent double-booking
- **Complex queries:** Joins, aggregations, date ranges — hotel data is relational
- **Type safety:** Prisma generates TypeScript types from schema, catches errors at compile time
- **Migrations:** Version-controlled schema changes, safe production deploys
- **Performance:** Indexes on high-frequency queries (room availability, date ranges)

### Why SSE over WebSockets?
- **Simpler:** Unidirectional server→client, no connection management complexity
- **Sufficient:** Board updates are infrequent (status changes, check-ins), not real-time chat
- **HTTP-friendly:** Works through proxies, firewalls, CDNs
- **Fallback:** Graceful degradation to polling on older browsers/networks
- **Future-proof:** Can add WebSockets later if bidirectional real-time needed

### Why Modular Architecture?
- **AI agent-friendly:** Clear domain boundaries, predictable file locations, minimal context needed
- **Team scalability:** Multiple devs work on different modules without conflicts
- **Testability:** Each module isolated, easy to mock dependencies
- **Maintainability:** Bug in reservations doesn't touch housekeeping code
- **Refactorability:** Can extract modules to microservices if growth demands

---

## 3. Frontend Architecture

### Next.js App Structure
```
app/
├── (auth)/                    # Auth group (login, logout)
│   ├── login/
│   │   └── page.tsx
│   └── layout.tsx             # Auth layout (centered, no sidebar)
├── (dashboard)/               # Main app group (protected routes)
│   ├── board/
│   │   └── page.tsx           # Room board (default home)
│   ├── reservations/
│   │   ├── page.tsx           # Reservation list
│   │   ├── [id]/page.tsx      # Reservation detail
│   │   └── new/page.tsx       # Create reservation
│   ├── guests/
│   │   ├── page.tsx           # Guest list
│   │   └── [id]/page.tsx      # Guest profile
│   ├── housekeeping/
│   │   └── page.tsx           # Housekeeping board
│   ├── cashier/
│   │   ├── page.tsx           # Cashier dashboard
│   │   └── folios/[id]/page.tsx
│   ├── rates/
│   │   └── page.tsx           # Rate management
│   ├── reports/
│   │   └── page.tsx           # Analytics
│   ├── admin/
│   │   ├── settings/page.tsx
│   │   ├── users/page.tsx
│   │   └── audit/page.tsx
│   └── layout.tsx             # Dashboard layout (sidebar, header)
├── api/                       # API routes (backend)
│   ├── auth/[...nextauth]/    # NextAuth handlers
│   ├── board/
│   │   ├── route.ts           # GET board state
│   │   └── stream/route.ts    # SSE endpoint
│   ├── reservations/
│   │   ├── route.ts           # List/create reservations
│   │   └── [id]/route.ts      # Update/delete reservation
│   ├── rooms/
│   │   ├── route.ts           # List rooms
│   │   └── [id]/status/route.ts  # Update room status
│   ├── guests/                # Guest CRUD
│   ├── folios/                # Financial operations
│   └── reports/               # Analytics queries
└── layout.tsx                 # Root layout (fonts, providers)
```

### Component Architecture
```
src/
├── components/
│   ├── ui/                    # shadcn components (untouched)
│   ├── board/                 # Board-specific components
│   │   ├── RoomCard.tsx
│   │   ├── RoomGrid.tsx
│   │   ├── ActivityPanel.tsx
│   │   └── TodayStats.tsx
│   ├── reservations/
│   │   ├── ReservationForm.tsx
│   │   ├── ReservationList.tsx
│   │   └── ReservationDetail.tsx
│   ├── guests/
│   │   ├── GuestForm.tsx
│   │   ├── GuestProfile.tsx
│   │   └── StayHistory.tsx
│   ├── cashier/
│   │   ├── Folio.tsx
│   │   ├── PaymentForm.tsx
│   │   └── InvoicePrint.tsx
│   ├── shared/                # Shared across modules
│   │   ├── DataTable.tsx
│   │   ├── SearchBar.tsx
│   │   ├── StatusBadge.tsx
│   │   ├── DateRangePicker.tsx
│   │   └── ConfirmDialog.tsx
│   └── layout/                # Layout components
│       ├── Sidebar.tsx
│       ├── Header.tsx
│       └── PageContainer.tsx
```

### State Management Strategy

**Server State (TanStack Query):**
- Reservations, guests, rooms, folios, reports
- Automatic caching, revalidation, optimistic updates
- Invalidation on mutations

```typescript
// Example: Board state hook
export function useBoardState() {
  return useQuery({
    queryKey: ['board', 'state'],
    queryFn: async () => {
      const res = await fetch('/api/board')
      return res.json()
    },
    refetchInterval: 5000, // Fallback polling
    staleTime: 3000,
  })
}

// Example: Check-in mutation
export function useCheckIn() {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: async (data: CheckInInput) => {
      const res = await fetch('/api/reservations/check-in', {
        method: 'POST',
        body: JSON.stringify(data),
      })
      return res.json()
    },
    onMutate: async (data) => {
      // Optimistic update
      await queryClient.cancelQueries({ queryKey: ['board', 'state'] })
      const previous = queryClient.getQueryData(['board', 'state'])
      queryClient.setQueryData(['board', 'state'], (old) => ({
        ...old,
        rooms: updateRoomStatus(old.rooms, data.roomId, 'OCCUPIED'),
      }))
      return { previous }
    },
    onError: (err, data, context) => {
      // Rollback on error
      queryClient.setQueryData(['board', 'state'], context.previous)
    },
    onSettled: () => {
      // Refetch after mutation
      queryClient.invalidateQueries({ queryKey: ['board', 'state'] })
    },
  })
}
```

**Client State (Zustand):**
- UI state: sidebar collapsed, density mode, selected room
- Board interactions: drag state, multi-select
- User preferences: theme, shortcuts

```typescript
// Example: Board UI store
interface BoardStore {
  selectedRoomId: string | null
  densityMode: 'compact' | 'comfortable'
  selectRoom: (id: string) => void
  clearSelection: () => void
  setDensityMode: (mode: 'compact' | 'comfortable') => void
}

export const useBoardStore = create<BoardStore>((set) => ({
  selectedRoomId: null,
  densityMode: 'compact',
  selectRoom: (id) => set({ selectedRoomId: id }),
  clearSelection: () => set({ selectedRoomId: null }),
  setDensityMode: (mode) => set({ densityMode: mode }),
}))
```

---

## 4. Backend Architecture

### API Layer Structure

**Domain-Driven API Organization:**
```
app/api/
├── board/
│   ├── route.ts               # GET current board state
│   └── stream/route.ts        # SSE endpoint for live updates
├── reservations/
│   ├── route.ts               # GET list, POST create
│   ├── [id]/route.ts          # GET/PATCH/DELETE reservation
│   ├── [id]/check-in/route.ts # POST check-in action
│   ├── [id]/check-out/route.ts# POST check-out action
│   ├── availability/route.ts  # POST check availability
│   └── calculate/route.ts     # POST calculate pricing
├── rooms/
│   ├── route.ts               # GET all rooms
│   └── [id]/
│       ├── route.ts           # GET/PATCH room
│       └── status/route.ts    # PATCH room status
├── guests/
│   ├── route.ts               # GET list, POST create
│   ├── [id]/route.ts          # GET/PATCH/DELETE guest
│   └── search/route.ts        # GET search guests
├── folios/
│   ├── route.ts               # GET list
│   ├── [id]/route.ts          # GET folio
│   ├── [id]/charge/route.ts   # POST add charge
│   └── [id]/payment/route.ts  # POST record payment
├── reports/
│   ├── occupancy/route.ts     # GET occupancy report
│   ├── revenue/route.ts       # GET revenue report
│   └── housekeeping/route.ts  # GET housekeeping metrics
└── admin/
    ├── users/route.ts         # User management
    └── settings/route.ts      # System settings
```

### Service Layer (Business Logic)

**Clean separation from API routes:**
```
src/services/
├── reservation.service.ts     # Reservation business logic
├── room.service.ts            # Room management
├── guest.service.ts           # Guest operations
├── pricing.service.ts         # Rate calculation
├── folio.service.ts           # Billing logic
├── housekeeping.service.ts    # Room status management
├── availability.service.ts    # Availability checks
└── report.service.ts          # Analytics queries
```

**Example: Reservation Service**
```typescript
// src/services/reservation.service.ts
import { prisma } from '@/lib/db'
import { pricingService } from './pricing.service'
import { availabilityService } from './availability.service'

export const reservationService = {
  async create(input: CreateReservationInput) {
    // 1. Validate availability
    const available = await availabilityService.checkAvailability({
      checkIn: input.checkIn,
      checkOut: input.checkOut,
      roomType: input.roomType,
    })
    
    if (!available) {
      throw new ReservationError('No rooms available for selected dates')
    }
    
    // 2. Calculate pricing
    const pricing = await pricingService.calculate({
      checkIn: input.checkIn,
      checkOut: input.checkOut,
      roomType: input.roomType,
      adults: input.adults,
      children: input.children,
      childAges: input.childAges,
    })
    
    // 3. Create reservation + folio in transaction
    return prisma.$transaction(async (tx) => {
      const reservation = await tx.reservation.create({
        data: {
          guestId: input.guestId,
          checkIn: input.checkIn,
          checkOut: input.checkOut,
          roomType: input.roomType,
          adults: input.adults,
          children: input.children,
          status: 'CONFIRMED',
        },
      })
      
      const folio = await tx.folio.create({
        data: {
          reservationId: reservation.id,
          lineItems: {
            create: pricing.breakdown.map((item) => ({
              date: item.date,
              description: item.description,
              amount: item.amount,
            })),
          },
        },
      })
      
      return { reservation, folio, pricing }
    })
  },
  
  async checkIn(reservationId: string, roomId: string) {
    return prisma.$transaction(async (tx) => {
      // 1. Verify room is clean and available
      const room = await tx.room.findUnique({ where: { id: roomId } })
      if (room.status !== 'VACANT_CLEAN') {
        throw new ReservationError('Room is not ready for check-in')
      }
      
      // 2. Update reservation
      const reservation = await tx.reservation.update({
        where: { id: reservationId },
        data: { 
          status: 'CHECKED_IN',
          assignedRoomId: roomId,
          actualCheckIn: new Date(),
        },
      })
      
      // 3. Update room status
      await tx.room.update({
        where: { id: roomId },
        data: { 
          status: 'OCCUPIED',
          currentReservationId: reservationId,
        },
      })
      
      return reservation
    })
  },
  
  // ... more methods
}
```

### Repository Pattern (Optional)

For very complex queries, add a repository layer:
```typescript
// src/repositories/reservation.repository.ts
import { prisma } from '@/lib/db'

export const reservationRepository = {
  async findByDateRange(checkIn: Date, checkOut: Date) {
    return prisma.reservation.findMany({
      where: {
        OR: [
          { checkIn: { gte: checkIn, lt: checkOut } },
          { checkOut: { gt: checkIn, lte: checkOut } },
          { checkIn: { lte: checkIn }, checkOut: { gte: checkOut } },
        ],
      },
      include: { guest: true, room: true },
    })
  },
  
  // More complex queries...
}
```

---

## 5. API/Service Strategy

### API Design Principles

1. **RESTful conventions** — GET/POST/PATCH/DELETE with resource-based URLs
2. **Action endpoints for operations** — `/check-in`, `/check-out`, `/calculate` (not CRUD)
3. **Consistent response format** — `{ data, error, meta }`
4. **Validation at API boundary** — Zod schemas on all inputs
5. **Type-safe responses** — Shared types between frontend/backend

### Request/Response Types

```typescript
// src/types/api.ts
export interface ApiResponse<T> {
  data?: T
  error?: ApiError
  meta?: {
    page?: number
    total?: number
    timestamp: string
  }
}

export interface ApiError {
  code: string
  message: string
  details?: Record<string, any>
}

// Example: Check-in endpoint types
export interface CheckInRequest {
  reservationId: string
  roomId: string
  actualCheckIn?: Date
  notes?: string
}

export interface CheckInResponse {
  reservation: Reservation
  room: Room
}
```

### Validation Schema

```typescript
// src/schemas/reservation.schema.ts
import { z } from 'zod'

export const createReservationSchema = z.object({
  guestId: z.string().uuid(),
  checkIn: z.coerce.date(),
  checkOut: z.coerce.date(),
  roomType: z.enum(['TWIN', 'DOUBLE']),
  adults: z.number().min(1).max(3),
  children: z.number().min(0).max(2),
  childAges: z.array(z.number().min(0).max(17)).optional(),
  notes: z.string().max(1000).optional(),
}).refine((data) => data.checkOut > data.checkIn, {
  message: 'Check-out must be after check-in',
  path: ['checkOut'],
})

// Use in API route
export async function POST(req: Request) {
  const body = await req.json()
  const validated = createReservationSchema.parse(body) // Throws if invalid
  // ... proceed
}
```

### Error Handling

```typescript
// src/lib/errors.ts
export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number = 400,
    public details?: Record<string, any>
  ) {
    super(message)
    this.name = 'AppError'
  }
}

export class ReservationError extends AppError {
  constructor(message: string, details?: Record<string, any>) {
    super('RESERVATION_ERROR', message, 400, details)
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id: string) {
    super('NOT_FOUND', `${resource} with ID ${id} not found`, 404)
  }
}

// Global error handler (middleware)
export function errorHandler(error: unknown): Response {
  if (error instanceof AppError) {
    return Response.json({
      error: {
        code: error.code,
        message: error.message,
        details: error.details,
      },
    }, { status: error.status })
  }
  
  // Unexpected error
  console.error('Unexpected error:', error)
  return Response.json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    },
  }, { status: 500 })
}
```

---

## 6. Auth/Session Strategy

### NextAuth.js v5 Configuration

```typescript
// auth.config.ts
import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import { prisma } from '@/lib/db'
import bcrypt from 'bcryptjs'

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Credentials({
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        const user = await prisma.user.findUnique({
          where: { email: credentials.email },
          include: { role: true },
        })
        
        if (!user) return null
        
        const valid = await bcrypt.compare(credentials.password, user.passwordHash)
        if (!valid) return null
        
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role.name,
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.role = user.role
      }
      return token
    },
    async session({ session, token }) {
      session.user.role = token.role
      return session
    },
  },
  pages: {
    signIn: '/login',
  },
})
```

### Role-Based Access Control

```typescript
// src/lib/auth.ts
export type Role = 'ADMIN' | 'MANAGER' | 'FRONT_DESK' | 'HOUSEKEEPING' | 'CASHIER'

export const permissions = {
  ADMIN: ['*'], // All permissions
  MANAGER: [
    'reservations:read',
    'reservations:create',
    'reservations:update',
    'reservations:delete',
    'rooms:read',
    'rooms:update',
    'guests:read',
    'guests:create',
    'guests:update',
    'folios:read',
    'reports:read',
  ],
  FRONT_DESK: [
    'reservations:read',
    'reservations:create',
    'rooms:read',
    'guests:read',
    'guests:create',
    'folios:read',
  ],
  HOUSEKEEPING: [
    'rooms:read',
    'rooms:update-status',
  ],
  CASHIER: [
    'reservations:read',
    'folios:read',
    'folios:create',
    'folios:update',
    'reports:read',
  ],
}

export function hasPermission(role: Role, permission: string): boolean {
  if (role === 'ADMIN') return true
  return permissions[role]?.includes(permission) ?? false
}

// Middleware for API routes
export async function requirePermission(permission: string) {
  const session = await auth()
  
  if (!session?.user) {
    throw new AppError('UNAUTHORIZED', 'Authentication required', 401)
  }
  
  if (!hasPermission(session.user.role, permission)) {
    throw new AppError('FORBIDDEN', 'Insufficient permissions', 403)
  }
  
  return session.user
}
```

### Protected API Route Example

```typescript
// app/api/reservations/[id]/route.ts
export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const user = await requirePermission('reservations:update')
    const body = await req.json()
    const validated = updateReservationSchema.parse(body)
    
    const reservation = await reservationService.update(params.id, validated)
    
    return Response.json({ data: reservation })
  } catch (error) {
    return errorHandler(error)
  }
}
```

---

## 7. Real-Time Update Strategy

### Server-Sent Events Implementation

**SSE Endpoint:**
```typescript
// app/api/board/stream/route.ts
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const encoder = new TextEncoder()
  
  const stream = new ReadableStream({
    async start(controller) {
      // Send initial connection message
      controller.enqueue(encoder.encode('data: {"type":"connected"}\n\n'))
      
      // Subscribe to board updates (in-memory pub/sub or Redis)
      const unsubscribe = boardEvents.subscribe((update) => {
        const message = `data: ${JSON.stringify(update)}\n\n`
        controller.enqueue(encoder.encode(message))
      })
      
      // Heartbeat to keep connection alive
      const heartbeat = setInterval(() => {
        controller.enqueue(encoder.encode(':heartbeat\n\n'))
      }, 30000)
      
      // Cleanup on disconnect
      req.signal.addEventListener('abort', () => {
        unsubscribe()
        clearInterval(heartbeat)
        controller.close()
      })
    },
  })
  
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
}
```

**Client Hook:**
```typescript
// src/hooks/useBoardStream.ts
export function useBoardStream() {
  const queryClient = useQueryClient()
  
  useEffect(() => {
    const eventSource = new EventSource('/api/board/stream')
    
    eventSource.onmessage = (event) => {
      const update = JSON.parse(event.data)
      
      // Update query cache based on event type
      if (update.type === 'room-status-change') {
        queryClient.setQueryData(['board', 'state'], (old) => ({
          ...old,
          rooms: old.rooms.map((room) =>
            room.id === update.roomId
              ? { ...room, status: update.status }
              : room
          ),
        }))
      }
      
      if (update.type === 'check-in') {
        queryClient.invalidateQueries({ queryKey: ['board', 'state'] })
      }
    }
    
    eventSource.onerror = () => {
      eventSource.close()
      // Fall back to polling
      queryClient.refetchQueries({ queryKey: ['board', 'state'] })
    }
    
    return () => eventSource.close()
  }, [queryClient])
}
```

**Event Publishing:**
```typescript
// src/lib/events.ts
type BoardEvent =
  | { type: 'room-status-change'; roomId: string; status: RoomStatus }
  | { type: 'check-in'; reservationId: string; roomId: string }
  | { type: 'check-out'; reservationId: string; roomId: string }

class BoardEventEmitter {
  private subscribers: Set<(event: BoardEvent) => void> = new Set()
  
  subscribe(callback: (event: BoardEvent) => void) {
    this.subscribers.add(callback)
    return () => this.subscribers.delete(callback)
  }
  
  emit(event: BoardEvent) {
    this.subscribers.forEach((callback) => callback(event))
  }
}

export const boardEvents = new BoardEventEmitter()

// Usage in service
await roomService.updateStatus(roomId, 'VACANT_CLEAN')
boardEvents.emit({ type: 'room-status-change', roomId, status: 'VACANT_CLEAN' })
```

**Scaling Consideration:**
For multi-server deployments, use Redis Pub/Sub:
```typescript
// src/lib/pubsub.ts
import { Redis } from 'ioredis'

const redis = new Redis(process.env.REDIS_URL)

export const pubsub = {
  publish: (channel: string, message: any) => {
    redis.publish(channel, JSON.stringify(message))
  },
  subscribe: (channel: string, callback: (message: any) => void) => {
    const subscriber = new Redis(process.env.REDIS_URL)
    subscriber.subscribe(channel)
    subscriber.on('message', (ch, msg) => {
      if (ch === channel) callback(JSON.parse(msg))
    })
    return () => subscriber.unsubscribe(channel)
  },
}
```

---

## 8. Modular Domain Structure

### Domain Module Pattern

Each domain owns its:
- Data models (Prisma schema section)
- Business logic (service)
- API routes
- Frontend components
- Types/schemas
- Tests

```
src/domains/
├── reservation/
│   ├── schemas/
│   │   ├── create-reservation.schema.ts
│   │   └── update-reservation.schema.ts
│   ├── services/
│   │   ├── reservation.service.ts
│   │   └── pricing.service.ts
│   ├── components/
│   │   ├── ReservationForm.tsx
│   │   └── ReservationList.tsx
│   ├── types.ts
│   └── index.ts              # Public API
├── room/
│   ├── schemas/
│   ├── services/
│   │   ├── room.service.ts
│   │   └── availability.service.ts
│   ├── components/
│   │   ├── RoomCard.tsx
│   │   └── RoomGrid.tsx
│   ├── types.ts
│   └── index.ts
├── guest/
├── folio/
├── housekeeping/
└── report/
```

**Benefits:**
- Clear ownership boundaries
- Easy to locate code
- Module can be extracted to microservice
- New AI agent can work on single domain
- Parallel development without conflicts

---

## 9. Repository/Folder Structure

### Complete Project Structure

```
sandbox-hotel-pms/
├── .github/
│   └── workflows/
│       ├── ci.yml
│       └── deploy.yml
├── app/                       # Next.js app directory
│   ├── (auth)/
│   ├── (dashboard)/
│   ├── api/
│   ├── layout.tsx
│   └── globals.css
├── prisma/
│   ├── schema.prisma          # Database schema
│   ├── seed.ts                # Seed data
│   └── migrations/            # Version-controlled migrations
├── public/
│   ├── fonts/
│   └── images/
├── src/
│   ├── components/            # Shared UI components
│   │   ├── ui/                # shadcn (untouched)
│   │   ├── layout/
│   │   └── shared/
│   ├── domains/               # Domain modules
│   │   ├── reservation/
│   │   ├── room/
│   │   ├── guest/
│   │   ├── folio/
│   │   ├── housekeeping/
│   │   └── report/
│   ├── lib/                   # Shared utilities
│   │   ├── db.ts              # Prisma client
│   │   ├── auth.ts            # Auth utilities
│   │   ├── errors.ts          # Error classes
│   │   ├── events.ts          # Event emitter
│   │   ├── utils.ts           # Generic utils
│   │   └── constants.ts       # App constants
│   ├── hooks/                 # Shared React hooks
│   │   ├── useUser.ts
│   │   ├── useBoardState.ts
│   │   └── useBoardStream.ts
│   ├── stores/                # Zustand stores
│   │   ├── board.store.ts
│   │   └── ui.store.ts
│   └── types/                 # Shared types
│       ├── api.ts
│       ├── models.ts
│       └── index.ts
├── tests/
│   ├── unit/                  # Vitest unit tests
│   ├── integration/           # Vitest integration tests
│   └── e2e/                   # Playwright E2E tests
├── .env.example
├── .env.local                 # Local secrets (gitignored)
├── next.config.js
├── tailwind.config.ts
├── tsconfig.json
├── package.json
└── README.md
```

---

## 10. Deployment Architecture

### Vercel Deployment

**Production Stack:**
- **Compute:** Vercel Edge Functions (API routes)
- **Database:** Vercel Postgres (or Supabase/Railway)
- **Storage:** Vercel Blob (for invoices, reports)
- **Monitoring:** Vercel Analytics + Sentry

**Environment Setup:**
```bash
# Production
POSTGRES_URL=                  # Vercel Postgres connection string
NEXTAUTH_SECRET=               # Generated secret (openssl rand -base64 32)
NEXTAUTH_URL=https://pms.sandboxhotel.com

# Optional
SENTRY_DSN=
REDIS_URL=                     # For multi-server SSE scaling
```

**Deployment Flow:**
1. Push to `main` → Auto-deploy to production
2. Push to `develop` → Auto-deploy to staging
3. Pull requests → Preview deployments

**Database Migrations:**
```bash
# Local development
npx prisma migrate dev

# Production (via GitHub Actions)
npx prisma migrate deploy
```

**GitHub Actions CI/CD:**
```yaml
# .github/workflows/deploy.yml
name: Deploy

on:
  push:
    branches: [main, develop]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: npm run lint
      - run: npm run test
      - run: npx prisma generate
      - run: npm run build

  deploy:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: vercel/actions@v1
        with:
          vercel-token: ${{ secrets.VERCEL_TOKEN }}
          vercel-org-id: ${{ secrets.VERCEL_ORG_ID }}
          vercel-project-id: ${{ secrets.VERCEL_PROJECT_ID }}
```

**Rollback Strategy:**
- Vercel keeps deployment history
- One-click rollback to previous deployment
- Database migrations are forward-only (write reversible migrations)

---

## 11. Environment/Config Strategy

### Environment Variables

```bash
# .env.example
# Database
POSTGRES_URL="postgresql://user:pass@localhost:5432/sandbox_pms"
POSTGRES_URL_NON_POOLING="postgresql://user:pass@localhost:5432/sandbox_pms"

# Auth
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="your-secret-here"

# Optional
REDIS_URL="redis://localhost:6379"
SENTRY_DSN="https://..."

# Feature Flags
ENABLE_SSE="true"
ENABLE_CAFE_MODULE="false"
```

### Runtime Config

```typescript
// src/config/index.ts
export const config = {
  app: {
    name: 'Sandbox Hotel PMS',
    url: process.env.NEXTAUTH_URL || 'http://localhost:3000',
  },
  features: {
    sse: process.env.ENABLE_SSE === 'true',
    cafeModule: process.env.ENABLE_CAFE_MODULE === 'true',
  },
  hotel: {
    name: 'Sandbox Hotel',
    rooms: {
      twin: { numbers: [201, 202, 203, 204, 205, 206, 207, 208, 209, 210, 211, 212, 213, 214, 215], maxOccupancy: 2 },
      double: { numbers: [301, 302, 303, 304, 305, 306, 307, 308, 309, 310, 311, 312, 313, 314, 315], maxOccupancy: 3 },
      outOfService: [216, 316],
    },
    policies: {
      checkInTime: '14:00',
      checkOutTime: '11:00',
      extraGuestFee: 200, // THB
      childFreeAge: 5,
      childFeeAge: 11,
      childFee: 100, // THB
    },
  },
  database: {
    url: process.env.POSTGRES_URL!,
  },
} as const
```

---

## 12. Testing Strategy Baseline

### Unit Tests (Vitest)

**Services/Business Logic:**
```typescript
// tests/unit/services/pricing.service.test.ts
import { describe, it, expect } from 'vitest'
import { pricingService } from '@/domains/reservation/services/pricing.service'

describe('pricingService.calculate', () => {
  it('calculates base rate for 2 adults, 2 nights', async () => {
    const result = await pricingService.calculate({
      checkIn: new Date('2024-01-01'),
      checkOut: new Date('2024-01-03'),
      roomType: 'TWIN',
      adults: 2,
      children: 0,
    })
    
    expect(result.total).toBe(2000) // 1000 per night
    expect(result.breakdown).toHaveLength(2)
  })
  
  it('adds extra guest fee for 3 adults', async () => {
    const result = await pricingService.calculate({
      checkIn: new Date('2024-01-01'),
      checkOut: new Date('2024-01-03'),
      roomType: 'DOUBLE',
      adults: 3,
      children: 0,
    })
    
    expect(result.total).toBe(2400) // 1200 per night (1000 + 200 extra guest)
  })
  
  it('applies child fee for 6-11 age range', async () => {
    const result = await pricingService.calculate({
      checkIn: new Date('2024-01-01'),
      checkOut: new Date('2024-01-03'),
      roomType: 'TWIN',
      adults: 2,
      children: 1,
      childAges: [8],
    })
    
    expect(result.total).toBe(2200) // 1000 + 100 child fee per night
  })
  
  it('does not charge for children 0-5', async () => {
    const result = await pricingService.calculate({
      checkIn: new Date('2024-01-01'),
      checkOut: new Date('2024-01-03'),
      roomType: 'TWIN',
      adults: 2,
      children: 1,
      childAges: [3],
    })
    
    expect(result.total).toBe(2000) // No child fee
  })
})
```

### Integration Tests (Vitest + Test DB)

**API Routes:**
```typescript
// tests/integration/api/reservations.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { testClient } from '@/tests/helpers/test-client'
import { seedTestData } from '@/tests/helpers/seed'

describe('POST /api/reservations', () => {
  beforeEach(async () => {
    await seedTestData()
  })
  
  it('creates reservation with valid data', async () => {
    const response = await testClient.post('/api/reservations', {
      guestId: 'test-guest-id',
      checkIn: '2024-06-01',
      checkOut: '2024-06-03',
      roomType: 'TWIN',
      adults: 2,
      children: 0,
    })
    
    expect(response.status).toBe(201)
    expect(response.data.reservation).toMatchObject({
      status: 'CONFIRMED',
      roomType: 'TWIN',
    })
  })
  
  it('prevents double-booking', async () => {
    // Create first reservation
    await testClient.post('/api/reservations', {
      guestId: 'test-guest-id',
      checkIn: '2024-06-01',
      checkOut: '2024-06-03',
      roomType: 'TWIN',
      adults: 2,
    })
    
    // Try to create overlapping reservation (all twin rooms booked)
    const response = await testClient.post('/api/reservations', {
      guestId: 'test-guest-id-2',
      checkIn: '2024-06-02',
      checkOut: '2024-06-04',
      roomType: 'TWIN',
      adults: 2,
    })
    
    expect(response.status).toBe(400)
    expect(response.error.code).toBe('NO_AVAILABILITY')
  })
})
```

### E2E Tests (Playwright)

**Critical User Flows:**
```typescript
// tests/e2e/check-in.spec.ts
import { test, expect } from '@playwright/test'

test('complete check-in flow', async ({ page }) => {
  // Login
  await page.goto('/login')
  await page.fill('[name="email"]', 'frontdesk@sandboxhotel.com')
  await page.fill('[name="password"]', 'test-password')
  await page.click('button[type="submit"]')
  
  // Navigate to board
  await expect(page).toHaveURL('/board')
  
  // Find today's arrival
  await page.click('text=Jane Doe') // From arrivals list
  
  // Assign room
  await page.click('text=Assign Room')
  await page.click('[data-room="305"]') // Select room 305
  await page.click('button:has-text("Confirm")')
  
  // Complete check-in
  await page.click('button:has-text("Check In")')
  
  // Verify room status changed
  const room305 = page.locator('[data-room="305"]')
  await expect(room305).toHaveAttribute('data-status', 'OCCUPIED')
  await expect(room305).toContainText('Jane Doe')
})

test('prevent check-in to dirty room', async ({ page }) => {
  // ... login and navigate ...
  
  // Try to assign dirty room
  await page.click('[data-room="210"][data-status="VACANT_DIRTY"]')
  
  // Expect warning
  await expect(page.locator('text=Room is not ready')).toBeVisible()
})
```

### Test Coverage Goals

- **Unit tests:** 80%+ coverage of services/business logic
- **Integration tests:** All API routes, critical database operations
- **E2E tests:** Top 10 user flows (check-in, check-out, reservation, room status)

### CI/CD Integration

```bash
# Run all tests in CI
npm run test              # Unit + integration (Vitest)
npm run test:e2e          # E2E (Playwright)

# Coverage report
npm run test:coverage
```

---

## Database Schema (Prisma)

### Core Schema

```prisma
// prisma/schema.prisma

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("POSTGRES_URL")
}

// Users & Auth
model User {
  id           String   @id @default(cuid())
  email        String   @unique
  passwordHash String
  name         String
  role         Role     @relation(fields: [roleId], references: [id])
  roleId       String
  isActive     Boolean  @default(true)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
}

model Role {
  id          String   @id @default(cuid())
  name        String   @unique // ADMIN, MANAGER, FRONT_DESK, etc.
  permissions Json     // Array of permission strings
  users       User[]
}

// Guests
model Guest {
  id           String        @id @default(cuid())
  firstName    String
  lastName     String
  email        String?
  phone        String?
  nationality  String?
  idNumber     String?
  vipStatus    Boolean       @default(false)
  preferences  Json?         // Array of preference strings
  notes        String?
  createdAt    DateTime      @default(now())
  updatedAt    DateTime      @updatedAt
  reservations Reservation[]
  
  @@index([email, phone])
}

// Rooms
model Room {
  id                    String       @id @default(cuid())
  number                Int          @unique
  type                  RoomType
  floor                 Int
  status                RoomStatus
  maxOccupancy          Int
  isAvailable           Boolean      @default(true)
  currentReservationId  String?      @unique
  currentReservation    Reservation? @relation("CurrentOccupancy")
  notes                 String?
  createdAt             DateTime     @default(now())
  updatedAt             DateTime     @updatedAt
  reservations          Reservation[]
  statusHistory         RoomStatusHistory[]
  
  @@index([status, isAvailable])
}

enum RoomType {
  TWIN
  DOUBLE
}

enum RoomStatus {
  OCCUPIED
  VACANT_CLEAN
  VACANT_DIRTY
  OUT_OF_SERVICE
  RESERVED
}

// Reservations
model Reservation {
  id               String            @id @default(cuid())
  confirmationCode String            @unique @default(cuid())
  guest            Guest             @relation(fields: [guestId], references: [id])
  guestId          String
  room             Room?             @relation(fields: [assignedRoomId], references: [id])
  assignedRoomId   String?
  occupiedRoom     Room?             @relation("CurrentOccupancy")
  checkIn          DateTime
  checkOut         DateTime
  actualCheckIn    DateTime?
  actualCheckOut   DateTime?
  status           ReservationStatus
  roomType         RoomType
  adults           Int
  children         Int               @default(0)
  childAges        Json?             // Array of ages
  source           BookingSource
  ratePerNight     Float
  totalAmount      Float
  notes            String?
  createdAt        DateTime          @default(now())
  updatedAt        DateTime          @updatedAt
  folio            Folio?
  
  @@index([checkIn, checkOut])
  @@index([status, checkIn])
}

enum ReservationStatus {
  CONFIRMED
  CHECKED_IN
  CHECKED_OUT
  CANCELLED
  NO_SHOW
}

enum BookingSource {
  WALK_IN
  PHONE
  WEBSITE
  BOOKING_COM
  AGODA
  EXPEDIA
  OTHER
}

// Financials
model Folio {
  id            String        @id @default(cuid())
  reservation   Reservation   @relation(fields: [reservationId], references: [id])
  reservationId String        @unique
  lineItems     FolioItem[]
  payments      Payment[]
  totalAmount   Float
  paidAmount    Float         @default(0)
  balanceDue    Float
  status        FolioStatus
  createdAt     DateTime      @default(now())
  updatedAt     DateTime      @updatedAt
}

model FolioItem {
  id          String   @id @default(cuid())
  folio       Folio    @relation(fields: [folioId], references: [id])
  folioId     String
  date        DateTime
  description String
  amount      Float
  category    String   // ROOM, EXTRA_GUEST, CHILD, CAFE, OTHER
  createdAt   DateTime @default(now())
}

model Payment {
  id            String        @id @default(cuid())
  folio         Folio         @relation(fields: [folioId], references: [id])
  folioId       String
  amount        Float
  method        PaymentMethod
  reference     String?
  processedBy   String        // User ID
  createdAt     DateTime      @default(now())
}

enum FolioStatus {
  OPEN
  CLOSED
  REFUNDED
}

enum PaymentMethod {
  CASH
  CARD
  BANK_TRANSFER
  OTHER
}

// Housekeeping
model RoomStatusHistory {
  id        String     @id @default(cuid())
  room      Room       @relation(fields: [roomId], references: [id])
  roomId    String
  status    RoomStatus
  changedBy String     // User ID
  notes     String?
  createdAt DateTime   @default(now())
  
  @@index([roomId, createdAt])
}

// Settings
model Setting {
  id        String   @id @default(cuid())
  key       String   @unique
  value     Json
  updatedAt DateTime @updatedAt
}
```

---

## Implementation Phases

### Phase 1: Foundation (Week 1-2)
- [ ] Next.js project setup + Tailwind + shadcn
- [ ] Prisma schema + initial migration
- [ ] NextAuth.js setup + role-based permissions
- [ ] Basic layout (sidebar, header)
- [ ] Room board static view

### Phase 2: Core Operations (Week 3-4)
- [ ] Reservation creation flow
- [ ] Guest management
- [ ] Rate calculation service
- [ ] Availability checking logic
- [ ] Room board with real data

### Phase 3: Check-In/Out (Week 5-6)
- [ ] Check-in workflow
- [ ] Check-out workflow
- [ ] Room status updates
- [ ] Today's arrivals/departures panel
- [ ] SSE board updates

### Phase 4: Financials (Week 7-8)
- [ ] Folio generation
- [ ] Payment processing
- [ ] Invoice printing
- [ ] Basic reports

### Phase 5: Polish & Production (Week 9-10)
- [ ] Error handling + validation
- [ ] Unit + integration tests
- [ ] E2E critical flows
- [ ] Performance optimization
- [ ] Production deployment

---

## Key Technical Decisions Summary

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Framework** | Next.js 15 | Unified frontend/backend, server components, Vercel-optimized |
| **Database** | PostgreSQL | Strong data integrity, complex queries, battle-tested |
| **ORM** | Prisma | Type-safe, excellent DX, auto-generated types |
| **Auth** | NextAuth.js v5 | Native Next.js integration, role-based permissions |
| **Real-Time** | SSE | Simpler than WebSockets, sufficient for hotel operations |
| **State** | TanStack Query + Zustand | Server state caching + client UI state |
| **Validation** | Zod | Type-safe runtime validation, shared schemas |
| **Deployment** | Vercel | Zero-config, edge functions, automatic HTTPS |
| **Testing** | Vitest + Playwright | Fast unit tests, comprehensive E2E |

---

## Success Metrics

**Technical:**
- [ ] Board loads in <200ms (30 rooms)
- [ ] API response times <100ms (p95)
- [ ] Zero production errors over 7 days
- [ ] 80%+ test coverage
- [ ] TypeScript strict mode passes

**Operational:**
- [ ] Check-in completes in <45 seconds
- [ ] Search returns results in <100ms
- [ ] Room status updates propagate in <1 second
- [ ] Staff can use system with <30 min training

---

**This architecture is designed to be implemented, not just documented. Every decision prioritizes clarity, maintainability, and production readiness.**
