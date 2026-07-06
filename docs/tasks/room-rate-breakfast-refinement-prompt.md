# Room Mapping, Room Sections, Breakfast Rate Plans — Execution Prompt

## Context
The PMS currently maps physical room inventory into two room types: Standard Twin and Superior Double. Breakfast is represented only as free-text inclusions in rate plans/packages, which makes it weak for reservations, OTA mapping, kitchen breakfast counts, folios, and reporting.

## Mandatory rate change
Set the default base room rate to **THB 750** everywhere a new or seeded room type/rate is created.

Apply this to:
- onboarding default room type base rates
- onboarding default rates
- room type management default form values
- reservation fallback room type rates
- Prisma seed room type base rates
- E2E/browser smoke seed data and expected amounts

## Phase 1 — Dynamic room section refinement
Replace hard-coded room sections with dynamic room sections generated from configured room types.

Acceptance criteria:
- The rooms page must not hard-code only Twin and Double sections.
- Use `roomTypeId` as the primary grouping key.
- Resolve room type display names from `onboarding-room-types` and/or `room-types-config`.
- Sort sections by configured room type order, then by title.
- Sort rooms by floor, then room number.
- Each section header should show total rooms, ready, occupied, dirty, and blocked counts.
- Existing Twin/Double fallback must continue to work.

## Phase 2 — Structured meal/rate plan model
Introduce explicit rate plan and meal plan data instead of relying on `inclusions: string[]`.

Recommended model:

```ts
type MealPlan = 'ROOM_ONLY' | 'BED_AND_BREAKFAST'

interface RatePlan {
  id: string
  propertyId?: string
  roomTypeId: string
  code: string
  name: string
  mealPlan: MealPlan
  breakfastIncluded: boolean
  breakfastAdultsIncluded: number
  breakfastChildrenIncluded?: number
  baseRate: number
  isDerived: boolean
  parentPlanId?: string
  derivationType?: 'MARKUP' | 'MARKDOWN' | 'FIXED_DELTA'
  derivationValue?: number
  inclusions: string[]
  cancellationPolicy: string
  depositPolicy: string
  status: 'ACTIVE' | 'INACTIVE' | 'ARCHIVED'
  createdAt: string
  updatedAt: string
}
```

Default plans:
- `TWIN_RO` — Standard Twin Room Only
- `TWIN_BB` — Standard Twin Bed & Breakfast
- `DOUBLE_RO` — Superior Double Room Only
- `DOUBLE_BB` — Superior Double Bed & Breakfast

Important rule: do **not** duplicate physical room inventory for breakfast variants. Room-only and breakfast-included products must share the same physical room pool.

## Phase 3 — Reservation flow
Update new reservation creation so staff select a room type and then a rate plan.

Acceptance criteria:
- Room type selector chooses the physical/sellable category.
- Rate plan selector chooses Room Only or Bed & Breakfast.
- Reservation stores `ratePlanId`, `mealPlan`, `breakfastIncluded`, and `breakfastCount` or equivalent fields.
- Board/reservation display should show a compact `RO` or `BB` badge.
- Pricing should derive from the selected rate plan.

## Phase 4 — Breakfast operations
Add a breakfast report/count view.

Acceptance criteria:
- Filter by date.
- Show room number, guest name, adults/children count, meal plan, notes/special requests.
- Show total breakfast count for the day.
- BB reservations are included automatically.
- Room-only reservations are excluded unless breakfast is added manually.

## Phase 5 — OTA/channel mapping
Extend channel mappings to support external rate plans.

Recommended fields:

```ts
interface ChannelRoomRateMapping {
  channelId: string
  externalRoomTypeId: string
  externalRoomTypeName: string
  externalRatePlanId?: string
  externalRatePlanName?: string
  roomTypeId: string
  ratePlanId: string
  mealPlan: 'ROOM_ONLY' | 'BED_AND_BREAKFAST'
  roomIds: string[]
  active: boolean
}
```

Acceptance criteria:
- Same PMS room type can map to multiple OTA rate plans.
- `Standard Twin / Room Only` and `Standard Twin / Breakfast Included` share the same physical PMS rooms.
- Unknown imported meal plans must enter review instead of being guessed silently.

## Phase 6 — Tests
Add or update tests to verify:
- Default base rate is THB 750.
- Dynamic room sections render from config.
- RO and BB products share the same room inventory.
- BB reservations appear in breakfast counts.
- OTA mappings can map one room type to multiple external rate plans.
- Existing setup/onboarding still works.

## Safety constraints
- Preserve inventory safety and no-double-booking logic.
- Do not create fake production reservations, guests, payments, or folios.
- Do not modify production room imports without explicit approval.
- Keep schema migrations backward-compatible where possible.
