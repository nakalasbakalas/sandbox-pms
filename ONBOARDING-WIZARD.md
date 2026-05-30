# First-Run Onboarding Wizard

## Purpose
The onboarding wizard is the **required first experience** for a new PMS installation. It captures essential property, room, rate, and user setup data before the system becomes operational.

## Philosophy
- **One-time mandatory flow** — cannot skip
- **Clean, guided progression** — step-by-step clarity
- **Smart defaults** — Sandbox Hotel values pre-filled where applicable
- **Validation-first** — prevent bad data from entering the system
- **Completion-gated** — board and operations unlock only after setup
- **Reassuring tone** — "We'll get you running in 10 minutes"

---

## Wizard Structure

### Step 1: Property Details
**Purpose**: Capture hotel identity and operational basics

**Fields**:
- Property name (default: "Sandbox Hotel")
- Address
- City / Province
- Country (default: "Thailand")
- Phone
- Email
- Website (optional)
- Tax ID / Business registration (optional)
- Time zone (default: "Asia/Bangkok")
- Currency (default: "THB")
- Check-in time (default: 14:00)
- Check-out time (default: 11:00)

**Validation**:
- Name required
- Valid email format
- Valid phone format
- Time zone required

---

### Step 2: Room Types
**Purpose**: Define sellable room categories

**Pre-filled defaults for Sandbox Hotel**:
1. **Twin Room**
   - Base occupancy: 2
   - Max occupancy: 3
   - Extra guest fee: 200 THB/night
   - Child 0–5: Free (sharing bedding)
   - Child 6–11: 100 THB/night (sharing bedding)

2. **Double Room**
   - Base occupancy: 2
   - Max occupancy: 3
   - Extra guest fee: 200 THB/night
   - Child 0–5: Free (sharing bedding)
   - Child 6–11: 100 THB/night (sharing bedding)

**Actions**:
- Edit room type details
- Add new room type
- Remove room type
- Reorder room types

**Validation**:
- At least one room type required
- Room type name required
- Base occupancy ≥ 1
- Max occupancy ≥ base occupancy
- Positive pricing values

---

### Step 3: Rooms
**Purpose**: Define individual room inventory

**Pre-filled defaults for Sandbox Hotel**:
- Twin: 201, 202, 203, 204, 205, 206, 207, 208, 209, 210, 211, 212, 213, 214, 215, 216 (out of service)
- Double: 301, 302, 303, 304, 305, 306, 307, 308, 309, 310, 311, 312, 313, 314, 315, 316 (out of service)

**Interface**:
- Bulk room generator: "201-216" → generates 16 rooms
- Assign room type
- Mark as out of service
- Add notes
- Manual add/edit/delete

**Validation**:
- At least one sellable room required
- Room number required and unique
- Room type assignment required

---

### Step 4: Base Rates
**Purpose**: Set initial pricing for room types

**Fields per room type**:
- Base rate (weekday)
- Weekend rate (Fri/Sat) — optional, defaults to base rate
- Currency display (e.g., "2,500 THB")
- Tax-inclusive checkbox (default: ON for Thailand)

**Smart defaults**:
- Twin: 2,500 THB
- Double: 3,200 THB

**Validation**:
- Base rate required
- Rate > 0
- Weekend rate ≥ 0 if provided

**Explanation text**:
> "These are your starting rates. You can refine seasonal pricing, long-stay discounts, and special rules in the Rates module after setup."

---

### Step 5: Admin User
**Purpose**: Create the first system user (property owner/manager)

**Fields**:
- Full name
- Email (used for login)
- Password
- Confirm password
- Role: Admin (locked)
- Phone (optional)

**Validation**:
- All required fields present
- Valid email format
- Password ≥ 8 characters
- Passwords match
- Email not already in use

**Security note**:
> "This admin account has full system access. You can add more users later in Settings."

---

### Step 6: Review & Confirm
**Purpose**: Final check before initialization

**Display summary**:
- Property name and location
- Room types: count and names
- Rooms: total count, sellable count, out-of-service count
- Base rates: summary table
- Admin user: name and email

**Actions**:
- Edit any step (jump back)
- Confirm and initialize system

**On confirmation**:
1. Create property record
2. Create room types
3. Create rooms
4. Create base rate records
5. Create admin user
6. Mark onboarding as complete
7. Redirect to Board with welcome toast

---

## UX Patterns

### Progress Indicator
- Step counter: "Step 2 of 6"
- Visual progress bar
- Step labels visible
- Completed steps: checkmark
- Current step: highlighted
- Future steps: muted

### Navigation
- **Next**: advances after validation
- **Back**: returns to previous step (data preserved)
- **Save Draft** (optional): allow exit and resume later
- **Cancel**: confirm before discarding (only if draft save enabled)

### Validation
- Inline validation on blur
- Error messages below fields
- Block "Next" if validation fails
- Show error summary if multiple issues

### Smart Defaults
- Pre-fill Sandbox Hotel values where applicable
- Allow customization for other properties
- Clear labels: "(default for Sandbox Hotel)"

### Mobile Adaptation
- Vertical stepper on mobile
- Single-column form layout
- Sticky navigation buttons
- Simplified room bulk entry

---

## Data Model

### Setup State
```typescript
interface OnboardingState {
  completed: boolean
  currentStep: number
  data: {
    property: PropertySetup
    roomTypes: RoomTypeSetup[]
    rooms: RoomSetup[]
    rates: RateSetup[]
    adminUser: UserSetup
  }
}

interface PropertySetup {
  name: string
  address: string
  city: string
  country: string
  phone: string
  email: string
  website?: string
  taxId?: string
  timeZone: string
  currency: string
  defaultCheckIn: string
  defaultCheckOut: string
}

interface RoomTypeSetup {
  id: string
  name: string
  baseOccupancy: number
  maxOccupancy: number
  extraGuestFee: number
  childFreeAge: number
  childFeeAge: number
  childFee: number
}

interface RoomSetup {
  number: string
  roomTypeId: string
  status: 'available' | 'out-of-service'
  notes?: string
}

interface RateSetup {
  roomTypeId: string
  baseRate: number
  weekendRate?: number
  taxInclusive: boolean
}

interface UserSetup {
  name: string
  email: string
  password: string
  role: 'admin'
  phone?: string
}
```

---

## Persistence Strategy

### Draft Save (Optional Feature)
- Store onboarding state in `spark.kv` under key `onboarding:draft`
- Allow resume from any device
- Clear draft on completion
- Show "Resume Setup" option on return

### Completion Flag
- Store in `spark.kv` under key `onboarding:completed`
- Check on app load
- Redirect to wizard if incomplete
- Never show wizard again once complete (unless manual reset in admin)

---

## Visual Design

### Layout
- Centered wizard container (max 800px)
- Generous padding
- Clean white/card background
- Soft shadows
- Calm, premium feel

### Typography
- Step title: Large, bold
- Helper text: Muted, smaller
- Field labels: Medium weight, clear
- Validation errors: Red, inline

### Colors
- Progress: Subtle primary accent
- Completed steps: Muted success green
- Current step: Primary
- Errors: Destructive red
- Success: Calm green

### Spacing
- Generous vertical rhythm
- Clear section separation
- Breathable form fields
- Comfortable touch targets

---

## Edge Cases

### Existing Data Detection
- If onboarding previously completed but data missing → show recovery wizard
- If partial data exists → offer to continue or start fresh

### Validation Failures
- Block progression until resolved
- Clear error messages
- Guide user to fix issues

### Browser Refresh
- Preserve state in memory or draft save
- Warn before page exit if unsaved

### Multi-User Race
- First to complete wins
- Second user sees "Setup already completed" message

---

## Success Criteria

**Completion KPIs**:
- Admin can complete setup in < 10 minutes
- Zero database inconsistencies post-setup
- 100% of required data captured
- Clear understanding of next steps

**UX Quality**:
- No confusion about current step
- No accidental data loss
- Smooth back/forward navigation
- Mobile-friendly for manager setup from phone

---

## Post-Completion Experience

### Welcome Message
Toast on first board load:
> "🎉 Welcome to your new PMS! Your property is ready. Start by exploring the board or adding your first reservation."

### Quick Tour (Optional)
- 3-step overlay tour highlighting:
  1. Board
  2. Command Palette (Cmd+K)
  3. Front Desk workflows

### Next Actions Suggestion
- "Add your first reservation"
- "Set up housekeeping users"
- "Configure channel connections"
- "Review rate calendar"

---

## Implementation Priority

**Phase 1 (MVP)**:
- Steps 1–6 core flow
- Validation and persistence
- Completion gate
- Basic styling

**Phase 2 (Enhanced)**:
- Draft save/resume
- Bulk room import/export
- Advanced rate rules preview
- Guided tour post-completion

**Phase 3 (Polish)**:
- Smart data migration from old system
- Multi-language support
- Video help snippets
- Setup analytics for improvement

---

## Maintenance & Updates

### Schema Changes
- If property model changes, update Step 1 fields
- If rate model changes, update Step 4 fields
- Maintain backward compatibility for draft states

### Re-run Setup
- Admin can trigger "Reset Setup Wizard" in Settings
- Requires confirmation and backup warning
- Clears onboarding completion flag

---

This onboarding wizard ensures every Sandbox Hotel PMS installation starts with clean, complete, validated data—unlocking fast, confident operations from day one.
