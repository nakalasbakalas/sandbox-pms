# Sandbox Hotel PMS – Rates & Pricing Architecture

**Version:** 1.0  
**Domain:** Revenue Management, Dynamic Pricing, Rate Rules  
**Status:** Design Complete – Implementation Ready

---

## Philosophy

The Rates module must be **powerful but understandable**.

Rate management is often the most confusing, fragile part of hotel systems. Rates accumulate rules over time, become unpredictable, and staff lose trust in the system.

This design prioritizes:
- **Explainability** – staff must understand why a rate is what it is
- **Auditability** – every rate change must be traceable
- **Safety** – rate rules cannot conflict in unpredictable ways
- **Speed** – common operations must be fast
- **Flexibility** – support complex strategies without rule chaos

---

## 1. Pricing Engine Architecture

### Core Principles

1. **Base Rate + Adjustments = Final Rate**
2. **Rules apply in deterministic order**
3. **Last rule wins for conflicts**
4. **Manual overrides always win**
5. **All calculations are auditable**

### Calculation Flow

```
1. Start with Room Type Base Rate
2. Apply Day-of-Week Adjustment (if exists)
3. Apply Seasonal Adjustment (if exists)
4. Apply Peak/Low Season Adjustment (if exists)
5. Apply Special Event Adjustment (if exists)
6. Apply Long-Stay Discount (if exists)
7. Apply Manual Override (if exists) ← ALWAYS WINS
8. Calculate Extra Guest Fees
9. Calculate Child Fees
10. Apply Deposit Percentage
11. Present Tax-Inclusive Public Price
```

### Rate Precedence Hierarchy

```
MANUAL OVERRIDE (highest precedence)
  ↓
SPECIAL EVENT RATE
  ↓
PEAK/LOW SEASON RATE
  ↓
SEASONAL RATE
  ↓
DAY-OF-WEEK RATE
  ↓
BASE RATE (lowest precedence, foundation)
```

### Rate Composition Model

Every final rate is composed of:
- **Base Component** – the starting rate
- **Applied Adjustments** – list of rules that modified it
- **Final Amount** – what the guest pays
- **Breakdown** – itemized calculation trail

---

## 2. Rate Rule Model

### Base Rate

```typescript
interface BaseRate {
  id: string
  roomTypeId: string
  rate: number // THB per night
  effectiveFrom: Date
  effectiveTo: Date | null // null = indefinite
  status: 'ACTIVE' | 'SCHEDULED' | 'EXPIRED' | 'DISABLED'
  createdBy: string
  createdAt: Date
  notes?: string
}
```

### Rate Adjustment Rule

```typescript
interface RateAdjustmentRule {
  id: string
  name: string // e.g., "Weekend Premium", "Low Season Discount"
  description?: string
  ruleType: RuleType
  priority: number // higher = applied later
  
  // Scope
  roomTypeIds: string[] // empty = all room types
  
  // Date applicability
  dateRanges: DateRange[] // can have multiple windows
  daysOfWeek: DayOfWeek[] // empty = all days
  
  // Adjustment
  adjustmentType: 'PERCENTAGE' | 'FIXED_DELTA' | 'ABSOLUTE_OVERRIDE'
  adjustmentValue: number
  
  // Conditions
  minLengthOfStay?: number
  maxLengthOfStay?: number
  
  // Status
  status: 'ACTIVE' | 'SCHEDULED' | 'EXPIRED' | 'DISABLED'
  
  // Audit
  createdBy: string
  createdAt: Date
  updatedBy?: string
  updatedAt?: Date
  notes?: string
}

type RuleType = 
  | 'DAY_OF_WEEK'
  | 'SEASONAL'
  | 'PEAK_SEASON'
  | 'LOW_SEASON'
  | 'SPECIAL_EVENT'
  | 'LONG_STAY_DISCOUNT'

type DayOfWeek = 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT' | 'SUN'

interface DateRange {
  startDate: Date
  endDate: Date
}
```

### Manual Rate Override

```typescript
interface RateOverride {
  id: string
  roomTypeId: string
  date: Date
  overrideRate: number
  reason: string // REQUIRED
  
  // Restrictions
  stopSell: boolean // prevent new bookings
  closedToArrival: boolean // CTA
  closedToDeparture: boolean // CTD
  minLengthOfStay?: number
  maxLengthOfStay?: number
  
  // Audit
  createdBy: string
  createdAt: Date
  approvedBy?: string // manager approval
  approvedAt?: Date
  notes?: string
}
```

### Long-Stay Discount

```typescript
interface LongStayDiscount {
  id: string
  name: string
  roomTypeIds: string[] // empty = all
  
  // Tiers
  tiers: DiscountTier[]
  
  // Date applicability
  dateRanges: DateRange[]
  
  status: 'ACTIVE' | 'DISABLED'
  createdBy: string
  createdAt: Date
}

interface DiscountTier {
  minNights: number
  discountType: 'PERCENTAGE' | 'FIXED_PER_NIGHT'
  discountValue: number
}

// Example:
// 3-6 nights: 5% off
// 7-13 nights: 10% off
// 14+ nights: 15% off
```

### Extra Guest & Child Fees

```typescript
interface ExtraGuestFeeRule {
  id: string
  roomTypeId: string
  standardOccupancy: number
  maxOccupancy: number
  extraGuestFee: number // per guest per night
  
  effectiveFrom: Date
  effectiveTo: Date | null
  status: 'ACTIVE' | 'DISABLED'
}

interface ChildFeeRule {
  id: string
  roomTypeId: string
  
  ageRanges: ChildAgeRange[]
  
  effectiveFrom: Date
  effectiveTo: Date | null
  status: 'ACTIVE' | 'DISABLED'
}

interface ChildAgeRange {
  minAge: number // inclusive
  maxAge: number // inclusive
  feeType: 'FREE' | 'FIXED' | 'PERCENTAGE_OF_ROOM'
  feeValue: number // 0 for FREE
  sharingBeddingOnly: boolean
}

// Sandbox Hotel default:
// 0-5 years: FREE (sharing bedding)
// 6-11 years: 100 THB/night (sharing bedding)
// 12+: treated as adult (extra guest fee)
```

### Deposit Rule

```typescript
interface DepositRule {
  id: string
  name: string
  
  // Scope
  bookingSourceIds?: string[] // empty = all sources
  roomTypeIds?: string[] // empty = all room types
  
  // Deposit requirement
  depositType: 'PERCENTAGE' | 'FIRST_NIGHT' | 'FIXED_AMOUNT' | 'FULL_AMOUNT'
  depositValue?: number // percentage or fixed amount
  
  // Timing
  dueWithin: number // hours from booking confirmation
  
  effectiveFrom: Date
  effectiveTo: Date | null
  status: 'ACTIVE' | 'DISABLED'
}
```

---

## 3. Rate Calendar UX

### Visual Design

**Calendar Grid:**
```
Room Type | Date 1 | Date 2 | Date 3 | Date 4 | Date 5 | ...
----------|--------|--------|--------|--------|--------|----
Twin      | 1,800  | 1,800  | 2,200↑ | 2,200  | 1,800  |
Double    | 2,200  | 2,200  | 2,800↑ | 2,800  | 2,200  |
```

**Cell Indicators:**
- Base rate: normal text
- Adjusted rate: blue text with ↑ or ↓ indicator
- Override: bold orange text with 🔒 icon
- Warning: red background + ⚠️ icon
- Restriction: yellow border + 🚫 icon (stop-sell, CTA, CTD)

### Bulk Edit Tools

**Select Range:**
1. Click start date
2. Shift+Click end date
3. Apply action to range

**Actions:**
- Set base rate
- Apply percentage adjustment
- Add fixed delta
- Set override
- Copy forward
- Clear overrides
- Set restrictions

**Copy Forward:**
```
Source: March 1-7
Target: March 8-14, 15-21, 22-28
Action: Copy rates + adjustments
```

### Calendar Views

**30-Day View (default):**
- Compact cells
- Room type rows
- Date columns
- Color-coded indicators

**60-Day View:**
- Smaller cells
- Trend visibility
- Seasonal patterns

**90-Day View:**
- Mini cells
- Long-term planning
- Event coordination

### Filters & Controls

**Room Type Filter:**
- All
- Twin only
- Double only

**Date Range:**
- Next 30 days
- Next 60 days
- Next 90 days
- Custom range

**Highlight:**
- Base rates only
- Overrides only
- Warnings only
- Restrictions only

---

## 4. Pricing Logic & Order of Operations

### Rate Calculation Algorithm

```typescript
interface RateCalculationInput {
  roomTypeId: string
  checkInDate: Date
  checkOutDate: Date
  numberOfAdults: number
  numberOfChildren: ChildGuest[]
  bookingSource: 'DIRECT' | 'WALK_IN' | 'OTA' | 'PHONE'
}

interface ChildGuest {
  age: number
  sharingBedding: boolean
}

interface RateCalculationOutput {
  breakdown: RateBreakdownByNight[]
  totalRoomRevenue: number
  totalExtraGuestFees: number
  totalChildFees: number
  subtotal: number
  taxAmount: number
  totalAmount: number
  depositRequired: number
  explanation: RateExplanation
}

interface RateBreakdownByNight {
  date: Date
  baseRate: number
  appliedRules: AppliedRule[]
  finalNightlyRate: number
  extraGuestFee: number
  childFee: number
  nightTotal: number
}

interface AppliedRule {
  ruleId: string
  ruleName: string
  ruleType: RuleType
  adjustmentType: string
  adjustmentValue: number
  beforeAmount: number
  afterAmount: number
}
```

### Calculation Pseudocode

```typescript
function calculateRate(input: RateCalculationInput): RateCalculationOutput {
  const nights = getNightsBetween(input.checkInDate, input.checkOutDate)
  const breakdown: RateBreakdownByNight[] = []
  
  for (const night of nights) {
    // 1. Get base rate for this room type on this date
    let rate = getBaseRate(input.roomTypeId, night)
    const appliedRules: AppliedRule[] = []
    
    // 2. Get all active rules for this date
    const rules = getActiveRulesForDate(
      input.roomTypeId,
      night,
      getDayOfWeek(night)
    )
    
    // 3. Sort rules by priority
    const sortedRules = sortByPriority(rules)
    
    // 4. Apply each rule in order
    for (const rule of sortedRules) {
      const beforeRate = rate
      rate = applyRule(rate, rule)
      
      appliedRules.push({
        ruleId: rule.id,
        ruleName: rule.name,
        ruleType: rule.ruleType,
        adjustmentType: rule.adjustmentType,
        adjustmentValue: rule.adjustmentValue,
        beforeAmount: beforeRate,
        afterAmount: rate
      })
    }
    
    // 5. Check for manual override
    const override = getManualOverride(input.roomTypeId, night)
    if (override) {
      appliedRules.push({
        ruleId: override.id,
        ruleName: 'Manual Override',
        ruleType: 'MANUAL_OVERRIDE',
        adjustmentType: 'ABSOLUTE_OVERRIDE',
        adjustmentValue: override.overrideRate,
        beforeAmount: rate,
        afterAmount: override.overrideRate
      })
      rate = override.overrideRate
    }
    
    // 6. Calculate extra guest fees
    const extraGuestFee = calculateExtraGuestFee(
      input.roomTypeId,
      input.numberOfAdults,
      night
    )
    
    // 7. Calculate child fees
    const childFee = calculateChildFees(
      input.roomTypeId,
      input.numberOfChildren,
      night
    )
    
    breakdown.push({
      date: night,
      baseRate: getBaseRate(input.roomTypeId, night),
      appliedRules,
      finalNightlyRate: rate,
      extraGuestFee,
      childFee,
      nightTotal: rate + extraGuestFee + childFee
    })
  }
  
  // 8. Calculate totals
  const totalRoomRevenue = sum(breakdown.map(b => b.finalNightlyRate))
  const totalExtraGuestFees = sum(breakdown.map(b => b.extraGuestFee))
  const totalChildFees = sum(breakdown.map(b => b.childFee))
  const subtotal = totalRoomRevenue + totalExtraGuestFees + totalChildFees
  
  // 9. Tax is already included in public pricing (Thailand convention)
  const taxAmount = 0 // or calculate if showing breakdown
  const totalAmount = subtotal
  
  // 10. Calculate deposit requirement
  const depositRequired = calculateDeposit(
    totalAmount,
    input.bookingSource,
    input.roomTypeId,
    input.checkInDate
  )
  
  // 11. Generate explanation
  const explanation = generateExplanation(breakdown, input)
  
  return {
    breakdown,
    totalRoomRevenue,
    totalExtraGuestFees,
    totalChildFees,
    subtotal,
    taxAmount,
    totalAmount,
    depositRequired,
    explanation
  }
}
```

### Long-Stay Discount Logic

```typescript
function applyLongStayDiscount(
  baseTotal: number,
  lengthOfStay: number,
  roomTypeId: string,
  dateRange: DateRange
): number {
  const discount = findApplicableLongStayDiscount(
    roomTypeId,
    lengthOfStay,
    dateRange
  )
  
  if (!discount) return baseTotal
  
  const tier = findApplicableTier(discount.tiers, lengthOfStay)
  if (!tier) return baseTotal
  
  if (tier.discountType === 'PERCENTAGE') {
    return baseTotal * (1 - tier.discountValue / 100)
  } else {
    // FIXED_PER_NIGHT
    return baseTotal - (tier.discountValue * lengthOfStay)
  }
}
```

---

## 5. Staff Rate Explanation Model

### Explanation UI Component

**Rate Explanation Panel:**

```
┌─────────────────────────────────────────────────┐
│ Rate Breakdown – Twin Room 205                  │
│ Check-in: Mar 15, 2024 → Check-out: Mar 18     │
│ 3 nights · 2 adults · 1 child (7 years)        │
├─────────────────────────────────────────────────┤
│                                                  │
│ Night 1 – Fri, Mar 15                           │
│ Base Rate                        1,800 THB      │
│ + Weekend Premium (+15%)           270 THB      │
│ Nightly Rate                     2,070 THB      │
│                                                  │
│ Night 2 – Sat, Mar 16                           │
│ Base Rate                        1,800 THB      │
│ + Weekend Premium (+15%)           270 THB      │
│ Nightly Rate                     2,070 THB      │
│                                                  │
│ Night 3 – Sun, Mar 17                           │
│ Base Rate                        1,800 THB      │
│ Nightly Rate                     1,800 THB      │
│                                                  │
│ Room Subtotal                    5,940 THB      │
│                                                  │
│ Extra Guest Fees                     0 THB      │
│ (2 adults = standard occupancy)                 │
│                                                  │
│ Child Fees                         300 THB      │
│ Child age 7 × 3 nights × 100 THB                │
│                                                  │
│ Total Amount                     6,240 THB      │
│ (Tax-inclusive)                                  │
│                                                  │
│ Deposit Required (50%)           3,120 THB      │
│ Due within 24 hours of booking                  │
│                                                  │
└─────────────────────────────────────────────────┘
```

### Manager Override Visibility

```
┌─────────────────────────────────────────────────┐
│ 🔒 Manager Override Applied                     │
│                                                  │
│ Original Rate: 2,070 THB                        │
│ Override Rate: 1,800 THB                        │
│                                                  │
│ Reason: Loyal guest – third stay this year      │
│ Applied by: Manager Sarah                       │
│ Date: Mar 10, 2024 14:30                        │
└─────────────────────────────────────────────────┘
```

### Warning Indicators

```
⚠️ Missing Rate Warning
   No base rate defined for Twin rooms on Mar 25-28

⚠️ Unusual Rate Warning
   Rate for Mar 30 (8,000 THB) is 344% above average

⚠️ Conflicting Rules Warning
   Multiple seasonal rules overlap on Apr 10-15
```

---

## 6. Schema Additions

### New Tables

```sql
-- Base rates for room types
CREATE TABLE base_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_type_id UUID NOT NULL REFERENCES room_types(id),
  rate DECIMAL(10,2) NOT NULL,
  effective_from DATE NOT NULL,
  effective_to DATE,
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  notes TEXT,
  CONSTRAINT valid_rate CHECK (rate >= 0),
  CONSTRAINT valid_date_range CHECK (effective_to IS NULL OR effective_to > effective_from)
);

CREATE INDEX idx_base_rates_room_type ON base_rates(room_type_id);
CREATE INDEX idx_base_rates_effective ON base_rates(effective_from, effective_to);

-- Rate adjustment rules
CREATE TABLE rate_adjustment_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  rule_type VARCHAR(50) NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  
  adjustment_type VARCHAR(50) NOT NULL,
  adjustment_value DECIMAL(10,2) NOT NULL,
  
  min_length_of_stay INTEGER,
  max_length_of_stay INTEGER,
  
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES users(id),
  updated_at TIMESTAMP,
  notes TEXT
);

CREATE INDEX idx_rate_rules_type ON rate_adjustment_rules(rule_type);
CREATE INDEX idx_rate_rules_priority ON rate_adjustment_rules(priority);

-- Room type scope for rules
CREATE TABLE rate_rule_room_types (
  rule_id UUID NOT NULL REFERENCES rate_adjustment_rules(id) ON DELETE CASCADE,
  room_type_id UUID NOT NULL REFERENCES room_types(id) ON DELETE CASCADE,
  PRIMARY KEY (rule_id, room_type_id)
);

-- Date ranges for rules
CREATE TABLE rate_rule_date_ranges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id UUID NOT NULL REFERENCES rate_adjustment_rules(id) ON DELETE CASCADE,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  CONSTRAINT valid_date_range CHECK (end_date >= start_date)
);

CREATE INDEX idx_rate_rule_dates ON rate_rule_date_ranges(rule_id, start_date, end_date);

-- Days of week for rules
CREATE TABLE rate_rule_days_of_week (
  rule_id UUID NOT NULL REFERENCES rate_adjustment_rules(id) ON DELETE CASCADE,
  day_of_week VARCHAR(3) NOT NULL,
  PRIMARY KEY (rule_id, day_of_week)
);

-- Manual rate overrides
CREATE TABLE rate_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_type_id UUID NOT NULL REFERENCES room_types(id),
  date DATE NOT NULL,
  override_rate DECIMAL(10,2) NOT NULL,
  reason TEXT NOT NULL,
  
  stop_sell BOOLEAN NOT NULL DEFAULT FALSE,
  closed_to_arrival BOOLEAN NOT NULL DEFAULT FALSE,
  closed_to_departure BOOLEAN NOT NULL DEFAULT FALSE,
  min_length_of_stay INTEGER,
  max_length_of_stay INTEGER,
  
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  approved_by UUID REFERENCES users(id),
  approved_at TIMESTAMP,
  notes TEXT,
  
  UNIQUE(room_type_id, date)
);

CREATE INDEX idx_rate_overrides_room_date ON rate_overrides(room_type_id, date);

-- Long-stay discounts
CREATE TABLE long_stay_discounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE long_stay_discount_tiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  discount_id UUID NOT NULL REFERENCES long_stay_discounts(id) ON DELETE CASCADE,
  min_nights INTEGER NOT NULL,
  discount_type VARCHAR(50) NOT NULL,
  discount_value DECIMAL(10,2) NOT NULL,
  CONSTRAINT valid_min_nights CHECK (min_nights > 0)
);

CREATE TABLE long_stay_discount_room_types (
  discount_id UUID NOT NULL REFERENCES long_stay_discounts(id) ON DELETE CASCADE,
  room_type_id UUID NOT NULL REFERENCES room_types(id) ON DELETE CASCADE,
  PRIMARY KEY (discount_id, room_type_id)
);

CREATE TABLE long_stay_discount_date_ranges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  discount_id UUID NOT NULL REFERENCES long_stay_discounts(id) ON DELETE CASCADE,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  CONSTRAINT valid_date_range CHECK (end_date >= start_date)
);

-- Extra guest fee rules
CREATE TABLE extra_guest_fee_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_type_id UUID NOT NULL REFERENCES room_types(id),
  standard_occupancy INTEGER NOT NULL,
  max_occupancy INTEGER NOT NULL,
  extra_guest_fee DECIMAL(10,2) NOT NULL,
  
  effective_from DATE NOT NULL,
  effective_to DATE,
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  
  CONSTRAINT valid_occupancy CHECK (max_occupancy >= standard_occupancy)
);

-- Child fee rules
CREATE TABLE child_fee_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_type_id UUID NOT NULL REFERENCES room_types(id),
  effective_from DATE NOT NULL,
  effective_to DATE,
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
);

CREATE TABLE child_age_ranges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  child_fee_rule_id UUID NOT NULL REFERENCES child_fee_rules(id) ON DELETE CASCADE,
  min_age INTEGER NOT NULL,
  max_age INTEGER NOT NULL,
  fee_type VARCHAR(50) NOT NULL,
  fee_value DECIMAL(10,2) NOT NULL DEFAULT 0,
  sharing_bedding_only BOOLEAN NOT NULL DEFAULT FALSE,
  
  CONSTRAINT valid_age_range CHECK (max_age >= min_age AND min_age >= 0)
);

-- Deposit rules
CREATE TABLE deposit_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  deposit_type VARCHAR(50) NOT NULL,
  deposit_value DECIMAL(10,2),
  due_within_hours INTEGER NOT NULL,
  
  effective_from DATE NOT NULL,
  effective_to DATE,
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  
  CONSTRAINT valid_deposit CHECK (
    (deposit_type = 'PERCENTAGE' AND deposit_value BETWEEN 0 AND 100) OR
    (deposit_type = 'FIXED_AMOUNT' AND deposit_value >= 0) OR
    deposit_type IN ('FIRST_NIGHT', 'FULL_AMOUNT')
  )
);

CREATE TABLE deposit_rule_booking_sources (
  deposit_rule_id UUID NOT NULL REFERENCES deposit_rules(id) ON DELETE CASCADE,
  booking_source_id UUID NOT NULL REFERENCES booking_sources(id) ON DELETE CASCADE,
  PRIMARY KEY (deposit_rule_id, booking_source_id)
);

CREATE TABLE deposit_rule_room_types (
  deposit_rule_id UUID NOT NULL REFERENCES deposit_rules(id) ON DELETE CASCADE,
  room_type_id UUID NOT NULL REFERENCES room_types(id) ON DELETE CASCADE,
  PRIMARY KEY (deposit_rule_id, room_type_id)
);

-- Rate calculation audit log
CREATE TABLE rate_calculations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id UUID REFERENCES reservations(id),
  room_type_id UUID NOT NULL REFERENCES room_types(id),
  check_in_date DATE NOT NULL,
  check_out_date DATE NOT NULL,
  
  total_room_revenue DECIMAL(10,2) NOT NULL,
  total_extra_guest_fees DECIMAL(10,2) NOT NULL,
  total_child_fees DECIMAL(10,2) NOT NULL,
  subtotal DECIMAL(10,2) NOT NULL,
  total_amount DECIMAL(10,2) NOT NULL,
  deposit_required DECIMAL(10,2) NOT NULL,
  
  breakdown JSONB NOT NULL, -- full RateCalculationOutput
  
  calculated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  calculated_by UUID REFERENCES users(id)
);

CREATE INDEX idx_rate_calculations_reservation ON rate_calculations(reservation_id);
```

---

## 7. Permissions

### Role-Based Access

```typescript
enum RatePermission {
  // View
  VIEW_RATES = 'rates:view',
  VIEW_RATE_RULES = 'rates:rules:view',
  VIEW_RATE_CALENDAR = 'rates:calendar:view',
  VIEW_RATE_EXPLANATION = 'rates:explanation:view',
  
  // Base rates
  CREATE_BASE_RATE = 'rates:base:create',
  UPDATE_BASE_RATE = 'rates:base:update',
  DELETE_BASE_RATE = 'rates:base:delete',
  
  // Rules
  CREATE_RATE_RULE = 'rates:rules:create',
  UPDATE_RATE_RULE = 'rates:rules:update',
  DELETE_RATE_RULE = 'rates:rules:delete',
  
  // Overrides
  CREATE_OVERRIDE = 'rates:override:create',
  UPDATE_OVERRIDE = 'rates:override:update',
  DELETE_OVERRIDE = 'rates:override:delete',
  APPROVE_OVERRIDE = 'rates:override:approve', // Manager only
  
  // Bulk operations
  BULK_EDIT_RATES = 'rates:bulk:edit',
  COPY_FORWARD_RATES = 'rates:calendar:copy',
  
  // Configuration
  MANAGE_DEPOSIT_RULES = 'rates:deposit:manage',
  MANAGE_FEE_RULES = 'rates:fees:manage',
}
```

### Role Assignments

**Admin:**
- All rate permissions

**Manager:**
- All rate permissions
- Must approve high-value overrides (>30% discount)

**Front Desk:**
- View rates
- View rate explanations
- Request manager override (cannot apply directly)

**Housekeeping:**
- No rate access

**Cashier:**
- View rates (read-only)
- View rate explanations

---

## 8. Manager Workflows

### A. Setting Base Rates

**Workflow:**
1. Navigate to Rates → Base Rates
2. Select room type
3. Click "Add Base Rate"
4. Enter rate amount
5. Set effective date range
6. Add notes (optional)
7. Save

**Validation:**
- Rate must be positive
- No overlapping date ranges for same room type
- Future-dated rates show as SCHEDULED

### B. Creating Seasonal Rules

**Example: High Season Premium**

```
Rule Name: High Season Premium
Type: PEAK_SEASON
Date Range: Dec 15 - Jan 15
Room Types: All
Adjustment: +30% percentage
Priority: 50
Status: Active
```

**Workflow:**
1. Rates → Rate Rules
2. Click "New Rule"
3. Select rule type (Seasonal)
4. Configure date ranges
5. Select room types (or all)
6. Set adjustment (percentage or fixed)
7. Set priority
8. Preview impact
9. Save

### C. Creating Special Event Rates

**Example: Songkran Festival**

```
Rule Name: Songkran Festival Premium
Type: SPECIAL_EVENT
Date Range: Apr 13 - Apr 15
Room Types: All
Adjustment: +50% percentage
Priority: 100 (high priority)
Min Length of Stay: 3 nights
Status: Active
```

### D. Manual Override Workflow

**Scenario:** Loyal guest requests discount

1. Find date(s) on rate calendar
2. Right-click → "Create Override"
3. Enter new rate
4. **MUST enter reason** (required field)
5. If discount > 30%: requires manager approval
6. Save override
7. Override appears on calendar with 🔒 icon

**Override Audit Trail:**
- Who created it
- When created
- Original rate
- Override rate
- Reason
- Who approved (if required)

### E. Bulk Rate Update

**Scenario:** Update all weekday rates for March

1. Rate Calendar view
2. Click date range selector
3. Select March 1-31
4. Filter to weekdays only
5. Select "Apply Adjustment"
6. Choose "+5% increase"
7. Preview changes
8. Confirm
9. System logs bulk change

### F. Copy Forward Workflow

**Scenario:** Repeat March rate pattern for April-June

1. Select source range (March 1-31)
2. Click "Copy Forward"
3. Select target months (April, May, June)
4. Choose what to copy:
   - Base rates
   - Overrides
   - Restrictions
5. Confirm
6. System applies changes

---

## 9. Validation & Audit Rules

### Validation Rules

1. **No Negative Rates**
   - All rates must be ≥ 0

2. **No Rate Gaps**
   - Warn if no rate defined for dates within booking window
   - Block reservations if rate missing

3. **Reasonable Rate Range**
   - Warn if rate is <50% or >300% of historical average
   - Require confirmation for extreme changes

4. **Rule Conflict Detection**
   - Warn if multiple rules of same type overlap
   - Last rule wins, but surface warning

5. **Override Approval Threshold**
   - Discounts > 30%: require manager approval
   - Overrides on peak dates: require reason + approval

6. **Blackout Interaction**
   - Cannot set rate if date is blacked out
   - Stop-sell blocks new bookings but preserves rate

7. **Future Booking Protection**
   - Warn when changing rate for dates with existing reservations
   - Require confirmation to proceed
   - Existing reservations keep original quoted rate

### Audit Trail Requirements

**Every rate change must log:**
- What changed
- Old value → new value
- Who made the change
- When
- Reason (for overrides)
- Impact count (how many future bookings affected)

**Audit Log Entry:**

```typescript
interface RateAuditEntry {
  id: string
  entityType: 'BASE_RATE' | 'RATE_RULE' | 'OVERRIDE' | 'FEE_RULE'
  entityId: string
  action: 'CREATE' | 'UPDATE' | 'DELETE' | 'APPROVE'
  
  userId: string
  userName: string
  userRole: string
  
  timestamp: Date
  
  changes: FieldChange[]
  
  reason?: string
  approvedBy?: string
  
  impactedReservations: string[] // reservation IDs
  impactedDateRange: DateRange
}

interface FieldChange {
  field: string
  oldValue: any
  newValue: any
}
```

---

## 10. Implementation Roadmap

### Phase 1: Foundation (Week 1)

**Schema & Data Layer**
- [ ] Create all rate-related tables
- [ ] Implement base rate CRUD
- [ ] Implement rate rule CRUD
- [ ] Implement override CRUD
- [ ] Add audit logging infrastructure

**Core Pricing Engine**
- [ ] Build rate calculation algorithm
- [ ] Implement rule precedence logic
- [ ] Build rate explanation generator
- [ ] Add calculation caching

**API Endpoints**
```
POST   /api/rates/calculate
GET    /api/rates/base-rates
POST   /api/rates/base-rates
PUT    /api/rates/base-rates/:id
DELETE /api/rates/base-rates/:id

GET    /api/rates/rules
POST   /api/rates/rules
PUT    /api/rates/rules/:id
DELETE /api/rates/rules/:id

GET    /api/rates/overrides
POST   /api/rates/overrides
PUT    /api/rates/overrides/:id
DELETE /api/rates/overrides/:id
```

### Phase 2: Rate Dashboard (Week 2)

**Dashboard UI**
- [ ] Active rate summary cards
- [ ] Room type rate visibility table
- [ ] Next 30/60/90 day rate preview
- [ ] Missing rate warnings
- [ ] Unusual rate warnings
- [ ] Quick stats (avg rate, occupancy forecast)

**Components:**
- `RateDashboard.tsx`
- `RateSummaryCard.tsx`
- `RatePreviewTable.tsx`
- `RateWarningList.tsx`

### Phase 3: Rate Calendar (Week 3)

**Calendar Grid**
- [ ] Build responsive calendar grid
- [ ] Implement date range selection
- [ ] Add cell color coding
- [ ] Add hover tooltips
- [ ] Display rate indicators

**Bulk Edit Tools**
- [ ] Range selection
- [ ] Bulk rate adjustment
- [ ] Copy forward utility
- [ ] Clear overrides tool

**Components:**
- `RateCalendar.tsx`
- `RateCalendarCell.tsx`
- `BulkEditPanel.tsx`
- `CopyForwardDialog.tsx`

### Phase 4: Rate Rule Builder (Week 4)

**Rule Management UI**
- [ ] Rule list view
- [ ] Rule creation form
- [ ] Rule editor
- [ ] Rule preview/simulation
- [ ] Priority management
- [ ] Activation/deactivation

**Rule Types:**
- [ ] Day-of-week rules
- [ ] Seasonal rules
- [ ] Peak/low season rules
- [ ] Special event rules
- [ ] Long-stay discounts

**Components:**
- `RateRuleList.tsx`
- `RateRuleForm.tsx`
- `RulePreview.tsx`
- `RulePriorityManager.tsx`

### Phase 5: Rate Explanation (Week 5)

**Explanation UI**
- [ ] Rate breakdown by night
- [ ] Applied rules visualization
- [ ] Override indicators
- [ ] Fee breakdowns
- [ ] Deposit calculation
- [ ] Export/print functionality

**Components:**
- `RateExplanationPanel.tsx`
- `NightBreakdown.tsx`
- `AppliedRulesList.tsx`
- `OverrideIndicator.tsx`

### Phase 6: Fee Management (Week 6)

**Extra Guest Fees**
- [ ] Extra guest fee rule configuration
- [ ] Occupancy-based calculation
- [ ] Date-based fee changes

**Child Fees**
- [ ] Age range configuration
- [ ] Fee type configuration (free, fixed, percentage)
- [ ] Sharing bedding logic

**Components:**
- `ExtraGuestFeeConfig.tsx`
- `ChildFeeConfig.tsx`
- `FeeRuleList.tsx`

### Phase 7: Deposit Rules (Week 7)

**Deposit Configuration**
- [ ] Deposit rule creation
- [ ] Source-based rules
- [ ] Room type-based rules
- [ ] Timing configuration

**Integration**
- [ ] Link to booking engine
- [ ] Link to reservation flow
- [ ] Payment tracking integration

### Phase 8: Advanced Features (Week 8)

**Stop-Sell / CTA / CTD**
- [ ] Restriction configuration
- [ ] Calendar visibility
- [ ] Booking engine integration

**OTA Rate Plan Compatibility**
- [ ] Rate plan mapping structure
- [ ] Markup/commission rules
- [ ] Channel-specific overrides
- [ ] Rate push simulation

**Manager Workflows**
- [ ] Approval workflow UI
- [ ] Override approval queue
- [ ] Bulk approval tools

### Phase 9: Integration & Testing (Week 9)

**System Integration**
- [ ] Connect to reservation system
- [ ] Connect to booking engine
- [ ] Connect to folio/billing
- [ ] Connect to reporting

**Testing**
- [ ] Rate calculation accuracy tests
- [ ] Rule precedence tests
- [ ] Override behavior tests
- [ ] Long-stay discount tests
- [ ] Fee calculation tests
- [ ] Deposit calculation tests
- [ ] Edge case handling

### Phase 10: Polish & Launch (Week 10)

**Performance**
- [ ] Rate calculation caching
- [ ] Calendar rendering optimization
- [ ] Bulk edit performance

**UX Polish**
- [ ] Keyboard shortcuts
- [ ] Loading states
- [ ] Error handling
- [ ] Success confirmations
- [ ] Help tooltips

**Documentation**
- [ ] Manager training guide
- [ ] Rate rule examples
- [ ] Troubleshooting guide
- [ ] Best practices

**Launch**
- [ ] Import existing rates
- [ ] Staff training
- [ ] Phased rollout
- [ ] Monitor accuracy

---

## Key Design Decisions

### 1. Rule Precedence Over Complex Logic

Rather than trying to detect and resolve rule conflicts, we use a simple priority system. Higher priority rules apply later and can override earlier rules. This is predictable and debuggable.

### 2. Manual Override Always Wins

Manual overrides always take precedence. This gives managers ultimate control in exceptional situations without breaking the rule system.

### 3. Calculation Immutability

Once a reservation is confirmed, its quoted rate is frozen. Future rate changes don't affect existing reservations. This prevents guest confusion and operational disputes.

### 4. Tax-Inclusive Public Pricing

Following Thailand convention, all public rates are tax-inclusive. Internal breakdowns can show tax components, but guests see one final price.

### 5. Explainability First

Every rate calculation produces a detailed breakdown showing which rules applied. This makes the system trustworthy and debuggable.

### 6. Future OTA Compatibility

The schema includes room for future rate plan mapping, markup rules, and channel-specific overrides, but we don't build full channel management yet. This keeps scope manageable while preserving expansion path.

### 7. Audit Everything

Every rate change is logged with full context. This is non-negotiable for revenue management systems.

---

## Success Criteria

The Rates module succeeds when:

✅ **Staff trust the rates**
   - Front desk can explain any quoted rate
   - No mysterious pricing
   - Clear audit trail

✅ **Managers can execute strategy**
   - Weekend premiums
   - Seasonal adjustments
   - Event-based pricing
   - Long-stay incentives

✅ **No rate chaos**
   - Rules don't conflict unpredictably
   - Changes are controlled
   - Historical rates are preserved

✅ **Operations are fast**
   - Quoting a rate takes <500ms
   - Calendar loads quickly
   - Bulk edits are efficient

✅ **Revenue is protected**
   - No accidental zero rates
   - Extreme discounts require approval
   - Changes are logged

✅ **System is maintainable**
   - Rule logic is clear
   - Calculation is auditable
   - Schema is normalized

---

## Final Notes

This rates architecture is **powerful but understandable**.

It supports sophisticated pricing strategies without creating rule chaos. Every rate is explainable. Every change is auditable. Managers have control, but with safety rails.

The system is designed for **operational reality**:
- Front desk staff need to quote rates instantly
- Managers need to adjust pricing strategically
- Guests expect consistent, fair pricing
- Finance needs accurate revenue tracking

This is not a generic revenue management system. This is a **boutique hotel rate management system** built for clarity, speed, and trust.

Implementation-ready. Production-minded. Revenue-safe.

---

**End of Rates & Pricing Architecture**
