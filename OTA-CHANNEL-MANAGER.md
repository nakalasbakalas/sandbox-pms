# OTA / Channel Manager Architecture
## Sandbox Hotel PMS

---

## Executive Summary

The Channel Manager is a **first-class PMS module** that connects Sandbox Hotel's inventory, rates, and restrictions to external distribution channels (Booking.com, Agoda, Expedia, Airbnb) using a **provider-adapter architecture**.

### Core Principles
- **Inventory integrity first**: no overbooking, all mutations transaction-safe
- **Provider-agnostic core**: new channels added without rewriting PMS logic
- **Observability-driven**: every sync action tracked, every error visible
- **Manager-friendly**: clear health states, actionable warnings, simple configuration
- **Phased rollout**: implement incrementally, validate at each stage

---

## 1. Architecture Overview

### Provider-Adapter Pattern

```
┌─────────────────────────────────────────────────────────────┐
│                         PMS Core                            │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ Inventory   │  │ Reservations │  │ Rate Engine  │      │
│  │ Controller  │  │ Controller   │  │              │      │
│  └─────────────┘  └──────────────┘  └──────────────┘      │
└────────────────────────────┬────────────────────────────────┘
                             │
        ┌────────────────────┴────────────────────┐
        │    Channel Manager Core Layer           │
        │                                         │
        │  ┌─────────────────────────────────┐   │
        │  │  Channel Orchestrator           │   │
        │  │  - sync scheduling              │   │
        │  │  - conflict detection           │   │
        │  │  - reservation normalization    │   │
        │  │  - mapping resolution           │   │
        │  └─────────────────────────────────┘   │
        │                                         │
        │  ┌─────────────────────────────────┐   │
        │  │  Provider Adapter Contract      │   │
        │  │  - authenticate()               │   │
        │  │  - pullReservations()           │   │
        │  │  - pushInventory()              │   │
        │  │  - pushRates()                  │   │
        │  │  - pushRestrictions()           │   │
        │  │  - testConnection()             │   │
        │  └─────────────────────────────────┘   │
        └────────────────┬────────────────────────┘
                         │
        ┌────────────────┴────────────────────┐
        │                                     │
   ┌────▼─────┐  ┌────────┐  ┌─────────┐  ┌──────────┐
   │ Booking  │  │ Agoda  │  │ Expedia │  │ Airbnb   │
   │ Adapter  │  │Adapter │  │ Adapter │  │ Adapter  │
   └──────────┘  └────────┘  └─────────┘  └──────────┘
```

### Why This Architecture?

1. **Separation of concerns**: PMS logic never touches provider-specific details
2. **Easy extension**: new providers implement the contract, plug in
3. **Testability**: mock adapters for testing without hitting live APIs
4. **Maintainability**: provider changes don't cascade through the system
5. **Observability**: instrumentation at the contract layer catches all activity

---

## 2. Provider Adapter Contract

### Core Interface

```typescript
interface ChannelProvider {
  // Metadata
  id: string                          // 'booking-com', 'agoda', etc.
  name: string                        // 'Booking.com'
  capabilities: ProviderCapabilities
  
  // Lifecycle
  authenticate(config: ProviderConfig): Promise<AuthResult>
  testConnection(config: ProviderConfig): Promise<TestResult>
  
  // Reservation Pull
  pullReservations(params: PullParams): Promise<ReservationPullResult>
  
  // Inventory Push
  pushInventory(params: InventoryPushParams): Promise<PushResult>
  
  // Rate Push
  pushRates(params: RatePushParams): Promise<PushResult>
  
  // Restriction Push
  pushRestrictions(params: RestrictionPushParams): Promise<PushResult>
  
  // Metadata
  getRoomTypes(): Promise<ExternalRoomType[]>
  getRatePlans(): Promise<ExternalRatePlan[]>
}

interface ProviderCapabilities {
  supportsReservationPull: boolean
  supportsInventoryPush: boolean
  supportsRatePush: boolean
  supportsRestrictionPush: boolean
  supportsMinStay: boolean
  supportsMaxStay: boolean
  supportsClosedToArrival: boolean
  supportsClosedToDeparture: boolean
  supportsStopSell: boolean
  requiresRoomMapping: boolean
  requiresRatePlanMapping: boolean
  pollingIntervalMinutes: number      // recommended poll frequency
}

interface ProviderConfig {
  providerId: string
  environment: 'sandbox' | 'live'
  credentials: Record<string, string>  // provider-specific
  propertyId: string
  endpoint?: string
  customSettings?: Record<string, unknown>
}

interface AuthResult {
  success: boolean
  message?: string
  expiresAt?: Date
}

interface TestResult {
  success: boolean
  latencyMs: number
  message?: string
  warnings?: string[]
}
```

### Normalized Reservation Format

All providers must normalize their reservation data into this internal format:

```typescript
interface NormalizedReservation {
  // External IDs
  externalId: string                  // provider's reservation ID
  externalConfirmationCode?: string   // guest-facing code
  providerId: string                  // 'booking-com', etc.
  
  // Dates
  checkIn: Date
  checkOut: Date
  
  // Guest
  guest: {
    firstName: string
    lastName: string
    email?: string
    phone?: string
    nationality?: string
    specialRequests?: string
  }
  
  // Room
  externalRoomTypeId: string          // provider's room type ID
  externalRatePlanId?: string         // provider's rate plan ID
  numberOfRooms: number               // usually 1
  
  // Occupancy
  adults: number
  children: number
  
  // Financials
  totalAmount: number
  currency: string
  commission?: number
  alreadyPaid: number                 // amount collected by OTA
  paymentDueAtProperty: number
  
  // Status
  status: 'confirmed' | 'modified' | 'cancelled'
  
  // Metadata
  bookedAt: Date
  modifiedAt?: Date
  cancelledAt?: Date
  source: string
  
  // Raw data for debugging
  raw?: Record<string, unknown>
}
```

---

## 3. Data Model

### Channel Configuration

```sql
-- Core channel config
CREATE TABLE channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES properties(id),
  provider_id VARCHAR(50) NOT NULL,  -- 'booking-com', 'agoda', etc.
  provider_name VARCHAR(100) NOT NULL,
  
  -- State
  status VARCHAR(20) NOT NULL DEFAULT 'inactive',  -- active, inactive, error
  environment VARCHAR(10) NOT NULL DEFAULT 'sandbox',  -- sandbox, live
  
  -- Config
  property_external_id VARCHAR(100),  -- hotel ID in provider's system
  credentials JSONB NOT NULL,         -- encrypted, provider-specific
  endpoint VARCHAR(500),
  custom_settings JSONB,
  
  -- Sync toggles
  reservation_pull_enabled BOOLEAN DEFAULT true,
  inventory_push_enabled BOOLEAN DEFAULT false,
  rate_push_enabled BOOLEAN DEFAULT false,
  restriction_push_enabled BOOLEAN DEFAULT false,
  
  -- Health
  last_sync_at TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  last_failure_at TIMESTAMPTZ,
  last_failure_reason TEXT,
  health_state VARCHAR(20) DEFAULT 'unknown',  -- healthy, degraded, error, unknown
  consecutive_failures INT DEFAULT 0,
  
  -- Audit
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID REFERENCES users(id),
  
  UNIQUE(property_id, provider_id)
);

CREATE INDEX idx_channels_property ON channels(property_id);
CREATE INDEX idx_channels_status ON channels(status);
CREATE INDEX idx_channels_health ON channels(health_state);
```

### Room Type Mapping

```sql
-- Internal room type ↔ External room type mapping
CREATE TABLE channel_room_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  
  -- Internal
  room_type_id UUID NOT NULL REFERENCES room_types(id),
  
  -- External
  external_room_type_id VARCHAR(100) NOT NULL,
  external_room_type_name VARCHAR(200),
  
  -- Defaults
  default_occupancy INT DEFAULT 2,
  max_occupancy INT DEFAULT 3,
  
  -- State
  is_active BOOLEAN DEFAULT true,
  last_verified_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(channel_id, room_type_id),
  UNIQUE(channel_id, external_room_type_id)
);

CREATE INDEX idx_room_mappings_channel ON channel_room_mappings(channel_id);
CREATE INDEX idx_room_mappings_room_type ON channel_room_mappings(room_type_id);
```

### Rate Plan Mapping

```sql
-- Internal rate plan ↔ External rate plan mapping
CREATE TABLE channel_rate_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  
  -- Internal (optional - some hotels use base rates only)
  rate_plan_id UUID REFERENCES rate_plans(id),
  
  -- External
  external_rate_plan_id VARCHAR(100) NOT NULL,
  external_rate_plan_name VARCHAR(200),
  
  -- Room type scope
  room_type_id UUID REFERENCES room_types(id),
  
  -- Pricing rules
  rate_type VARCHAR(20) DEFAULT 'derived',  -- base, derived
  markup_percentage DECIMAL(5,2),
  markup_fixed DECIMAL(10,2),
  
  -- Restrictions
  supports_min_stay BOOLEAN DEFAULT true,
  supports_max_stay BOOLEAN DEFAULT true,
  supports_cta BOOLEAN DEFAULT true,
  supports_ctd BOOLEAN DEFAULT true,
  supports_stop_sell BOOLEAN DEFAULT true,
  
  -- State
  is_active BOOLEAN DEFAULT true,
  last_verified_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(channel_id, external_rate_plan_id)
);

CREATE INDEX idx_rate_mappings_channel ON channel_rate_mappings(channel_id);
CREATE INDEX idx_rate_mappings_room_type ON channel_rate_mappings(room_type_id);
```

### Sync Operations Log

```sql
-- Track every sync operation
CREATE TABLE channel_sync_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  
  -- Operation
  operation_type VARCHAR(50) NOT NULL,  -- pull_reservations, push_inventory, etc.
  trigger_type VARCHAR(20) NOT NULL,    -- manual, scheduled, auto
  triggered_by UUID REFERENCES users(id),
  
  -- Timing
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  duration_ms INT,
  
  -- Result
  status VARCHAR(20) NOT NULL,  -- success, partial, failed
  records_processed INT DEFAULT 0,
  records_succeeded INT DEFAULT 0,
  records_failed INT DEFAULT 0,
  
  -- Details
  summary TEXT,
  errors JSONB,  -- array of error objects
  warnings JSONB,  -- array of warning objects
  metadata JSONB,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sync_logs_channel ON channel_sync_logs(channel_id, started_at DESC);
CREATE INDEX idx_sync_logs_status ON channel_sync_logs(status);
CREATE INDEX idx_sync_logs_started ON channel_sync_logs(started_at DESC);
```

### Imported Reservations

```sql
-- Track imported OTA reservations before they become internal reservations
CREATE TABLE channel_imported_reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id UUID NOT NULL REFERENCES channels(id),
  
  -- External IDs
  external_id VARCHAR(200) NOT NULL,
  external_confirmation_code VARCHAR(100),
  
  -- Import state
  import_status VARCHAR(20) NOT NULL DEFAULT 'pending',  
    -- pending, reviewing, accepted, rejected, conflict
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  processed_by UUID REFERENCES users(id),
  
  -- Normalized data
  normalized_data JSONB NOT NULL,
  
  -- Mapping resolution
  resolved_room_type_id UUID REFERENCES room_types(id),
  resolved_rate_plan_id UUID REFERENCES rate_plans(id),
  
  -- Conflict handling
  conflict_type VARCHAR(50),  -- inventory_conflict, duplicate, invalid_mapping, etc.
  conflict_details JSONB,
  resolution_notes TEXT,
  
  -- Link to created reservation
  reservation_id UUID REFERENCES reservations(id),
  
  -- Audit
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(channel_id, external_id)
);

CREATE INDEX idx_imported_reservations_channel ON channel_imported_reservations(channel_id);
CREATE INDEX idx_imported_reservations_status ON channel_imported_reservations(import_status);
CREATE INDEX idx_imported_reservations_imported ON channel_imported_reservations(imported_at DESC);
CREATE INDEX idx_imported_reservations_reservation ON channel_imported_reservations(reservation_id);
```

### Channel Health Checks

```sql
-- Proactive health monitoring
CREATE TABLE channel_health_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  
  check_type VARCHAR(50) NOT NULL,  -- connection, credentials, mapping, sync
  checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  status VARCHAR(20) NOT NULL,  -- pass, warn, fail
  message TEXT,
  details JSONB,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_health_checks_channel ON channel_health_checks(channel_id, checked_at DESC);
```

---

## 4. Sync Lifecycle Model

### Reservation Pull Flow

```
┌─────────────────────────────────────────────────────────────┐
│ 1. TRIGGER PULL                                             │
│    - Manual trigger from UI                                 │
│    - Scheduled job (every 5-15 min depending on provider)   │
│    - Webhook from provider (if supported)                   │
└────────────────────────┬────────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────────┐
│ 2. AUTHENTICATE & PULL                                      │
│    - Use provider adapter                                   │
│    - Pull new/modified reservations since last sync         │
│    - Normalize to internal format                           │
└────────────────────────┬────────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────────┐
│ 3. RESOLVE MAPPINGS                                         │
│    - Map external room type → internal room type            │
│    - Map external rate plan → internal rate plan (if used)  │
│    - If no mapping found: flag for manual review            │
└────────────────────────┬────────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────────┐
│ 4. CONFLICT DETECTION                                       │
│    - Check for duplicate (same external ID already exists)  │
│    - Check inventory availability                           │
│    - Check business rules (no-overbooking, blackout, etc.)  │
│    - If conflict: move to review queue                      │
└────────────────────────┬────────────────────────────────────┘
                         │
                ┌────────┴────────┐
                │                 │
┌───────────────▼──────┐  ┌───────▼──────────────────────────┐
│ 5A. AUTO-ACCEPT      │  │ 5B. MANUAL REVIEW                │
│     - No conflicts   │  │     - Conflicts detected         │
│     - Create res     │  │     - Manager resolves           │
│     - Allocate inv   │  │     - Override or reject         │
│     - Transaction    │  │     - Audit trail                │
└──────────────────────┘  └──────────────────────────────────┘
```

### Inventory Push Flow

```
┌─────────────────────────────────────────────────────────────┐
│ 1. TRIGGER PUSH                                             │
│    - Manual trigger from UI                                 │
│    - Inventory change event (reservation, cancellation)     │
│    - Scheduled sync (e.g., nightly for full reconciliation) │
└────────────────────────┬────────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────────┐
│ 2. CALCULATE AVAILABILITY                                   │
│    - For each room type + date range                        │
│    - Available = Total - Allocated - Blocked                │
│    - Apply channel allocation % if configured               │
└────────────────────────┬────────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────────┐
│ 3. RESOLVE MAPPINGS                                         │
│    - Internal room type → external room type(s)             │
│    - Internal rate plan → external rate plan(s)             │
└────────────────────────┬────────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────────┐
│ 4. PUSH TO PROVIDER                                         │
│    - Use provider adapter                                   │
│    - Send availability updates                              │
│    - Handle partial success                                 │
│    - Retry on transient failures                            │
└────────────────────────┬────────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────────┐
│ 5. LOG & UPDATE STATE                                       │
│    - Record sync log entry                                  │
│    - Update channel health state                            │
│    - Alert on repeated failures                             │
└─────────────────────────────────────────────────────────────┘
```

### Rate Push Flow

```
┌─────────────────────────────────────────────────────────────┐
│ 1. TRIGGER PUSH                                             │
│    - Manual trigger                                         │
│    - Rate rule change event                                 │
│    - Scheduled sync (e.g., nightly)                         │
└────────────────────────┬────────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────────┐
│ 2. CALCULATE RATES                                          │
│    - For each room type + rate plan + date range            │
│    - Apply base rates, rules, adjustments                   │
│    - Apply channel markup if configured                     │
└────────────────────────┬────────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────────┐
│ 3. RESOLVE MAPPINGS                                         │
│    - Internal room type → external room type                │
│    - Internal rate plan → external rate plan                │
└────────────────────────┬────────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────────┐
│ 4. PUSH TO PROVIDER                                         │
│    - Use provider adapter                                   │
│    - Send rate updates                                      │
│    - Handle partial success                                 │
└────────────────────────┬────────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────────┐
│ 5. LOG & UPDATE STATE                                       │
└─────────────────────────────────────────────────────────────┘
```

---

## 5. Conflict Handling Model

### Conflict Types

```typescript
enum ConflictType {
  DUPLICATE_RESERVATION = 'duplicate_reservation',
  INVENTORY_UNAVAILABLE = 'inventory_unavailable',
  UNMAPPED_ROOM_TYPE = 'unmapped_room_type',
  UNMAPPED_RATE_PLAN = 'unmapped_rate_plan',
  INVALID_DATES = 'invalid_dates',
  BLACKOUT_PERIOD = 'blackout_period',
  MINIMUM_STAY_VIOLATION = 'minimum_stay_violation',
  CLOSED_TO_ARRIVAL = 'closed_to_arrival',
  DATA_VALIDATION_ERROR = 'data_validation_error',
}
```

### Resolution Strategies

```typescript
interface ConflictResolution {
  strategy: 'auto_accept' | 'manual_review' | 'auto_reject'
  reason: string
  requiresManagerApproval: boolean
  suggestedActions?: string[]
}

// Example conflict detection logic
function detectConflicts(
  normalized: NormalizedReservation,
  channel: Channel,
  mappings: ChannelMapping
): Conflict[] {
  const conflicts: Conflict[] = []
  
  // 1. Check for duplicate
  const existing = await findByExternalId(
    channel.id,
    normalized.externalId
  )
  if (existing) {
    conflicts.push({
      type: ConflictType.DUPLICATE_RESERVATION,
      severity: 'error',
      message: 'Reservation already imported',
      resolution: 'auto_reject'
    })
    return conflicts  // Stop here, this is fatal
  }
  
  // 2. Resolve room type mapping
  const roomTypeMapping = mappings.roomTypes.find(
    m => m.externalRoomTypeId === normalized.externalRoomTypeId
  )
  if (!roomTypeMapping) {
    conflicts.push({
      type: ConflictType.UNMAPPED_ROOM_TYPE,
      severity: 'error',
      message: `No mapping for room type: ${normalized.externalRoomTypeId}`,
      resolution: 'manual_review',
      suggestedActions: [
        'Create room type mapping in Channel Settings',
        'Reject this reservation'
      ]
    })
    return conflicts  // Can't proceed without mapping
  }
  
  // 3. Check inventory availability
  const available = await checkInventoryAvailability(
    roomTypeMapping.roomTypeId,
    normalized.checkIn,
    normalized.checkOut
  )
  if (!available) {
    conflicts.push({
      type: ConflictType.INVENTORY_UNAVAILABLE,
      severity: 'critical',
      message: 'No inventory available for requested dates',
      resolution: 'manual_review',
      suggestedActions: [
        'Check for sold-out dates',
        'Check for blocked/OOS rooms',
        'Override if this is a channel overbooking error',
        'Contact channel support'
      ]
    })
  }
  
  // 4. Check blackout periods
  const blackout = await checkBlackoutPeriod(
    roomTypeMapping.roomTypeId,
    normalized.checkIn,
    normalized.checkOut
  )
  if (blackout) {
    conflicts.push({
      type: ConflictType.BLACKOUT_PERIOD,
      severity: 'warning',
      message: 'Reservation falls within blackout period',
      resolution: 'manual_review'
    })
  }
  
  // 5. Validate dates
  if (normalized.checkIn >= normalized.checkOut) {
    conflicts.push({
      type: ConflictType.INVALID_DATES,
      severity: 'error',
      message: 'Check-in must be before check-out',
      resolution: 'auto_reject'
    })
  }
  
  return conflicts
}
```

### Review Queue

Reservations with conflicts move to a **Review Queue** where managers can:

- See all conflict details
- Review suggested actions
- Override inventory allocation (with permission)
- Reject reservation (with reason)
- Request more information from channel
- Accept with modifications

All resolutions are **audited** and require **explicit manager action**.

---

## 6. Health State Model

### Health States

```typescript
enum ChannelHealthState {
  HEALTHY = 'healthy',        // All syncs working, no errors
  DEGRADED = 'degraded',      // Some warnings, partial failures
  ERROR = 'error',            // Critical failures, needs attention
  UNKNOWN = 'unknown',        // Not yet tested or no recent data
  DISABLED = 'disabled',      // Intentionally turned off
}
```

### Health Calculation Logic

```typescript
function calculateChannelHealth(channel: Channel): ChannelHealthState {
  if (channel.status === 'inactive') {
    return ChannelHealthState.DISABLED
  }
  
  if (!channel.lastSyncAt) {
    return ChannelHealthState.UNKNOWN
  }
  
  const hoursSinceLastSync = 
    (Date.now() - channel.lastSyncAt.getTime()) / (1000 * 60 * 60)
  
  // No sync in 24 hours = unknown
  if (hoursSinceLastSync > 24) {
    return ChannelHealthState.UNKNOWN
  }
  
  // 5+ consecutive failures = error
  if (channel.consecutiveFailures >= 5) {
    return ChannelHealthState.ERROR
  }
  
  // Recent failure but not consecutive = degraded
  if (channel.lastFailureAt) {
    const hoursSinceFailure = 
      (Date.now() - channel.lastFailureAt.getTime()) / (1000 * 60 * 60)
    if (hoursSinceFailure < 1) {
      return ChannelHealthState.DEGRADED
    }
  }
  
  // Check for mapping completeness
  const mappingWarnings = await checkMappingCompleteness(channel)
  if (mappingWarnings.length > 0) {
    return ChannelHealthState.DEGRADED
  }
  
  return ChannelHealthState.HEALTHY
}
```

### Readiness Checklist

Before a channel can go live, verify:

```typescript
interface ChannelReadiness {
  credentialsValid: boolean
  connectionSuccessful: boolean
  propertyIdVerified: boolean
  roomTypeMappingsComplete: boolean
  ratePlanMappingsComplete: boolean
  testReservationPulled: boolean
  testInventoryPushed: boolean
  testRatePushed: boolean
  allChecksPass: boolean
}
```

---

## 7. Security Model for Secrets

### Credential Storage

```typescript
// NEVER store raw credentials
// Always encrypt at rest

interface EncryptedCredentials {
  encrypted: string      // AES-256-GCM encrypted JSON
  iv: string            // Initialization vector
  tag: string           // Authentication tag
  encryptedAt: Date
  rotatedAt?: Date
}

// Encryption/Decryption service
class CredentialVault {
  private masterKey: Buffer  // From env var, rotated regularly
  
  async encrypt(credentials: Record<string, string>): Promise<EncryptedCredentials> {
    const iv = crypto.randomBytes(16)
    const cipher = crypto.createCipheriv('aes-256-gcm', this.masterKey, iv)
    
    const json = JSON.stringify(credentials)
    const encrypted = Buffer.concat([
      cipher.update(json, 'utf8'),
      cipher.final()
    ])
    
    return {
      encrypted: encrypted.toString('base64'),
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      encryptedAt: new Date()
    }
  }
  
  async decrypt(encrypted: EncryptedCredentials): Promise<Record<string, string>> {
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      this.masterKey,
      Buffer.from(encrypted.iv, 'base64')
    )
    
    decipher.setAuthTag(Buffer.from(encrypted.tag, 'base64'))
    
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encrypted.encrypted, 'base64')),
      decipher.final()
    ])
    
    return JSON.parse(decrypted.toString('utf8'))
  }
}
```

### Permissions

```typescript
enum ChannelPermission {
  VIEW_CHANNELS = 'channels:view',
  EDIT_CHANNELS = 'channels:edit',
  VIEW_CREDENTIALS = 'channels:view_credentials',
  EDIT_CREDENTIALS = 'channels:edit_credentials',
  TRIGGER_SYNC = 'channels:trigger_sync',
  RESOLVE_CONFLICTS = 'channels:resolve_conflicts',
  VIEW_LOGS = 'channels:view_logs',
}

// Role assignments
const rolePermissions = {
  admin: [
    ...Object.values(ChannelPermission)
  ],
  manager: [
    ChannelPermission.VIEW_CHANNELS,
    ChannelPermission.EDIT_CHANNELS,
    ChannelPermission.TRIGGER_SYNC,
    ChannelPermission.RESOLVE_CONFLICTS,
    ChannelPermission.VIEW_LOGS,
  ],
  front_desk: [
    ChannelPermission.VIEW_CHANNELS,
    ChannelPermission.VIEW_LOGS,
  ],
}
```

### Audit Trail

All credential access and channel configuration changes are logged:

```sql
CREATE TABLE channel_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id UUID REFERENCES channels(id),
  user_id UUID REFERENCES users(id),
  action VARCHAR(50) NOT NULL,  -- view_credentials, update_config, trigger_sync, etc.
  ip_address INET,
  user_agent TEXT,
  details JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_channel_audit_channel ON channel_audit_log(channel_id, created_at DESC);
CREATE INDEX idx_channel_audit_user ON channel_audit_log(user_id, created_at DESC);
```

---

## 8. UX Design

### A. Channel Dashboard

**Purpose**: At-a-glance health and status of all channels

**Layout**: Compact card grid, 2-3 cards per row on desktop

**Each Channel Card Shows**:

```
┌─────────────────────────────────────────────────────┐
│ 🟢 Booking.com                          [•••]       │
│ ─────────────────────────────────────────────────   │
│ Active • Sandbox Mode                               │
│                                                      │
│ Last sync: 5 minutes ago ✓                          │
│ Last success: 5 minutes ago                         │
│                                                      │
│ ⚠️  2 unmapped room types                           │
│ ⚠️  1 pending conflict                              │
│                                                      │
│ [Configure] [Sync Now] [View Logs]                  │
└─────────────────────────────────────────────────────┘
```

**Health State Colors**:
- 🟢 Green = Healthy
- 🟡 Yellow = Degraded
- 🔴 Red = Error
- ⚪ Gray = Unknown/Disabled

**Quick Actions Menu [•••]**:
- Configure
- Test Connection
- Sync Now (with submenu: Reservations / Inventory / Rates / All)
- View Logs
- View Mappings
- Deactivate
- Delete

**Dashboard Summary Bar** (above cards):
```
┌─────────────────────────────────────────────────────┐
│ 📊 Channels Overview                                │
│                                                      │
│ 4 Channels  •  3 Active  •  2 Healthy  •  1 Warning │
│ 12 Pending Conflicts  •  Last sync: 2 min ago       │
│                                                      │
│ [+ Add Channel]                      [Review Queue] │
└─────────────────────────────────────────────────────┘
```

---

### B. Channel Configuration

**Purpose**: Set up and manage a single channel

**Layout**: Full-page form with sections, side panel pattern

**Sections**:

1. **Provider Information** (read-only after creation)
   - Provider name
   - Provider logo
   - Capabilities summary

2. **Connection Details**
   - Property ID (external)
   - Environment (Sandbox / Live) toggle
   - Custom endpoint (if needed)
   - [Test Connection] button with latency feedback

3. **Credentials** (encrypted, masked)
   - Provider-specific fields
   - "Last updated" timestamp
   - [Rotate Credentials] button
   - Show/hide toggle (requires permission)

4. **Sync Settings**
   - ☑️ Enable Reservation Pull (every 15 min)
   - ☑️ Enable Inventory Push (real-time + nightly)
   - ☑️ Enable Rate Push (nightly)
   - ☑️ Enable Restriction Push (nightly)

5. **Health & Status**
   - Current health state badge
   - Last sync summary
   - Consecutive failures count
   - [View Full Logs]

6. **Actions**
   - [Save Changes]
   - [Test Connection]
   - [Sync Now]
   - [Deactivate Channel]

---

### C. Room / Rate Mapping

**Purpose**: Map internal room types and rate plans to external IDs

**Layout**: Two-column mapping table with drag-to-connect feel

**Room Type Mapping Table**:

```
┌─────────────────────────────────────────────────────────────┐
│ Room Type Mapping                          [+ Add Mapping]  │
├─────────────────────────────────────────────────────────────┤
│ Internal Room Type    ↔    External Room Type               │
├─────────────────────────────────────────────────────────────┤
│ Twin Room             ↔    Standard Twin                    │
│ (201-215)                  (ID: TWIN-STD)                   │
│                            Occupancy: 2 / Max: 3            │
│                            [Edit] [Remove]                  │
├─────────────────────────────────────────────────────────────┤
│ Double Room           ↔    Standard Double                  │
│ (301-315)                  (ID: DBL-STD)                    │
│                            Occupancy: 2 / Max: 3            │
│                            [Edit] [Remove]                  │
├─────────────────────────────────────────────────────────────┤
│ ⚠️  Deluxe Suite      ↔    (Not Mapped)                    │
│                            [Map Now]                        │
└─────────────────────────────────────────────────────────────┘
```

**Rate Plan Mapping Table**:

```
┌─────────────────────────────────────────────────────────────┐
│ Rate Plan Mapping                          [+ Add Mapping]  │
├─────────────────────────────────────────────────────────────┤
│ Internal Rate Plan    ↔    External Rate Plan               │
├─────────────────────────────────────────────────────────────┤
│ Base Rate             ↔    Standard Rate                    │
│                            (ID: STANDARD)                   │
│                            Markup: +10%                     │
│                            [Edit] [Remove]                  │
├─────────────────────────────────────────────────────────────┤
│ Early Bird            ↔    Non-Refundable                   │
│                            (ID: NONREF)                     │
│                            Markup: +5%                      │
│                            [Edit] [Remove]                  │
└─────────────────────────────────────────────────────────────┘
```

**Unmapped Warnings**:
- Show clear warning if any active room types are unmapped
- Block channel activation until critical mappings are complete
- Allow "fetch external room types/plans" to pull latest from provider

---

### D. Sync Operations

**Purpose**: Manual sync trigger and sync history

**Manual Sync Panel**:

```
┌─────────────────────────────────────────────────────────────┐
│ Manual Sync                                                 │
├─────────────────────────────────────────────────────────────┤
│ Select operation:                                           │
│  ○ Pull Reservations (last 30 days)                        │
│  ○ Push Inventory (next 90 days)                           │
│  ○ Push Rates (next 90 days)                               │
│  ○ Push Restrictions (next 90 days)                        │
│  ○ Full Sync (all operations)                              │
│                                                              │
│ Date range: [________] to [________]  (optional override)  │
│                                                              │
│ [Start Sync]                           [Preview] (if avail) │
└─────────────────────────────────────────────────────────────┘
```

**Sync History Table**:

```
┌────────────────────────────────────────────────────────────────────┐
│ Sync History                                     [Filter] [Export] │
├────────────────────────────────────────────────────────────────────┤
│ Time           Operation         Trigger  Result   Records  Errors │
├────────────────────────────────────────────────────────────────────┤
│ 5 min ago      Pull Reserv.      Auto     ✓        3        0     │
│ 1 hour ago     Push Inventory    Manual    ✓       90        0     │
│ 2 hours ago    Pull Reserv.      Auto     ⚠️       2        1     │
│ 3 hours ago    Push Rates        Schedule  ✓      180        0     │
└────────────────────────────────────────────────────────────────────┘
```

Click a row to expand details:

```
┌────────────────────────────────────────────────────────────────────┐
│ Sync Details: Pull Reservations - 2 hours ago                     │
├────────────────────────────────────────────────────────────────────┤
│ Status: Partial Success                                            │
│ Duration: 3.2 seconds                                              │
│ Triggered by: Automated Scheduler                                  │
│                                                                     │
│ Summary:                                                            │
│  • 2 reservations pulled                                           │
│  • 1 accepted automatically                                        │
│  • 1 sent to review queue (inventory conflict)                     │
│                                                                     │
│ Errors:                                                             │
│  • Reservation EXT-12345: No inventory available for 2024-03-15   │
│                                                                     │
│ [View Full Log] [View Affected Reservations]                      │
└────────────────────────────────────────────────────────────────────┘
```

---

### E. Reservation Import / Conflict Handling

**Purpose**: Review and resolve imported OTA reservations with conflicts

**Review Queue**:

```
┌────────────────────────────────────────────────────────────────────┐
│ 🔔 Pending Review: 12 Reservations                   [Filter ▾]   │
├────────────────────────────────────────────────────────────────────┤
│ External ID      Guest           Dates          Conflict           │
├────────────────────────────────────────────────────────────────────┤
│ 🔴 EXT-12345    John Smith      Mar 15-17      Inventory N/A      │
│                 Booking.com     Twin Room       → [Review]         │
├────────────────────────────────────────────────────────────────────┤
│ 🟡 EXT-12346    Jane Doe        Mar 20-22      Unmapped Room      │
│                 Agoda           Deluxe          → [Review]         │
├────────────────────────────────────────────────────────────────────┤
│ 🟡 EXT-12347    Bob Jones       Mar 18-19      Blackout Period    │
│                 Expedia         Double Room     → [Review]         │
└────────────────────────────────────────────────────────────────────┘
```

**Conflict Priority Colors**:
- 🔴 Critical (inventory N/A, duplicate)
- 🟡 Warning (unmapped, blackout, validation)
- 🟢 Info (minor warnings, can auto-accept)

**Conflict Detail Panel** (opens on [Review]):

```
┌────────────────────────────────────────────────────────────────────┐
│ Review Reservation: EXT-12345                         [✕ Close]   │
├────────────────────────────────────────────────────────────────────┤
│ Provider: Booking.com                                              │
│ Status: Pending Review                                             │
│ Imported: 2 hours ago                                              │
│                                                                     │
│ Guest Details:                                                      │
│  Name: John Smith                                                  │
│  Email: john@example.com                                           │
│  Phone: +66 812345678                                              │
│  Adults: 2, Children: 0                                            │
│                                                                     │
│ Reservation Details:                                                │
│  Check-in: March 15, 2024                                          │
│  Check-out: March 17, 2024                                         │
│  Nights: 2                                                          │
│  External Room Type: Twin Standard (TWIN-STD)                      │
│  → Mapped to: Twin Room (internal)                                 │
│  Total: 4,800 THB (Paid to OTA: 1,200 THB, Due at property: 3,600)│
│                                                                     │
│ 🔴 Conflicts Detected:                                             │
│  • Inventory Unavailable: No Twin Rooms available for Mar 15-17   │
│                                                                     │
│ Suggested Actions:                                                  │
│  1. Check sold-out status for these dates                          │
│  2. Check for blocked/OOS rooms that could be released             │
│  3. Override allocation if this is channel overbooking error       │
│  4. Contact Booking.com support                                    │
│                                                                     │
│ Resolution:                                                         │
│  ○ Accept with Override (requires Manager permission)              │
│  ○ Reject Reservation                                              │
│  ○ Contact Channel for Clarification                               │
│                                                                     │
│ Resolution Notes:                                                   │
│ [____________________________________________________________]      │
│                                                                     │
│ [Accept] [Reject] [Request Clarification]                         │
└────────────────────────────────────────────────────────────────────┘
```

**Auto-Accept Rules** (configurable):
- No conflicts detected
- Mapping exists
- Inventory available
- No blackout
- Valid dates
- No duplicate

All auto-accepted reservations still appear in activity log for audit.

---

### F. Channel Observability

**Purpose**: Monitor channel health and performance

**Channel Health Dashboard**:

```
┌────────────────────────────────────────────────────────────────────┐
│ Channel Health: Booking.com                                        │
├────────────────────────────────────────────────────────────────────┤
│ Overall State: 🟡 Degraded                                         │
│ Reason: 2 unmapped room types, 1 recent sync failure               │
│                                                                     │
│ Readiness Checklist:                                               │
│  ✅ Credentials valid                                              │
│  ✅ Connection successful (latency: 234ms)                         │
│  ✅ Property ID verified                                           │
│  ⚠️  Room type mappings incomplete (2 unmapped)                    │
│  ✅ Rate plan mappings complete                                    │
│  ✅ Test reservation pulled                                        │
│  ⚠️  Last inventory push failed                                    │
│  ✅ Test rate push successful                                      │
│                                                                     │
│ Sync Performance (Last 7 Days):                                    │
│  • Reservation Pull: 98% success (142/145 syncs)                  │
│  • Inventory Push: 94% success (65/69 syncs)                      │
│  • Rate Push: 100% success (7/7 syncs)                            │
│  • Avg sync duration: 2.1 seconds                                  │
│                                                                     │
│ Recent Activity:                                                    │
│  • 5 min ago: Pull Reservations ✓ (3 records)                     │
│  • 1 hour ago: Push Inventory ✓ (90 records)                      │
│  • 2 hours ago: Pull Reservations ⚠️ (2 records, 1 conflict)      │
│                                                                     │
│ Warnings:                                                           │
│  ⚠️  Room type "Deluxe Suite" not mapped                          │
│  ⚠️  Room type "Family Room" not mapped                           │
│  ⚠️  Last inventory push failed: Connection timeout                │
│                                                                     │
│ [Fix Warnings] [View Full Logs] [Configure]                       │
└────────────────────────────────────────────────────────────────────┘
```

**Metrics to Track**:
- Success rate (%)
- Average sync duration (seconds)
- Records processed per sync
- Error frequency
- Conflict rate
- Unmapped items count
- Credential expiration warnings

---

## 9. Provider-Specific Adapters

### Booking.com Adapter

```typescript
export class BookingComAdapter implements ChannelProvider {
  id = 'booking-com'
  name = 'Booking.com'
  
  capabilities: ProviderCapabilities = {
    supportsReservationPull: true,
    supportsInventoryPush: true,
    supportsRatePush: true,
    supportsRestrictionPush: true,
    supportsMinStay: true,
    supportsMaxStay: true,
    supportsClosedToArrival: true,
    supportsClosedToDeparture: true,
    supportsStopSell: true,
    requiresRoomMapping: true,
    requiresRatePlanMapping: true,
    pollingIntervalMinutes: 15,
  }
  
  async authenticate(config: ProviderConfig): Promise<AuthResult> {
    // Booking.com uses OAuth2 or API key
    const { apiKey, hotelId } = config.credentials
    
    try {
      // Test auth by fetching hotel info
      const response = await fetch(
        `${config.endpoint || 'https://supply-xml.booking.com'}/hotels/${hotelId}`,
        {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
          }
        }
      )
      
      if (response.ok) {
        return { success: true }
      } else {
        return {
          success: false,
          message: `Auth failed: ${response.statusText}`
        }
      }
    } catch (error) {
      return {
        success: false,
        message: error.message
      }
    }
  }
  
  async pullReservations(params: PullParams): Promise<ReservationPullResult> {
    // Implementation details:
    // - Use Booking.com XML API or REST API
    // - Fetch reservations modified since last sync
    // - Normalize to internal format
    // - Handle pagination
    // - Return results
  }
  
  async pushInventory(params: InventoryPushParams): Promise<PushResult> {
    // Implementation details:
    // - Format availability updates per Booking.com spec
    // - Send to ARI endpoint
    // - Handle partial success
    // - Return results
  }
  
  // ... other methods
}
```

### Agoda Adapter

```typescript
export class AgodaAdapter implements ChannelProvider {
  id = 'agoda'
  name = 'Agoda'
  
  capabilities: ProviderCapabilities = {
    supportsReservationPull: true,
    supportsInventoryPush: true,
    supportsRatePush: true,
    supportsRestrictionPush: true,
    supportsMinStay: true,
    supportsMaxStay: false,  // Agoda doesn't support max stay
    supportsClosedToArrival: true,
    supportsClosedToDeparture: false,  // Not supported
    supportsStopSell: true,
    requiresRoomMapping: true,
    requiresRatePlanMapping: true,
    pollingIntervalMinutes: 10,
  }
  
  // Agoda-specific implementation
  // Uses YCS (Yield Control System) API
}
```

### Expedia Adapter

```typescript
export class ExpediaAdapter implements ChannelProvider {
  id = 'expedia'
  name = 'Expedia'
  
  capabilities: ProviderCapabilities = {
    supportsReservationPull: true,
    supportsInventoryPush: true,
    supportsRatePush: true,
    supportsRestrictionPush: true,
    supportsMinStay: true,
    supportsMaxStay: true,
    supportsClosedToArrival: true,
    supportsClosedToDeparture: true,
    supportsStopSell: true,
    requiresRoomMapping: true,
    requiresRatePlanMapping: true,
    pollingIntervalMinutes: 15,
  }
  
  // Expedia-specific implementation
  // Uses EQC (Expedia QuickConnect) API
}
```

### Airbnb / iCal Adapter

```typescript
export class AirbnbICalAdapter implements ChannelProvider {
  id = 'airbnb-ical'
  name = 'Airbnb (iCal)'
  
  capabilities: ProviderCapabilities = {
    supportsReservationPull: true,   // Via iCal parsing
    supportsInventoryPush: true,     // Via iCal export
    supportsRatePush: false,         // Not supported via iCal
    supportsRestrictionPush: false,  // Not supported via iCal
    supportsMinStay: false,
    supportsMaxStay: false,
    supportsClosedToArrival: false,
    supportsClosedToDeparture: false,
    supportsStopSell: false,
    requiresRoomMapping: true,
    requiresRatePlanMapping: false,
    pollingIntervalMinutes: 30,  // iCal sync is slower
  }
  
  async pullReservations(params: PullParams): Promise<ReservationPullResult> {
    // Implementation:
    // - Fetch iCal feed from Airbnb URL
    // - Parse VEVENT blocks
    // - Extract guest name (often masked), dates, etc.
    // - Normalize to internal format
    // - Note: limited data available via iCal
  }
  
  async pushInventory(params: InventoryPushParams): Promise<PushResult> {
    // Implementation:
    // - Generate iCal feed with blocked dates
    // - Expose via public URL that Airbnb can poll
    // - Or push to Airbnb's import endpoint if available
  }
}
```

---

## 10. Phased Implementation Plan

### Phase 0: Foundation (Week 1-2)
**Goal**: Core architecture and data model

- [ ] Define and implement provider adapter contract interface
- [ ] Create channel data model (tables, migrations)
- [ ] Implement credential encryption service
- [ ] Create channel service skeleton (CRUD operations)
- [ ] Set up audit logging
- [ ] Create permissions model

**Deliverable**: Working channel CRUD with encrypted credentials

---

### Phase 1: Single Provider (Week 3-4)
**Goal**: End-to-end flow with Booking.com in sandbox mode

- [ ] Implement Booking.com adapter (sandbox environment)
- [ ] Build channel configuration UI
- [ ] Build room/rate mapping UI
- [ ] Implement test connection functionality
- [ ] Implement manual reservation pull
- [ ] Implement basic conflict detection
- [ ] Create review queue UI

**Deliverable**: Can pull test reservations from Booking.com sandbox, detect conflicts, manually review

---

### Phase 2: Inventory & Rate Push (Week 5-6)
**Goal**: Two-way sync with Booking.com

- [ ] Implement inventory push to Booking.com
- [ ] Implement rate push to Booking.com
- [ ] Implement restriction push (min stay, CTA, CTD, stop-sell)
- [ ] Build sync operation UI
- [ ] Build sync history/logs UI
- [ ] Implement partial success handling
- [ ] Add retry logic for transient failures

**Deliverable**: Can push inventory/rates to Booking.com, see sync history

---

### Phase 3: Automation & Health (Week 7-8)
**Goal**: Automated syncs and health monitoring

- [ ] Implement scheduled sync jobs (reservation pull every 15 min, inventory/rate push nightly)
- [ ] Implement health state calculation
- [ ] Build channel dashboard UI
- [ ] Build channel health/observability UI
- [ ] Implement readiness checklist
- [ ] Add email/Slack alerts for failures
- [ ] Implement consecutive failure detection

**Deliverable**: Channels sync automatically, health visible at-a-glance, alerts on failures

---

### Phase 4: Additional Providers (Week 9-12)
**Goal**: Support Agoda, Expedia, Airbnb

- [ ] Implement Agoda adapter (sandbox)
- [ ] Implement Expedia adapter (sandbox)
- [ ] Implement Airbnb iCal adapter
- [ ] Test each provider end-to-end
- [ ] Document provider-specific quirks
- [ ] Add provider selection UI

**Deliverable**: Support 4 major OTA providers

---

### Phase 5: Production Readiness (Week 13-14)
**Goal**: Ready for live traffic

- [ ] Move Booking.com to live mode
- [ ] Move other providers to live mode
- [ ] Implement webhook support (if providers support it)
- [ ] Performance testing (handle 100+ reservations/day)
- [ ] Security audit (credential storage, access logs)
- [ ] Documentation for operations team
- [ ] Training materials
- [ ] Runbook for common issues

**Deliverable**: Channel Manager live in production

---

### Phase 6: Advanced Features (Future)
**Goal**: Nice-to-haves and optimizations

- [ ] Sync preview (show what will be pushed before committing)
- [ ] Bulk room/rate mapping tools
- [ ] Channel allocation percentages (hold back X% inventory for direct bookings)
- [ ] Rate parity monitoring (alert if rates differ across channels)
- [ ] Channel performance analytics (which channel drives most bookings, revenue)
- [ ] Support for channel manager intermediaries (e.g., SiteMinder, RateGain)
- [ ] Automated conflict resolution rules
- [ ] Machine learning for duplicate detection

---

## 11. Success Metrics

### Technical Metrics
- **Sync success rate**: > 99%
- **Sync duration**: < 5 seconds for typical operations
- **Conflict rate**: < 5% of imported reservations
- **Uptime**: > 99.9%
- **Credential rotation**: every 90 days

### Operational Metrics
- **Time to resolve conflict**: < 10 minutes
- **Manual intervention rate**: < 10% of imported reservations
- **Channel health**: > 90% of time in "healthy" state
- **Mapping completeness**: 100% before go-live

### Business Metrics
- **OTA bookings auto-imported**: > 95%
- **Double-booking incidents**: 0
- **Revenue leakage from sync failures**: 0
- **Time saved vs. manual entry**: > 80%

---

## 12. Risk Mitigation

### Risk 1: Provider API Changes
**Likelihood**: High (APIs change frequently)
**Impact**: High (could break sync)
**Mitigation**:
- Subscribe to provider API changelogs
- Use API versioning where available
- Implement graceful degradation
- Monitor error patterns for API changes
- Maintain sandbox environments for testing

### Risk 2: Credential Compromise
**Likelihood**: Low
**Impact**: Critical (unauthorized access to OTA accounts)
**Mitigation**:
- Encrypt at rest
- Audit all credential access
- Rotate regularly
- Use least-privilege API keys
- Monitor for suspicious activity

### Risk 3: Sync Failures Leading to Overbooking
**Likelihood**: Medium
**Impact**: Critical (damages reputation, costs money)
**Mitigation**:
- Fail closed (if uncertain, don't accept reservation)
- Transaction-safe inventory allocation
- Alert on sync failures immediately
- Manual review queue for conflicts
- Never override no-overbooking rule automatically

### Risk 4: Performance Degradation Under Load
**Likelihood**: Medium
**Impact**: Medium (slow syncs, delayed reservations)
**Mitigation**:
- Async job processing
- Rate limiting on provider APIs
- Caching where appropriate
- Database indexing
- Load testing before go-live

### Risk 5: Incomplete Mappings
**Likelihood**: High (new room types added on OTA side)
**Impact**: Medium (reservations stuck in review queue)
**Mitigation**:
- Alert when unmapped room types detected
- Provide easy mapping UI
- Prevent channel activation until critical mappings exist
- Document mapping process clearly

---

## 13. Testing Strategy

### Unit Tests
- Provider adapter methods (mock HTTP calls)
- Conflict detection logic
- Health state calculation
- Credential encryption/decryption
- Mapping resolution

### Integration Tests
- Full sync flow with sandbox APIs
- Reservation normalization
- Inventory push with real data
- Rate push with real data
- Error handling and retries

### End-to-End Tests
- Configure channel → pull reservation → auto-accept
- Configure channel → pull reservation → conflict → manual review → accept
- Push inventory → verify received by provider
- Push rates → verify received by provider

### Performance Tests
- Sync 1,000 reservations in < 30 seconds
- Push inventory for 90 days × 30 rooms in < 10 seconds
- Handle 10 concurrent syncs without degradation

### Security Tests
- Credential encryption at rest
- Audit log completeness
- Permission enforcement
- SQL injection prevention
- XSS prevention in UI

---

## 14. Documentation Requirements

### For Developers
- Provider adapter contract specification
- How to add a new provider (step-by-step guide)
- Data model ERD
- API documentation
- Testing guide

### For Operations Team
- Channel setup guide (per provider)
- How to resolve common conflicts
- How to interpret health states
- Troubleshooting guide
- Escalation procedures

### For Users (Hotel Staff)
- Channel manager user guide
- How to configure a channel
- How to review and resolve conflicts
- How to trigger manual syncs
- FAQ

---

## Summary

The OTA/Channel Manager is a **strategic, first-class module** that connects Sandbox Hotel to external distribution channels while maintaining **absolute inventory integrity**.

The **provider-adapter architecture** ensures:
- Clean separation between PMS core and channel-specific logic
- Easy addition of new providers
- Testability and maintainability
- Observability at every layer

The **conflict handling model** ensures:
- No silent overbooking
- Explicit manager review for edge cases
- Full audit trail
- Business rule enforcement

The **UX design** ensures:
- Manager-friendly visibility
- Clear health states
- Actionable warnings
- Simple configuration
- Fast conflict resolution

The **phased implementation plan** ensures:
- Incremental delivery
- Validation at each stage
- Manageable scope
- Production readiness

This is **not a generic channel manager**.
This is a **precise, operationally-minded integration layer** built specifically for Sandbox Hotel's needs.

**Strong. Clean. Manager-friendly.**
