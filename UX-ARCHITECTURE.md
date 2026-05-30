# Sandbox Hotel PMS — UX Architecture & Design System

## Navigation Architecture

### Primary Navigation (Always Visible)
Compact left sidebar (60px collapsed, 240px expanded) with icon + label.

**Top Priority:**
1. **Board** — Default home, room grid view
2. **Front Desk** — Check-in/out workflows, today's activity
3. **Reservations** — Pipeline, calendar, list
4. **Guests** — Profiles, history, search
5. **Housekeeping** — Status board, cleaning queue
6. **Cashier** — Payments, folios, reconciliation
7. **Rates** — Pricing management
8. **Channels** — Distribution (future)
9. **Reports** — Analytics, occupancy, revenue
10. **Admin** — Settings, users, audit

### Secondary Navigation (Tucked)
Accessible via bottom section of sidebar or settings dropdown.

**Lower Priority:**
- Messaging (internal notes)
- Pre-check-in (guest portal)
- Documents (templates)
- Surveys (feedback)
- Promotions (offers)
- Cafe POS (separate module)
- Audit logs (admin)
- Automation (admin)

### Navigation Behavior
- **Collapsed by default** — Icons only, labels on hover
- **Expand on hover** — Slide out to show full labels
- **Keyboard shortcut** — `Cmd+B` toggle sidebar
- **Active state** — Terracotta left border + background tint
- **Badge indicators** — Unread counts, pending actions

---

## Screen Hierarchy

### Layout System
```
┌─────────────────────────────────────────────────┐
│ [Global Header: Search + User + Notifications]  │
├──┬──────────────────────────────────────────────┤
│  │ [Page Content Area]                          │
│S │                                               │
│i │  ┌────────────────────────┬──────────────┐   │
│d │  │ Main Content           │ Side Panel   │   │
│e │  │ (Board/List/Form)      │ (Contextual) │   │
│b │  │                        │              │   │
│a │  │                        │              │   │
│r │  │                        │              │   │
│  │  └────────────────────────┴──────────────┘   │
└──┴──────────────────────────────────────────────┘
```

### Header (Fixed, 56px)
- **Left:** Logo + property name "Sandbox Hotel"
- **Center:** Global search (Cmd+K) — 400px width
- **Right:** Notifications bell, user avatar/menu

### Content Area
- **Full-width pages:** Board, Reports, Settings
- **Split layout:** Reservations (list + side panel), Front Desk (activity + actions)
- **Centered forms:** Guest profiles, Rate management

---

## Primary/Secondary Menu Logic

### Role-Based Menu Filtering
```
Admin: All 10 primary + all secondary
Manager: All 10 primary + messaging, audit logs
Front Desk: Board, Front Desk, Reservations, Guests, Cashier
Housekeeping: Board (simplified), Housekeeping only
Cashier: Front Desk, Cashier, Reports (limited)
```

### Context Switching
- **No page reloads** — React Router SPA navigation
- **Preserve state** — Return to same scroll position, filters
- **Breadcrumbs** — Only for deep drill-downs (Guest > History > Reservation Detail)

---

## Page Layout System

### Board Layout (Default)
- **Grid:** 5 columns × 6 rows (30 rooms)
- **Card size:** 160px × 140px (compact mode), 200px × 160px (comfortable mode)
- **Right panel:** 320px Today's Activity (arrivals/departures list)
- **No padding waste** — Edge-to-edge with 16px margins

### List Layout (Reservations, Guests)
- **Main:** Full-width table with filters at top
- **Side panel:** Slides in from right (400px) when row clicked
- **Sticky header** — Column headers remain visible on scroll

### Form Layout (Create/Edit)
- **Max width:** 640px centered
- **Two-column grids** — For compact data entry (name/phone, check-in/out)
- **Full-width textarea** — For notes, special requests

### Dashboard Layout (Reports)
- **KPI cards:** 4-column grid at top (occupancy, revenue, ADR, RevPAR)
- **Charts:** 2-column grid below (trends, breakdown)
- **Filters:** Sticky top bar with date range picker

---

## Side Panel / Drawer Behavior

### Side Panel (In-Page)
**Use for:** Reservation details, guest profiles, folio view

**Behavior:**
- Slides in from right (400ms spring)
- Overlays content (backdrop dims 50%)
- Close via X button, Esc key, or click backdrop
- Stacks: Opening another panel replaces current

### Drawer (Temporary)
**Use for:** Mobile navigation menu, quick actions

**Behavior:**
- Slides from left (mobile nav) or bottom (mobile actions)
- Full-screen on mobile
- Swipe-to-close enabled

### Modal (Blocking)
**Use for:** Check-in/out, critical confirmations, errors

**Behavior:**
- Centers on screen
- Prevents interaction with background
- Backdrop click disabled (must use button)
- Focus trap — Tab cycles within modal

---

## Density Modes

### Compact (Default)
- Room cards: 160×140px, 13px font, tight spacing
- Table rows: 36px height, 13px font
- Spacing: 8px between elements
- **Use case:** Power users, multi-screen setups

### Comfortable
- Room cards: 200×160px, 15px font, generous spacing
- Table rows: 48px height, 15px font
- Spacing: 16px between elements
- **Use case:** Single-screen, touch devices, accessibility

### Toggle
- Global setting saved per user
- Switch in user menu dropdown
- Persists via `useKV("density-mode", "compact")`

---

## Color/Status Semantics

### Room Status Colors
```
Occupied:        oklch(0.45 0.15 250)  Blue
Vacant Clean:    oklch(0.65 0.13 155)  Green
Vacant Dirty:    oklch(0.70 0.14 75)   Amber
Out of Service:  oklch(0.50 0.01 270)  Gray
Reserved:        oklch(0.55 0.12 290)  Purple
```

### Action Colors
```
Primary CTA:     oklch(0.62 0.15 40)   Terracotta
Success:         oklch(0.60 0.15 145)  Green
Warning:         oklch(0.65 0.16 65)   Orange
Destructive:     oklch(0.55 0.22 25)   Red
Neutral:         oklch(0.25 0.01 270)  Charcoal
```

### Text Colors
```
Primary:         oklch(0.25 0.01 270)  Dark
Secondary:       oklch(0.50 0.01 270)  Medium
Tertiary:        oklch(0.65 0.01 270)  Light
Disabled:        oklch(0.75 0.01 270)  Very Light
```

---

## Typography System

### Scale
```css
--text-xs:   11px / 1.4  (captions, labels)
--text-sm:   13px / 1.5  (table cells, meta)
--text-base: 15px / 1.6  (body, forms)
--text-lg:   17px / 1.5  (subheadings)
--text-xl:   20px / 1.3  (section headers)
--text-2xl:  24px / 1.25 (page titles)
--text-3xl:  32px / 1.2  (module headers)
```

### Weights
```
Regular: 400  (body text)
Medium:  500  (labels, emphasis)
Semibold: 600 (headings, buttons)
Bold:    700  (rare, high emphasis)
```

### Families
```
Primary: Inter Variable
Display: Newsreader (headers only)
Mono: Inter (tabular-nums for amounts)
```

---

## Spacing Tokens

### Base Unit: 4px
```
space-0:  0px
space-1:  4px   (tight elements)
space-2:  8px   (compact spacing)
space-3:  12px  (default gap)
space-4:  16px  (section padding)
space-6:  24px  (panel padding)
space-8:  32px  (major sections)
space-12: 48px  (module headers)
space-16: 64px  (page top/bottom)
```

---

## Button/Input/Form Patterns

### Button Variants
**Primary:** Terracotta background, white text, semibold
- Size: h-10 (40px), px-6, rounded-md
- Hover: Lighten 10%
- Active: Darken 5%

**Secondary:** Warm beige background, charcoal text
- Size: h-10, px-6, rounded-md
- Hover: Lighten 5%

**Ghost:** Transparent, charcoal text
- Size: h-10, px-4, rounded-md
- Hover: Background muted-beige

**Destructive:** Red background, white text
- Size: h-10, px-6, rounded-md
- Use sparingly (delete, cancel reservation)

### Input Fields
**Text/Number:** 
- Size: h-10, px-3, rounded-md
- Border: 1px border-input
- Focus: 2px ring-terracotta
- Error: border-red-500 + error text below

**Select/Dropdown:**
- Same sizing as text inputs
- Chevron icon right
- Dropdown: max-h-60 scroll

**Textarea:**
- Min height: 80px
- Resizable vertical only

### Form Layout
- Labels: semibold, 13px, mb-1.5
- Required indicator: Red asterisk
- Help text: 12px, muted, mt-1
- Field spacing: mb-4
- Submit button: Right-aligned or full-width

---

## Table/Board Patterns

### Table Design
**Structure:**
- Sticky header with 1px bottom border
- Row height: 36px (compact) / 48px (comfortable)
- Alternating row background (subtle)
- Hover: Background lift + pointer cursor
- Selected: Terracotta left border

**Columns:**
- Left-align: Text (names, descriptions)
- Right-align: Numbers (amounts, counts)
- Center-align: Status badges, icons
- Min-width: Prevent awkward wrapping

**Actions:**
- Inline: Ghost buttons on hover
- Menu: Three-dot icon → popover

### Board Design (Room Grid)
**Card Structure:**
```
┌─────────────────┐
│ 305          [•]│ ← Room number + occupancy dots
│                 │
│ John Smith      │ ← Guest name (truncate)
│ 2 nights left   │ ← Stay duration
└─────────────────┘
```

**Card States:**
- Normal: Flat, status color background
- Hover: Lift 2px, shadow-md
- Selected: Terracotta 3px border
- Loading: Skeleton shimmer

**Occupancy Indicators:**
- Dots: 1 dot per guest (max 3)
- Color: White on dark bg, dark on light bg

---

## Mobile/Tablet Adaptation

### Breakpoints
```
Mobile:   < 768px
Tablet:   768px - 1024px
Desktop:  > 1024px
```

### Mobile Strategy
**Navigation:**
- Sidebar → bottom tab bar (5 main items)
- Overflow → hamburger menu top-left

**Board:**
- Grid → single column list
- Cards: full-width, 80px height
- Tap to open full-screen detail

**Tables:**
- Switch to card view (stack rows vertically)
- Show key columns only
- "View details" button per row

**Forms:**
- Full-width inputs
- One column layout
- Sticky bottom button bar

### Tablet Strategy (iPad Primary)
**Board:**
- Keep grid layout (4×8 or 5×6)
- Touch targets: 44px minimum
- Larger cards: 180×150px

**Side Panels:**
- 50% screen width (400px)
- Swipe gesture to close

**Forms:**
- Two-column where logical
- Comfortable mode by default

---

## Keyboard Shortcuts

### Global
```
Cmd+K:     Open search
Cmd+B:     Toggle sidebar
Cmd+N:     New reservation
Cmd+/:     Show shortcuts help
Esc:       Close modal/panel
```

### Board
```
Arrow keys: Navigate room focus
Enter:      Open selected room
C:          Mark room clean
D:          Mark room dirty
I:          Check-in to selected room
O:          Checkout from selected room
```

### Navigation
```
Cmd+1-9:   Jump to primary nav item
```

---

## Component Design Specs

### Room Card Component
```tsx
<Card status="occupied" hover={true}>
  <RoomNumber>305</RoomNumber>
  <Occupancy dots={2} />
  <GuestName>John Smith</GuestName>
  <NightsRemaining>2 nights left</NightsRemaining>
</Card>
```

### Today's Activity List
```tsx
<ActivityPanel>
  <Section title="Arrivals (5)">
    <ActivityItem 
      guest="Jane Doe"
      room="Unassigned"
      time="14:00"
      action="Check In"
    />
  </Section>
  <Section title="Departures (3)">
    ...
  </Section>
</ActivityPanel>
```

### Status Badge
```tsx
<Badge variant="success">Confirmed</Badge>
<Badge variant="warning">Pending</Badge>
<Badge variant="destructive">Cancelled</Badge>
```

---

## Design Principles Summary

1. **Compact by default** — Dense information, minimal chrome
2. **Calm aesthetics** — Warm neutrals, restrained color, clear hierarchy
3. **Premium feel** — Refined typography, smooth animations, attention to detail
4. **Fast interactions** — Instant feedback, optimistic updates, no spinners
5. **Operationally sharp** — Status-driven, color-coded, quick-action oriented
6. **Low training burden** — Obvious affordances, consistent patterns, helpful empty states
7. **Desktop-first** — Optimize for front desk workflows, adapt gracefully to mobile
8. **Keyboard-ready** — Shortcuts for power users, full keyboard navigation

---

This architecture creates a **compact, calm, premium PMS** optimized for real hotel operations, not generic enterprise software.
