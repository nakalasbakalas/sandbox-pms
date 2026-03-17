# UI Diff Notes — PMS Reference Replication

**Date:** 2026-03-17
**Branch:** copilot/refactor-booking-dashboard-again

---

## Summary of Changes

This document records what was changed page by page during the reference PMS replication effort.

---

## 1. styles.css — Comprehensive PMS Operational Design System

### Added (Phase 1 — prior session, now complete)
- PMS operational design tokens: `--pms-space-*`, `--pms-bg-*`, `--pms-border-*`, `--pms-text-*`, `--pms-input-height`, `--pms-table-row-height`, etc.
- PMS operational CSS components: `.table-pms`, `.filter-block-pms`, `.filter-form-pms`, `.status-pms`, `.btn-pms`, `.pms-page-header`, etc.
- Partial staff-page light-mode override via `body:not(.public-site)` block

### Added (Phase 2 — this session)
- **Full staff page light-mode overrides** — every major dark-themed component is now overridden for `body:not(.public-site)`:
  - `site-header`: white bg, 44px height, tab-style nav links with bottom-border active state
  - `card`: white bg, thin border, minimal shadow
  - Typography: corrected heading sizes, dark text colors
  - `input/select/textarea`: white bg, flat border styling
  - `button.secondary`: white bg with grey border
  - `table thead/tbody`: light grey header, thin row borders
  - `status` badges: replaced dark transparent tones with light opaque semantic colors (blue=confirmed, orange=pending, green=clean/paid, red=unpaid/danger, grey=blocked)
  - Flash messages: light semantic backgrounds
  - Toolbar: light grey bg with thin border
- **Board legend** (`.board-legend`, `.board-legend-item`, `.board-legend-swatch.*`)
- **HK date toggle bar** (`.hk-date-bar`, `.hk-date-toggle`, `.hk-date-btn`, `.hk-print-btn`, `.hk-date-label`)
- **Reservations page layout** (`.res-page-title`, `.res-filter-block`, `.res-filter-form`, `.res-filter-submit`, `.res-results-bar`, `.res-table-wrap`, `.res-table`, `.res-pagination`, etc.)
- Planning board light-mode overrides: room cells, day header cells, sticky header, group rows, status strip, side panel, context menu, overflow menu

---

## 2. staff_reservations.html — Booking List / Search Page

### What was matched exactly
- Dark contrasting filter block (`#2c3e50` background) with multi-column grid of search fields
- Fields: guest name/phone, status, room type, arrival date, departure date, payment state, source, review status, assignment
- Search button aligned to right of filter grid
- Toggle checkbox for include cancelled/closed
- Arrival/Departures/In-house quick links in filter footer
- Results count line showing total matching reservations
- Create reservation button and quick nav links near results header
- Dense operational table with compact rows (13px font, 6px padding)
- Table columns: Reference (monospace code), Guest (name + phone), Room (type + assigned number), Check-in, Check-out, Nights, Status, Payment, Source, Action button
- `.status` badges now use light semantic colors (operational feel)
- Pagination at bottom

### What was adapted
- Filter labels kept in English matching our field names (not the reference's Thai/generic labels)
- Payment state column preserved (our system has richer payment tracking than reference)
- Review status column preserved (our system has review workflow)
- Assignment filter preserved
- "Active by default" still the default for status (our business logic)

### What was removed
- Card-in-card structure (double cards with `card-head` + eyebrow + h1 + description)
- Bulky card header with Arrivals/Departures/In-house button group
- Overly padded toolbar with full-height labels

### Comparison vs reference
- Layout: ✅ Dark filter block + dense table now closely matches reference
- Density: ✅ Row heights match reference (~32px vs previous ~48px)
- Filter structure: ✅ Multi-column grid in dark block matches reference
- Table feel: ✅ Operational, monospace codes, compact typography

---

## 3. housekeeping_board.html — Housekeeping / Cleaning Page

### What was matched exactly
- Page title "Housekeeping" as compact heading (18px, no large h1)
- Date header showing current date (business_date)
- **Date toggle bar** — Today / Tomorrow buttons as compact segmented control
- **Date picker input** — date input that submits on change for specific date
- **Print button** aligned to right of header
- Last-updated timestamp in date bar
- Metrics bar: 4 compact metrics (dirty, arrival-ready, blocked, rooms) — inline, not grid
- Filters collapsed by default, expand only when active filters present
- Bulk actions collapsed by default
- Table sections with compact section heading showing date + status count pills
- Dense table with compact rows (same res-table CSS)
- Status badges now semantic light colors
- HK state column shows Arr/Dep/Stay/Vacant with compact badges
- Priority column shows compact badge
- Actions column: Detail + inline status change form on same row

### What was adapted
- Kept our richer housekeeping statuses (more than reference)
- Preserved priority flags (urgent/high/normal) which reference may not have explicitly
- Preserved maintenance flag icons inline in room cell
- Preserved note count indicator
- Kept both Today and Tomorrow tables on same page (reference only shows one)
- Kept bulk actions for operational efficiency

### What was removed
- Large eyebrow + h1 + page nav with separate Dashboard/Front Desk buttons in card
- Separate metrics grid (replaced with inline metric bar)
- Old hk-filter-panel that was always visible (now collapsible and compact)
- Old hk-section-head styling (replaced with slimmer border-bottom divider)
- Verbose table structure with extra spacing

### Comparison vs reference
- Layout: ✅ Date toggles match reference pattern exactly
- Structure: ✅ Report-style compact table now matches reference
- Density: ✅ Much more compact than before
- Print button: ✅ Added per reference
- Date toggles: ✅ Today/Tomorrow buttons with active state

---

## 4. front_desk_board.html — Calendar / Room Allocation Board

### What was added
- **Board legend** — compact legend bar showing all booking state colors (confirmed, pending/in-house, unallocated, past, external, closure, conflict)
- Legend positioned between control rows and the board surface

### Styling improvements via CSS
- Board grid: light grey header/day cells, white room cells
- Day header: today column highlighted with warm amber background + accent color
- Weekend columns: subtle light grey
- Room group rows: light grey with muted uppercase label
- Status strip: light grey inline bar
- Planning board shell removes card shadows
- All dark-themed elements overridden for light operational feel
- Popover: white bg with thin border (matches reference popover style)
- Side panel: white bg with thin left border
- Context menu: white bg with thin border
- Nav buttons: white bg, flat style

### What was adapted
- Kept all existing density modes (spacious/comfortable/compact/ultra)
- Kept day-range tab controls (7d/14d/30d)
- Kept filters, search, ICS import/export overflow menu
- Booking block colors preserved (green=confirmed, orange=pending/in-house, purple=unallocated, etc.)

### What remains for future parity
- Drag-to-create booking directly on empty grid cells (like some reference implementations)
- Date range header with month labels in two rows (reference shows "Mon 17 Mar" format)
- Sticky room labels that follow horizontal scroll on desktop (partially working)

---

## 5. base.html — Top Navigation

### What was changed (via CSS overrides — no template changes needed)
- Staff header: white background, 44px height (down from 56px)
- Nav links: tab style with bottom-border active indicator, 13px font
- Utility buttons: flat white with grey border
- Account/language dropdowns: white popover with thin border
- Brand mark: smaller (32px), less rounded

### What was adapted
- Kept existing nav link structure (Staff, Front Desk, Reservations, Housekeeping, etc.)
- Labels not changed to match reference exactly (different products, different tabs)
- Mobile nav drawer: light bg, flat list links

---

## 6. Shared Components

### Status badges
- **Before:** Dark translucent colored badges (dark bg with light text) — looked like dark-theme UI on light pages
- **After:** Light semantic badges matching conventional PMS style:
  - Confirmed → light blue (#e3f2fd / #1565c0)
  - Checked in → light orange (#fff3e0 / #e65100)
  - Checked out → light purple (#ede7f6 / #4527a0)
  - Cancelled → light grey (#f5f5f5 / #616161)
  - Paid → light green (#e8f5e9 / #2e7d32)
  - Unpaid/missing → light red (#ffebee / #c62828)
  - Dirty → light orange (#fff3e0 / #e65100)
  - Clean → light green (#e8f5e9 / #2e7d32)
  - Inspected → light blue (#e3f2fd / #1565c0)
  - Blocked → light grey (#f5f5f5 / #616161)

### Tables
- Row height: ~32px (down from ~48–56px)
- Row padding: 6px 10px (down from 8px 12px+)
- Header font: 11px uppercase (down from 0.78rem)
- Hover state: light grey bg

### Forms
- Input height: 30–32px (down from implicit ~38px)
- Input padding: 5px 8px (down from 8px 10px)
- Label font: 11–12px

---

## What Remains for Future Parity

1. **Board drag-to-create** — Click on empty board cell to start creating a booking.

2. **More compact board columns for 30-day view** — Reference board packs more day columns than our ultra mode.

3. **Financial summary sidebar** — Reference booking modal has a right-side financial summary. Our drawer shows balance_due but not a full folio breakdown.

---

## Phase 3 Changes (this session)

### staff_reservations.html + service + route

#### Column sorting
- `ReservationWorkspaceFilters` dataclass gained `sort: str = ""` and `sort_dir: str = "asc"`
- `list_reservations()` now applies DB-level ordering when `sort` ∈ `{arrival, departure, status, reference}`
- Default ordering (operational_rank + arrival + booked_at) preserved when no sort selected
- Route reads + validates `sort`/`sort_dir` from request args
- Template: `sort_url(col)` macro builds sort URLs preserving all filter params
- Active sort column shown with ↑/↓ indicator in header

#### Row click to open
- Each `<tr>` carries `data-panel-url` + `data-detail-url` attributes
- JS intercepts row clicks; ignores clicks inside `.res-row-actions` (action column)
- Row cursor changed to pointer

#### Inline status quick-change
- Cancel button (✕) added to action column for `tentative`/`confirmed` reservations
- POSTs to existing `/staff/reservations/<id>/cancel` route
- Requires `reservation.cancel` permission (same check as cancel route itself)
- `onclick` confirmation prevents accidental clicks

#### Booking detail drawer (modal)
- New route: `GET /staff/reservations/<id>/panel` → `staff_reservation_panel()`
- New template: `_res_list_drawer.html` (HTML fragment, no base extends)
- Drawer HTML overlay added to reservations page: `.res-drawer-overlay` + `.res-drawer`
- JS: fetch() loads panel fragment → injected into drawer → slide-in animation
- Close: overlay click, Escape key, or close button in drawer head
- Drawer shows: code, status/payment badges, guest name/phone, key stay meta grid, flags, action buttons (Full detail →, Cashier →, Cancel)
- Fixed `can_create` bug: was an undefined variable; now uses `can('reservation.create')` directly

### provider_bookings.html

#### Restyled to operational PMS pattern
- Removed: double card structure, `.toolbar` form, `.compact-table` with `.table-wrap`
- Added: `res-filter-block` + `res-filter-form` dark filter block
- Added: `res-results-bar` count line
- Added: `res-table-wrap` + `res-table` dense table (consistent with staff_reservations)
- Added: `res-pagination` compact pagination bar
- Removed: "Back to dashboard" button from card-head; moved to `res-filter-row2`
- Kept all filter fields and pagination logic intact

### styles.css additions

- `.res-sort-link`, `.res-sort-link.active`, `.res-sort-link.active.desc` — sort header styles
- `.res-sort-active` — sort state indicator in results bar
- `.res-table-row` cursor pointer
- `.res-row-actions` flex container for action column
- `.res-quick-cancel-form`, `.res-quick-cancel` — inline cancel button
- Full drawer component: `.res-drawer-overlay`, `.res-drawer`, `.res-drawer-head`, `.res-drawer-close`, `.res-drawer-code`, `.res-drawer-body`, `.res-drawer-guest`, `.res-drawer-sub`, `.res-drawer-meta`, `.res-drawer-meta-item`, `.res-drawer-flags`, `.res-drawer-actions`, `.res-drawer-loading`, `.res-drawer-error`


---

## Business Logic Preserved

- ✅ All booking status values
- ✅ All payment state values
- ✅ All room assignment logic
- ✅ All filter query parameters
- ✅ All route URLs (no URL changes)
- ✅ All CSRF protection forms
- ✅ All permission checks (can() / can_edit / can_folio)
- ✅ All housekeeping bulk actions
- ✅ All board drag/resize/move logic (JavaScript unchanged)
- ✅ All popover detail/assign/resize forms
- ✅ All ICS import/export
- ✅ All pagination logic
