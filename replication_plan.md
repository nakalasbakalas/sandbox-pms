# PMS Interface Replication Plan

**Date:** 2026-03-16
**Goal:** High-fidelity replication of reference PMS interfaces into Sandbox PMS
**Approach:** Systematic, page-by-page implementation preserving all business logic

## Implementation Strategy

### Phased Approach
1. **Phase 1:** Foundation - Design tokens and shared primitives
2. **Phase 2:** Navigation - Compact top nav and page headers
3. **Phase 3:** Calendar Board - Maximum density replication
4. **Phase 4:** Booking List - Compact filter and dense table
5. **Phase 5:** Booking Modal - New modal system and detail view
6. **Phase 6:** Housekeeping - Simplified report structure
7. **Phase 7:** Polish - Refinement and cross-page consistency
8. **Phase 8:** Validation - Testing and documentation

### Implementation Order Rationale
- Start with foundation (tokens) to ensure consistency
- Navigation affects all pages, do early
- Calendar board is most critical, prioritize
- Booking list is second most used, do next
- Modal is new pattern, needs careful implementation
- Housekeeping is simpler, can be done later
- Polish and validate at end

## Phase 1: Foundation - Design Tokens & Primitives

### 1.1 Create PMS Operational Design Tokens

**File:** `sandbox_pms_mvp/static/styles.css`
**Section:** Add new `:root` variables

**New tokens to add:**
```css
/* PMS Operational Design System */
:root {
  /* Compact spacing for operational interfaces */
  --pms-space-xxs: 2px;
  --pms-space-xs: 4px;
  --pms-space-sm: 6px;
  --pms-space-md: 8px;
  --pms-space-lg: 12px;
  --pms-space-xl: 16px;

  /* Operational colors - neutral, professional */
  --pms-bg-base: #f5f6f8;
  --pms-bg-panel: #ffffff;
  --pms-bg-filter: #2c3e50;
  --pms-bg-hover: #f0f1f3;
  --pms-border-thin: #e1e4e8;
  --pms-border-medium: #d1d5da;
  --pms-text-primary: #24292e;
  --pms-text-secondary: #586069;
  --pms-text-muted: #6a737d;

  /* Compact dimensions */
  --pms-nav-height: 42px;
  --pms-input-height: 32px;
  --pms-input-height-sm: 28px;
  --pms-table-row-height: 36px;
  --pms-table-row-height-compact: 32px;
  --pms-filter-block-pad: 12px;

  /* Minimal rounding */
  --pms-radius: 4px;
  --pms-radius-sm: 2px;

  /* Typography */
  --pms-font-size-xs: 11px;
  --pms-font-size-sm: 12px;
  --pms-font-size-md: 13px;
  --pms-font-size-lg: 14px;
  --pms-line-height-tight: 1.3;
  --pms-line-height-normal: 1.4;

  /* Status colors - muted, professional */
  --pms-status-success: #28a745;
  --pms-status-warning: #ffc107;
  --pms-status-danger: #dc3545;
  --pms-status-info: #17a2b8;
  --pms-status-neutral: #6c757d;

  /* Booking state colors */
  --pms-booking-confirmed: #4a90e2;
  --pms-booking-checkin: #f39c12;
  --pms-booking-inhouse: #27ae60;
  --pms-booking-checkout: #e67e22;
  --pms-booking-unpaid: #e74c3c;
  --pms-booking-cancelled: #95a5a6;
}

/* PMS mode detection - apply operational styling to staff pages */
body:not(.public-site) {
  --bg: var(--pms-bg-base);
  --panel: var(--pms-bg-panel);
  --border: var(--pms-border-thin);
  --text: var(--pms-text-primary);
  --muted: var(--pms-text-secondary);
}
```

**Impact:** Foundation for all PMS interface changes

### 1.2 Create Compact Table Variant

**File:** `sandbox_pms_mvp/static/styles.css`
**Section:** Add after existing table styles

**New classes:**
```css
/* Dense operational table */
.table-pms {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--pms-font-size-md);
  line-height: var(--pms-line-height-tight);
}

.table-pms th,
.table-pms td {
  padding: 6px 10px;
  border-bottom: 1px solid var(--pms-border-thin);
  text-align: left;
  height: var(--pms-table-row-height);
}

.table-pms th {
  background: var(--pms-bg-hover);
  font-weight: 600;
  font-size: var(--pms-font-size-sm);
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--pms-text-secondary);
  white-space: nowrap;
}

.table-pms tbody tr:hover {
  background: var(--pms-bg-hover);
}

.table-pms-compact th,
.table-pms-compact td {
  padding: 4px 8px;
  height: var(--pms-table-row-height-compact);
  font-size: var(--pms-font-size-sm);
}

.table-pms .cell-nowrap {
  white-space: nowrap;
}

.table-pms .cell-number {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.table-pms .cell-actions {
  text-align: right;
  white-space: nowrap;
}
```

### 1.3 Create Compact Filter Block

**File:** `sandbox_pms_mvp/static/styles.css`

**New classes:**
```css
/* Compact PMS filter block */
.filter-block-pms {
  background: var(--pms-bg-filter);
  padding: var(--pms-filter-block-pad);
  border-radius: var(--pms-radius);
  margin-bottom: var(--pms-space-lg);
}

.filter-form-pms {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: var(--pms-space-md);
  align-items: end;
}

.filter-form-pms label {
  display: flex;
  flex-direction: column;
  gap: var(--pms-space-xs);
  color: rgba(255, 255, 255, 0.9);
  font-size: var(--pms-font-size-sm);
  font-weight: 500;
}

.filter-form-pms input,
.filter-form-pms select {
  height: var(--pms-input-height);
  padding: 0 8px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: var(--pms-radius-sm);
  background: rgba(255, 255, 255, 0.1);
  color: white;
  font-size: var(--pms-font-size-md);
}

.filter-form-pms input:focus,
.filter-form-pms select:focus {
  outline: 2px solid rgba(255, 255, 255, 0.3);
  outline-offset: 0;
}

.filter-form-pms button[type="submit"] {
  height: var(--pms-input-height);
  padding: 0 16px;
  background: var(--pms-status-success);
  color: white;
  border: none;
  border-radius: var(--pms-radius-sm);
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}

.filter-form-pms button[type="submit"]:hover {
  background: #239a41;
}

.filter-summary-pms {
  margin-top: var(--pms-space-md);
  padding-top: var(--pms-space-md);
  border-top: 1px solid var(--pms-border-thin);
  font-size: var(--pms-font-size-sm);
  color: var(--pms-text-muted);
}
```

### 1.4 Create Status Badge Variants

**File:** `sandbox_pms_mvp/static/styles.css`

**Update existing status badges:**
```css
/* Flat operational status badges */
.status-pms {
  display: inline-block;
  padding: 2px 8px;
  border-radius: var(--pms-radius-sm);
  font-size: var(--pms-font-size-xs);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  white-space: nowrap;
}

.status-pms.confirmed { background: #e3f2fd; color: #1565c0; }
.status-pms.checked_in { background: #fff3e0; color: #e65100; }
.status-pms.checked_out { background: #f3e5f5; color: #6a1b9a; }
.status-pms.cancelled { background: #f5f5f5; color: #757575; }
.status-pms.unpaid { background: #ffebee; color: #c62828; }
.status-pms.paid { background: #e8f5e9; color: #2e7d32; }
.status-pms.partial { background: #fff8e1; color: #f57f17; }
```

## Phase 2: Navigation - Compact Top Nav

### 2.1 Update Top Navigation Styling

**File:** `sandbox_pms_mvp/static/styles.css`
**Target:** `.site-header`, `.header-main-nav`, `.header-primary-link`

**Changes:**
```css
/* Compact PMS top navigation */
body:not(.public-site) .site-header {
  min-height: var(--pms-nav-height);
  background: var(--pms-bg-panel);
  border-bottom: 1px solid var(--pms-border-medium);
  backdrop-filter: none;
}

body:not(.public-site) .app-header {
  min-height: var(--pms-nav-height);
  gap: 8px;
}

body:not(.public-site) .header-primary-link {
  padding: 8px 14px;
  font-size: var(--pms-font-size-md);
  font-weight: 500;
  color: var(--pms-text-secondary);
  border-bottom: 2px solid transparent;
  transition: all 0.15s ease;
}

body:not(.public-site) .header-primary-link:hover {
  color: var(--pms-text-primary);
  background: var(--pms-bg-hover);
}

body:not(.public-site) .header-primary-link.active {
  color: var(--pms-text-primary);
  border-bottom-color: var(--accent);
  font-weight: 600;
}
```

**File:** `sandbox_pms_mvp/templates/base.html`
**No structural changes** - styling alone achieves compact tabs

## Phase 3: Calendar Board - Maximum Density

### 3.1 Increase Calendar Density Beyond Current "Ultra"

**File:** `sandbox_pms_mvp/static/styles.css`
**Section:** Planning board variables

**Update tokens:**
```css
:root {
  /* Even more aggressive density for reference match */
  --track-height-ultra: 26px;
  --day-header-height-ultra: 22px;
  --room-header-width-ultra: 110px;
  --day-column-min-ultra: 32px;

  /* New "reference" density mode */
  --track-height-reference: 24px;
  --day-header-height-reference: 20px;
  --room-header-width-reference: 100px;
  --day-column-min-reference: 30px;
}
```

### 3.2 Flatten Booking Block Styling

**File:** `sandbox_pms_mvp/static/styles.css`
**Section:** `.planning-board-block`

**Changes:**
```css
.planning-board-block {
  /* Flatter, more compact blocks */
  border-radius: var(--pms-radius-sm);
  padding: 2px 6px;
  font-size: var(--pms-font-size-xs);
  line-height: var(--pms-line-height-tight);
  border: 1px solid rgba(0, 0, 0, 0.12);
  box-shadow: none; /* Remove shadow */
}

.planning-board-block strong {
  font-size: var(--pms-font-size-sm);
  font-weight: 600;
}

.planning-board-block small {
  font-size: var(--pms-font-size-xs);
  opacity: 0.8;
}
```

### 3.3 Add Booking State Legend

**File:** `sandbox_pms_mvp/templates/front_desk_board.html`
**Location:** After planning-board-row2, before board surface

**Add:**
```html
<div class="planning-board-legend">
  <span class="legend-label">Legend:</span>
  <span class="legend-item"><span class="legend-swatch confirmed"></span>Confirmed</span>
  <span class="legend-item"><span class="legend-swatch checked_in"></span>Check-in</span>
  <span class="legend-item"><span class="legend-swatch in_house"></span>In-house</span>
  <span class="legend-item"><span class="legend-swatch checked_out"></span>Check-out</span>
  <span class="legend-item"><span class="legend-swatch unpaid"></span>Unpaid</span>
  <span class="legend-item"><span class="legend-swatch cancelled"></span>Cancelled</span>
  <span class="legend-item"><span class="legend-swatch blocked"></span>Blocked/Closed</span>
</div>
```

**Add CSS:**
```css
.planning-board-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  padding: 8px 0;
  font-size: var(--pms-font-size-sm);
  color: var(--pms-text-secondary);
}

.legend-label {
  font-weight: 600;
  margin-right: 4px;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 6px;
}

.legend-swatch {
  width: 16px;
  height: 12px;
  border-radius: 2px;
  border: 1px solid rgba(0, 0, 0, 0.1);
}

.legend-swatch.confirmed { background: var(--pms-booking-confirmed); }
.legend-swatch.checked_in { background: var(--pms-booking-checkin); }
.legend-swatch.in_house { background: var(--pms-booking-inhouse); }
.legend-swatch.checked_out { background: var(--pms-booking-checkout); }
.legend-swatch.unpaid { background: var(--pms-booking-unpaid); }
.legend-swatch.cancelled { background: var(--pms-booking-cancelled); }
.legend-swatch.blocked { background: var(--pms-status-neutral); }
```

### 3.4 Thin Grid Lines and Subtle Weekend Tint

**File:** `sandbox_pms_mvp/static/styles.css`

**Update:**
```css
.planning-board-grid {
  border: 1px solid var(--pms-border-thin); /* Thinner border */
}

.planning-board-day,
.planning-board-track {
  border-right: 1px solid var(--pms-border-thin); /* Thinner */
}

.planning-board-day.weekend {
  background: rgba(0, 0, 0, 0.02); /* More subtle */
}

.planning-board-day.today {
  background: rgba(74, 144, 226, 0.08); /* More subtle */
  border-left: 2px solid var(--pms-booking-confirmed);
}
```

## Phase 4: Booking List - Compact Filter & Dense Table

### 4.1 Redesign Reservations Page Structure

**File:** `sandbox_pms_mvp/templates/staff_reservations.html`

**Replace card-based layout with compact structure:**
```html
{% extends 'base.html' %}
{% block title %}Reservations | {{ hotel_name }}{% endblock %}
{% block content %}

{# Compact page header #}
<div class="pms-page-header">
  <div class="pms-page-title-group">
    <h1 class="pms-page-title">Reservations</h1>
    <div class="pms-page-actions">
      <a class="btn-pms btn-pms-sm" href="{{ url_for('staff_reservation_arrivals') }}">Arrivals</a>
      <a class="btn-pms btn-pms-sm" href="{{ url_for('staff_reservation_departures') }}">Departures</a>
      <a class="btn-pms btn-pms-sm" href="{{ url_for('staff_reservation_in_house') }}">In-house</a>
    </div>
  </div>
</div>

{# Compact dark filter block #}
<div class="filter-block-pms">
  <form class="filter-form-pms" method="get">
    <label>
      <span>Search</span>
      <input type="text" name="q" value="{{ filters.q }}" placeholder="Guest, phone, code, date">
    </label>
    <label>
      <span>Status</span>
      <select name="status">
        <option value="">Active by default</option>
        {% for option in reservation_statuses %}
        <option value="{{ option }}" {% if filters.status == option %}selected{% endif %}>
          {{ option.replace('_', ' ').title() }}
        </option>
        {% endfor %}
      </select>
    </label>
    <label>
      <span>Room type</span>
      <select name="room_type_id">
        <option value="">All types</option>
        {% for room_type in room_types %}
        <option value="{{ room_type.id }}" {% if filters.room_type_id == room_type.id|string %}selected{% endif %}>
          {{ room_type.code }}
        </option>
        {% endfor %}
      </select>
    </label>
    <label>
      <span>Arrival from</span>
      <input type="date" name="arrival_date" value="{{ filters.arrival_date }}">
    </label>
    <label>
      <span>Arrival until</span>
      <input type="date" name="departure_date" value="{{ filters.departure_date }}">
    </label>
    <label>
      <span>Payment</span>
      <select name="payment_state">
        <option value="">All states</option>
        <option value="missing" {% if filters.payment_state == 'missing' %}selected{% endif %}>Deposit missing</option>
        <option value="partial" {% if filters.payment_state == 'partial' %}selected{% endif %}>Partial</option>
        <option value="paid" {% if filters.payment_state == 'paid' %}selected{% endif %}>Paid</option>
      </select>
    </label>
    <label>
      <span>Source</span>
      <select name="booking_source">
        <option value="">All sources</option>
        {% for source in booking_sources %}
        <option value="{{ source }}" {% if filters.booking_source == source %}selected{% endif %}>
          {{ source.replace('_', ' ') }}
        </option>
        {% endfor %}
      </select>
    </label>
    <button type="submit">Search</button>
  </form>

  <div class="filter-summary-pms">
    <strong>{{ result['total'] }}</strong> reservations matched
  </div>
</div>

{# Utility actions bar #}
<div class="pms-results-toolbar">
  <span class="pms-results-count">Showing {{ result['items']|length }} of {{ result['total'] }}</span>
  <div class="pms-results-actions">
    {% if can_create %}
    <a class="btn-pms btn-pms-primary btn-pms-sm" href="{{ url_for('staff_reservation_create') }}">+ New reservation</a>
    {% endif %}
    <button class="btn-pms btn-pms-sm" type="button">Export CSV</button>
  </div>
</div>

{# Dense results table #}
<div class="pms-table-container">
  <table class="table-pms table-pms-compact">
    <thead>
      <tr>
        <th>Reference</th>
        <th>Guest</th>
        <th>Phone</th>
        <th>Room</th>
        <th>Check-in</th>
        <th>Check-out</th>
        <th>Nights</th>
        <th>Status</th>
        <th>Payment</th>
        <th>Balance</th>
        <th>Source</th>
        <th class="cell-actions">Actions</th>
      </tr>
    </thead>
    <tbody>
      {% for item in result['items'] %}
      <tr>
        <td class="cell-nowrap">
          <strong>{{ item.reservation_code }}</strong>
          {% if item.duplicate_suspected %}<span class="badge-tiny">Dup</span>{% endif %}
        </td>
        <td><strong>{{ item.guest_name }}</strong></td>
        <td class="cell-nowrap">{{ item.guest_phone }}</td>
        <td>
          {{ item.room_type_code }}
          <span class="text-muted-pms">{{ item.assigned_room_number or 'Unassigned' }}</span>
        </td>
        <td class="cell-nowrap">{{ item.arrival_date }}</td>
        <td class="cell-nowrap">{{ item.departure_date }}</td>
        <td class="cell-number">{{ item.nights }}</td>
        <td><span class="status-pms {{ item.status }}">{{ item.status[:3] }}</span></td>
        <td>
          {% if can_folio %}
          <span class="status-pms {{ item.deposit_state }}">{{ item.deposit_state[:3] }}</span>
          {% else %}
          <span class="text-muted-pms">N/A</span>
          {% endif %}
        </td>
        <td class="cell-number">
          {% if can_folio %}
          {{ currency }} {{ item.balance_due|money }}
          {% else %}
          <span class="text-muted-pms">N/A</span>
          {% endif %}
        </td>
        <td class="cell-nowrap">{{ item.source_channel.replace('_', ' ')[:10] }}</td>
        <td class="cell-actions">
          <a class="btn-pms btn-pms-xs" href="{{ url_for('staff_reservation_detail', reservation_id=item.id, back=request.full_path.rstrip('?')) }}">Open</a>
        </td>
      </tr>
      {% else %}
      <tr>
        <td colspan="12" class="center text-muted-pms">No reservations matched the current filters.</td>
      </tr>
      {% endfor %}
    </tbody>
  </table>
</div>

{# Compact pagination #}
{% if result['pages'] > 1 %}
<div class="pms-pagination">
  <span>Page {{ result['page'] }} of {{ result['pages'] }}</span>
  <div>
    {% if result['page'] > 1 %}
    <a class="btn-pms btn-pms-sm" href="{{ url_for('staff_reservations', ..., page=result['page']-1) }}">Previous</a>
    {% endif %}
    {% if result['page'] < result['pages'] %}
    <a class="btn-pms btn-pms-sm" href="{{ url_for('staff_reservations', ..., page=result['page']+1) }}">Next</a>
    {% endif %}
  </div>
</div>
{% endif %}

{% endblock %}
```

### 4.2 Add Supporting CSS

**File:** `sandbox_pms_mvp/static/styles.css`

```css
/* PMS page structure */
.pms-page-header {
  margin-bottom: var(--pms-space-lg);
}

.pms-page-title-group {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--pms-space-lg);
}

.pms-page-title {
  font-size: 20px;
  font-weight: 600;
  margin: 0;
  color: var(--pms-text-primary);
}

.pms-page-actions {
  display: flex;
  gap: var(--pms-space-sm);
}

.pms-results-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--pms-space-md);
  padding: var(--pms-space-md) 0;
}

.pms-results-count {
  font-size: var(--pms-font-size-sm);
  color: var(--pms-text-secondary);
}

.pms-results-actions {
  display: flex;
  gap: var(--pms-space-sm);
}

.pms-table-container {
  background: var(--pms-bg-panel);
  border: 1px solid var(--pms-border-thin);
  border-radius: var(--pms-radius);
  overflow-x: auto;
}

.pms-pagination {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: var(--pms-space-lg);
  padding: var(--pms-space-md) 0;
  font-size: var(--pms-font-size-sm);
  color: var(--pms-text-secondary);
}

.pms-pagination div {
  display: flex;
  gap: var(--pms-space-sm);
}

/* PMS buttons */
.btn-pms {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 6px 14px;
  border: 1px solid var(--pms-border-medium);
  border-radius: var(--pms-radius-sm);
  background: var(--pms-bg-panel);
  color: var(--pms-text-primary);
  font-size: var(--pms-font-size-md);
  font-weight: 500;
  text-decoration: none;
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
}

.btn-pms:hover {
  background: var(--pms-bg-hover);
  border-color: var(--pms-text-secondary);
}

.btn-pms-primary {
  background: var(--pms-status-success);
  color: white;
  border-color: var(--pms-status-success);
}

.btn-pms-primary:hover {
  background: #239a41;
  border-color: #239a41;
}

.btn-pms-sm {
  padding: 4px 10px;
  font-size: var(--pms-font-size-sm);
}

.btn-pms-xs {
  padding: 2px 8px;
  font-size: var(--pms-font-size-xs);
}

.text-muted-pms {
  color: var(--pms-text-muted);
  font-size: var(--pms-font-size-sm);
}

.badge-tiny {
  display: inline-block;
  padding: 1px 4px;
  background: var(--pms-status-warning);
  color: white;
  font-size: 10px;
  font-weight: 700;
  border-radius: 2px;
  margin-left: 4px;
}
```

## Phase 5: Booking Modal - New Modal System

### 5.1 Create Modal Overlay System

**File:** `sandbox_pms_mvp/static/styles.css`

```css
/* Modal overlay system */
.modal-overlay-pms {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.6);
  z-index: 1000;
  display: none;
  align-items: center;
  justify-content: center;
  padding: 20px;
}

.modal-overlay-pms.active {
  display: flex;
}

.modal-pms {
  background: var(--pms-bg-panel);
  border-radius: var(--pms-radius);
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
  max-width: 1200px;
  width: 100%;
  max-height: 90vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.modal-header-pms {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--pms-space-lg);
  border-bottom: 1px solid var(--pms-border-thin);
}

.modal-title-pms {
  font-size: 18px;
  font-weight: 600;
  margin: 0;
}

.modal-close-pms {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: none;
  color: var(--pms-text-secondary);
  font-size: 24px;
  cursor: pointer;
  border-radius: var(--pms-radius-sm);
}

.modal-close-pms:hover {
  background: var(--pms-bg-hover);
  color: var(--pms-text-primary);
}

.modal-body-pms {
  flex: 1;
  overflow-y: auto;
  padding: var(--pms-space-lg);
}

.modal-footer-pms {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--pms-space-lg);
  border-top: 1px solid var(--pms-border-thin);
  gap: var(--pms-space-md);
}
```

### 5.2 Create Booking Detail Modal Template

**File:** `sandbox_pms_mvp/templates/_booking_detail_modal.html` (new file)

```html
<div class="modal-overlay-pms" id="booking-detail-modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
  <div class="modal-pms">
    <div class="modal-header-pms">
      <h2 class="modal-title-pms" id="modal-title">Booking Detail - {{ booking.reservation_code }}</h2>
      <button class="modal-close-pms" type="button" aria-label="Close modal">&times;</button>
    </div>

    <div class="modal-body-pms">
      {# Compact booking summary bar #}
      <div class="booking-summary-bar">
        <div class="booking-summary-dates">
          <span class="label">Check-in</span>
          <strong>{{ booking.arrival_date }}</strong>
        </div>
        <div class="booking-summary-separator">→</div>
        <div class="booking-summary-dates">
          <span class="label">Check-out</span>
          <strong>{{ booking.departure_date }}</strong>
        </div>
        <div class="booking-summary-item">
          <span class="label">Nights</span>
          <strong>{{ booking.nights }}</strong>
        </div>
        <div class="booking-summary-item">
          <span class="label">Status</span>
          <span class="status-pms {{ booking.status }}">{{ booking.status }}</span>
        </div>
      </div>

      {# Single horizontal row for room details #}
      <div class="booking-room-row">
        <label>
          <span>Room type</span>
          <select name="room_type_id">
            {% for rt in room_types %}
            <option value="{{ rt.id }}" {% if rt.id == booking.room_type_id %}selected{% endif %}>
              {{ rt.code }} - {{ rt.name }}
            </option>
            {% endfor %}
          </select>
        </label>
        <label>
          <span>Rate</span>
          <input type="number" name="rate" value="{{ booking.rate_per_night }}" step="0.01">
        </label>
        <label>
          <span>Adults</span>
          <input type="number" name="adults" value="{{ booking.adults }}" min="1">
        </label>
        <label>
          <span>Children</span>
          <input type="number" name="children" value="{{ booking.children }}" min="0">
        </label>
        <label>
          <span>Room</span>
          <select name="room_id">
            <option value="">Unassigned</option>
            {% for room in available_rooms %}
            <option value="{{ room.id }}" {% if room.id == booking.room_id %}selected{% endif %}>
              {{ room.number }}
            </option>
            {% endfor %}
          </select>
        </label>
      </div>

      {# Two-column form + financial summary #}
      <div class="booking-detail-grid">
        <div class="booking-form-section">
          <h3 class="section-heading">Guest Information</h3>
          <div class="form-grid-2col">
            <label>
              <span>First name</span>
              <input type="text" name="guest_first_name" value="{{ booking.guest_first_name }}">
            </label>
            <label>
              <span>Last name</span>
              <input type="text" name="guest_last_name" value="{{ booking.guest_last_name }}">
            </label>
            <label>
              <span>Email</span>
              <input type="email" name="guest_email" value="{{ booking.guest_email }}">
            </label>
            <label>
              <span>Phone</span>
              <input type="tel" name="guest_phone" value="{{ booking.guest_phone }}">
            </label>
            <label>
              <span>Country</span>
              <input type="text" name="guest_country" value="{{ booking.guest_country }}">
            </label>
            <label>
              <span>ID/Passport</span>
              <input type="text" name="guest_id_number" value="{{ booking.guest_id_number }}">
            </label>
          </div>

          <h3 class="section-heading">Special Requests</h3>
          <label>
            <span>Notes</span>
            <textarea name="notes" rows="4">{{ booking.notes }}</textarea>
          </label>

          <h3 class="section-heading">Internal Notes</h3>
          <label>
            <span>Staff notes</span>
            <textarea name="staff_notes" rows="3">{{ booking.staff_notes }}</textarea>
          </label>
        </div>

        {# Financial summary panel #}
        <div class="booking-financial-panel">
          <h3 class="section-heading">Financial Summary</h3>
          <div class="financial-line-items">
            <div class="line-item">
              <span>Room charges</span>
              <strong>{{ currency }} {{ booking.room_charges|money }}</strong>
            </div>
            <div class="line-item">
              <span>Additional charges</span>
              <strong>{{ currency }} {{ booking.additional_charges|money }}</strong>
            </div>
            <div class="line-item subtotal">
              <span>Subtotal</span>
              <strong>{{ currency }} {{ booking.subtotal|money }}</strong>
            </div>
            <div class="line-item">
              <span>Tax</span>
              <strong>{{ currency }} {{ booking.tax|money }}</strong>
            </div>
            <div class="line-item total">
              <span>Total</span>
              <strong>{{ currency }} {{ booking.total|money }}</strong>
            </div>
            <div class="line-item">
              <span>Paid</span>
              <strong class="text-success">{{ currency }} {{ booking.amount_paid|money }}</strong>
            </div>
            <div class="line-item balance">
              <span>Balance due</span>
              <strong class="text-danger">{{ currency }} {{ booking.balance_due|money }}</strong>
            </div>
          </div>

          <div class="financial-actions">
            <button class="btn-pms btn-pms-sm" type="button">Record payment</button>
            <button class="btn-pms btn-pms-sm" type="button">Send invoice</button>
          </div>
        </div>
      </div>
    </div>

    <div class="modal-footer-pms">
      <div>
        <button class="btn-pms" type="button">Cancel</button>
        <button class="btn-pms" type="button">Send confirmation</button>
      </div>
      <div>
        <button class="btn-pms btn-pms-primary" type="submit">Save changes</button>
      </div>
    </div>
  </div>
</div>
```

### 5.3 Add Modal Styling

**File:** `sandbox_pms_mvp/static/styles.css`

```css
/* Booking modal specific styles */
.booking-summary-bar {
  display: flex;
  align-items: center;
  gap: var(--pms-space-lg);
  padding: var(--pms-space-lg);
  background: var(--pms-bg-hover);
  border-radius: var(--pms-radius);
  margin-bottom: var(--pms-space-lg);
}

.booking-summary-dates,
.booking-summary-item {
  display: flex;
  flex-direction: column;
  gap: var(--pms-space-xs);
}

.booking-summary-dates .label,
.booking-summary-item .label {
  font-size: var(--pms-font-size-xs);
  color: var(--pms-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.booking-summary-separator {
  font-size: 20px;
  color: var(--pms-text-muted);
}

.booking-room-row {
  display: grid;
  grid-template-columns: 2fr 1fr 1fr 1fr 1.5fr;
  gap: var(--pms-space-md);
  padding: var(--pms-space-lg);
  background: var(--pms-bg-panel);
  border: 1px solid var(--pms-border-thin);
  border-radius: var(--pms-radius);
  margin-bottom: var(--pms-space-lg);
}

.booking-room-row label {
  display: flex;
  flex-direction: column;
  gap: var(--pms-space-xs);
}

.booking-room-row span {
  font-size: var(--pms-font-size-sm);
  font-weight: 600;
  color: var(--pms-text-secondary);
}

.booking-room-row input,
.booking-room-row select {
  height: var(--pms-input-height);
  padding: 0 8px;
  border: 1px solid var(--pms-border-medium);
  border-radius: var(--pms-radius-sm);
  font-size: var(--pms-font-size-md);
}

.booking-detail-grid {
  display: grid;
  grid-template-columns: 1.5fr 1fr;
  gap: var(--pms-space-xl);
}

.section-heading {
  font-size: 15px;
  font-weight: 600;
  margin: var(--pms-space-lg) 0 var(--pms-space-md);
  color: var(--pms-text-primary);
}

.section-heading:first-child {
  margin-top: 0;
}

.form-grid-2col {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: var(--pms-space-md);
}

.form-grid-2col label {
  display: flex;
  flex-direction: column;
  gap: var(--pms-space-xs);
}

.form-grid-2col span {
  font-size: var(--pms-font-size-sm);
  font-weight: 500;
  color: var(--pms-text-secondary);
}

.form-grid-2col input,
.form-grid-2col textarea {
  padding: 6px 10px;
  border: 1px solid var(--pms-border-medium);
  border-radius: var(--pms-radius-sm);
  font-size: var(--pms-font-size-md);
}

.form-grid-2col textarea {
  resize: vertical;
}

.booking-form-section label:not(.form-grid-2col label) {
  display: flex;
  flex-direction: column;
  gap: var(--pms-space-xs);
}

.booking-form-section > label span {
  font-size: var(--pms-font-size-sm);
  font-weight: 500;
  color: var(--pms-text-secondary);
}

.booking-form-section textarea {
  padding: 8px 10px;
  border: 1px solid var(--pms-border-medium);
  border-radius: var(--pms-radius-sm);
  font-size: var(--pms-font-size-md);
  resize: vertical;
}

.booking-financial-panel {
  background: var(--pms-bg-hover);
  border: 1px solid var(--pms-border-thin);
  border-radius: var(--pms-radius);
  padding: var(--pms-space-lg);
  height: fit-content;
  position: sticky;
  top: 0;
}

.financial-line-items {
  display: flex;
  flex-direction: column;
  gap: var(--pms-space-sm);
}

.line-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--pms-space-sm) 0;
  font-size: var(--pms-font-size-md);
}

.line-item.subtotal,
.line-item.total,
.line-item.balance {
  padding-top: var(--pms-space-md);
  border-top: 1px solid var(--pms-border-medium);
  font-weight: 600;
}

.line-item.total {
  font-size: 16px;
}

.line-item.balance strong {
  font-size: 18px;
}

.text-success {
  color: var(--pms-status-success);
}

.text-danger {
  color: var(--pms-status-danger);
}

.financial-actions {
  display: flex;
  flex-direction: column;
  gap: var(--pms-space-sm);
  margin-top: var(--pms-space-lg);
}

.financial-actions .btn-pms {
  width: 100%;
}
```

### 5.4 Create Modal JavaScript Controller

**File:** `sandbox_pms_mvp/static/booking-modal.js` (new file)

```javascript
// Booking detail modal controller
(function() {
  'use strict';

  const modal = document.getElementById('booking-detail-modal');
  if (!modal) return;

  const closeBtn = modal.querySelector('.modal-close-pms');
  const overlay = modal;

  function openModal(bookingId) {
    // Fetch booking data and populate modal
    fetch(`/staff/api/reservations/${bookingId}/detail`)
      .then(res => res.json())
      .then(data => {
        populateModal(data);
        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
      })
      .catch(err => console.error('Failed to load booking:', err));
  }

  function closeModal() {
    modal.classList.remove('active');
    document.body.style.overflow = '';
  }

  function populateModal(data) {
    // Populate modal fields with booking data
    // Implementation depends on actual data structure
  }

  // Close on button click
  if (closeBtn) {
    closeBtn.addEventListener('click', closeModal);
  }

  // Close on overlay click (not on modal content)
  overlay.addEventListener('click', function(e) {
    if (e.target === overlay) {
      closeModal();
    }
  });

  // Close on Escape key
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && modal.classList.contains('active')) {
      closeModal();
    }
  });

  // Expose global function to open modal
  window.openBookingModal = openModal;
})();
```

## Phase 6: Housekeeping - Simplified Report Structure

### 6.1 Simplify Housekeeping Page

**File:** `sandbox_pms_mvp/templates/housekeeping_board.html`

**Simplified structure focusing on reference's minimalist report design:**

```html
{% extends 'base.html' %}
{% block title %}Housekeeping | {{ hotel_name }}{% endblock %}
{% block content %}

{# Compact page header with date toggle buttons #}
<div class="hk-page-header-pms">
  <div>
    <h1 class="pms-page-title">Housekeeping</h1>
    <p class="pms-page-subtitle">Daily operations report</p>
  </div>
  <div class="hk-date-toggle">
    <a class="hk-date-btn {% if is_today %}active{% endif %}"
       href="{{ url_for('staff_housekeeping', date=today_date.isoformat()) }}">Today</a>
    <a class="hk-date-btn {% if is_tomorrow %}active{% endif %}"
       href="{{ url_for('staff_housekeeping', date=tomorrow_date.isoformat()) }}">Tomorrow</a>
    <input class="hk-date-input" type="date" name="date" value="{{ board.business_date.isoformat() }}"
           onchange="window.location.href='/staff/housekeeping?date=' + this.value">
  </div>
  <button class="btn-pms btn-pms-sm" onclick="window.print()">Print report</button>
</div>

{# Simple compact filter row #}
<div class="hk-filter-row-pms">
  <form method="get" class="hk-filter-inline">
    <select name="floor" onchange="this.form.submit()">
      <option value="">All floors</option>
      <option value="2" {% if filters.floor == '2' %}selected{% endif %}>Floor 2</option>
      <option value="3" {% if filters.floor == '3' %}selected{% endif %}>Floor 3</option>
    </select>
    <select name="status" onchange="this.form.submit()">
      <option value="">All statuses</option>
      {% for st in housekeeping_statuses %}
      <option value="{{ st }}" {% if filters.status == st %}selected{% endif %}>{{ st.replace('_', ' ') }}</option>
      {% endfor %}
    </select>
    <select name="priority" onchange="this.form.submit()">
      <option value="">All priorities</option>
      <option value="urgent">Urgent</option>
      <option value="high">High</option>
      <option value="normal">Normal</option>
    </select>
  </form>
  <span class="hk-last-updated">Last updated: {{ now().strftime('%H:%M') }}</span>
</div>

{# Report date header #}
<div class="hk-report-date">
  <strong>{{ board.business_date.strftime('%A, %d %B %Y') }}</strong>
</div>

{# Simple dense table matching reference #}
<div class="pms-table-container">
  <table class="table-pms table-pms-compact hk-table">
    <thead>
      <tr>
        <th>Room</th>
        <th>Type</th>
        <th>Availability</th>
        <th>Guest</th>
        <th>Notes</th>
        <th>Status</th>
        <th>Actions</th>
      </tr>
    </thead>
    <tbody>
      {% for item in board.items %}
      <tr class="{% if item.priority == 'urgent' %}row-urgent{% endif %}">
        <td class="cell-nowrap"><strong>{{ item.room_number }}</strong></td>
        <td>{{ item.room_type_code }}</td>
        <td>
          {% if item.has_arrival %}<span class="badge-tiny badge-arrival">Arrival</span>{% endif %}
          {% if item.has_departure %}<span class="badge-tiny badge-departure">Departure</span>{% endif %}
          {% if item.is_vacant %}<span class="badge-tiny badge-vacant">Vacant</span>{% endif %}
        </td>
        <td>
          {% if item.guest_name %}
          <strong>{{ item.guest_name }}</strong>
          {% else %}
          <span class="text-muted-pms">—</span>
          {% endif %}
        </td>
        <td class="cell-notes">
          {% if item.notes %}
          <span class="notes-preview">{{ item.notes[:40] }}{% if item.notes|length > 40 %}...{% endif %}</span>
          {% else %}
          <span class="text-muted-pms">—</span>
          {% endif %}
        </td>
        <td>
          <span class="status-pms {{ item.hk_status }}">{{ item.hk_status.replace('_', ' ') }}</span>
        </td>
        <td class="cell-actions">
          <a class="btn-pms btn-pms-xs" href="{{ url_for('staff_housekeeping_room_detail', room_id=item.room_id, date=board.business_date.isoformat()) }}">Detail</a>
        </td>
      </tr>
      {% endfor %}
    </tbody>
  </table>
</div>

{% endblock %}
```

### 6.2 Add Housekeeping-Specific Styles

**File:** `sandbox_pms_mvp/static/styles.css`

```css
/* Housekeeping page styles */
.hk-page-header-pms {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--pms-space-lg);
  padding-bottom: var(--pms-space-lg);
  border-bottom: 1px solid var(--pms-border-thin);
}

.pms-page-subtitle {
  font-size: var(--pms-font-size-md);
  color: var(--pms-text-secondary);
  margin: var(--pms-space-xs) 0 0;
}

.hk-date-toggle {
  display: flex;
  gap: 0;
  border: 1px solid var(--pms-border-medium);
  border-radius: var(--pms-radius-sm);
  overflow: hidden;
}

.hk-date-btn {
  padding: 6px 14px;
  background: var(--pms-bg-panel);
  color: var(--pms-text-secondary);
  border-right: 1px solid var(--pms-border-medium);
  font-size: var(--pms-font-size-sm);
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
}

.hk-date-btn:last-child {
  border-right: none;
}

.hk-date-btn:hover {
  background: var(--pms-bg-hover);
  color: var(--pms-text-primary);
}

.hk-date-btn.active {
  background: var(--accent);
  color: white;
}

.hk-date-input {
  height: var(--pms-input-height);
  padding: 0 10px;
  border: none;
  border-left: 1px solid var(--pms-border-medium);
  background: var(--pms-bg-panel);
  font-size: var(--pms-font-size-sm);
}

.hk-filter-row-pms {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--pms-space-lg);
  padding: var(--pms-space-md);
  background: var(--pms-bg-hover);
  border-radius: var(--pms-radius);
}

.hk-filter-inline {
  display: flex;
  gap: var(--pms-space-sm);
}

.hk-filter-inline select {
  height: var(--pms-input-height-sm);
  padding: 0 8px;
  border: 1px solid var(--pms-border-medium);
  border-radius: var(--pms-radius-sm);
  font-size: var(--pms-font-size-sm);
}

.hk-last-updated {
  font-size: var(--pms-font-size-xs);
  color: var(--pms-text-muted);
}

.hk-report-date {
  margin-bottom: var(--pms-space-md);
  padding: var(--pms-space-md);
  background: var(--pms-bg-panel);
  border-left: 3px solid var(--accent);
  font-size: var(--pms-font-size-lg);
}

.hk-table .row-urgent {
  background: rgba(220, 53, 69, 0.05);
}

.cell-notes {
  max-width: 200px;
}

.notes-preview {
  font-size: var(--pms-font-size-sm);
  color: var(--pms-text-secondary);
}

.badge-arrival {
  background: var(--pms-booking-checkin);
}

.badge-departure {
  background: var(--pms-booking-checkout);
}

.badge-vacant {
  background: var(--pms-status-neutral);
}
```

## Phase 7: Polish - Cross-Page Consistency

### 7.1 Update Provider Bookings Page

Apply same compact treatment as staff reservations:
- Replace card layout with compact header
- Add dark filter block
- Use dense table
- Add results toolbar

**File:** `sandbox_pms_mvp/templates/provider_bookings.html`
Follow same pattern as staff_reservations.html redesign

### 7.2 Ensure Responsive Behavior

**File:** `sandbox_pms_mvp/static/styles.css`

```css
/* Responsive adjustments for PMS interfaces */
@media (max-width: 1200px) {
  .booking-detail-grid {
    grid-template-columns: 1fr;
  }

  .booking-financial-panel {
    position: static;
  }
}

@media (max-width: 900px) {
  .booking-room-row {
    grid-template-columns: 1fr 1fr;
  }

  .filter-form-pms {
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  }
}

@media (max-width: 600px) {
  .pms-page-title-group {
    flex-direction: column;
    align-items: flex-start;
  }

  .booking-room-row {
    grid-template-columns: 1fr;
  }

  .form-grid-2col {
    grid-template-columns: 1fr;
  }

  .pms-table-container {
    overflow-x: auto;
  }

  .table-pms {
    min-width: 800px;
  }
}
```

### 7.3 Print Styles for Housekeeping

**File:** `sandbox_pms_mvp/static/styles.css`

```css
/* Print styles for housekeeping report */
@media print {
  .site-header,
  .hk-page-header-pms button,
  .hk-filter-row-pms,
  .cell-actions,
  .btn-pms {
    display: none !important;
  }

  body {
    background: white;
    color: black;
  }

  .pms-table-container {
    border: none;
  }

  .table-pms {
    font-size: 11px;
  }

  .table-pms th,
  .table-pms td {
    padding: 4px 6px;
    border: 1px solid #ddd;
  }

  .hk-report-date {
    margin-bottom: 16px;
    padding: 8px;
    background: #f5f5f5;
    border-left: 3px solid black;
  }
}
```

## Phase 8: Validation & Documentation

### 8.1 Testing Checklist

**Functional Testing:**
- [ ] All reservations list filters work correctly
- [ ] Booking modal opens and closes properly
- [ ] Booking modal form validation works
- [ ] Calendar board drag/drop still functions
- [ ] Housekeeping date navigation works
- [ ] Housekeeping filters apply correctly
- [ ] Print functionality works for housekeeping
- [ ] All CRUD operations still function
- [ ] Permissions still enforced correctly
- [ ] Responsive breakpoints work

**Visual Testing:**
- [ ] Calendar board shows 14+ days and 20+ rooms on 1920x1080
- [ ] Table row heights match reference (~32-36px)
- [ ] Filter blocks are compact and visually distinct
- [ ] Status badges are flat and readable
- [ ] Modal layout matches reference structure
- [ ] Housekeeping page is minimal and printable
- [ ] Navigation tabs are compact
- [ ] All pages have consistent density

**Browser Testing:**
- [ ] Chrome latest
- [ ] Firefox latest
- [ ] Safari latest
- [ ] Edge latest

**Accessibility Testing:**
- [ ] Keyboard navigation works
- [ ] Screen reader announces correctly
- [ ] Focus indicators visible
- [ ] Color contrast meets WCAG AA
- [ ] Modal traps focus properly

### 8.2 Create UI Diff Notes

**File:** `ui_diff_notes.md`
Document:
- What was changed page by page
- What matches reference exactly
- What had to be adapted
- What remains different and why

### 8.3 Create QA Report

**File:** `qa_report.md`
Document:
- Layout QA results
- Density measurements
- Booking workflow validation
- Calendar interaction validation
- Modal behavior validation
- Housekeeping report validation
- Responsiveness results
- Bugs found and fixed
- Known limitations

## Implementation Notes

### Order of Implementation
1. Complete Phase 1 (foundation) first - all other phases depend on it
2. Phase 2 (navigation) next - affects all pages
3. Phases 3-6 can be done in order or parallel (calendar → booking list → modal → housekeeping)
4. Phase 7 (polish) after core pages done
5. Phase 8 (validation) last

### Risk Mitigation
- Test after each phase
- Keep git commits small and focused
- Preserve all data attributes and JS hooks
- Don't remove existing functionality
- Add new classes alongside old ones initially
- Remove old classes only after validation

### Performance Considerations
- CSS custom properties are performant
- Dense tables may need virtual scrolling for 1000+ rows (future enhancement)
- Modal overlay should use will-change for smooth animation
- Calendar board grid should remain CSS Grid for performance

### Accessibility Considerations
- All interactive elements must be keyboard accessible
- Modal must trap focus
- Status colors must have sufficient contrast
- Form labels must be properly associated
- ARIA labels for icon-only buttons
- Responsive text sizing

### Browser Compatibility
- CSS Grid: IE11+ (or feature detection)
- CSS custom properties: IE11+ (with fallbacks)
- Modern JavaScript: ES6+ (transpile if needed)
- Flexbox: All modern browsers

## Success Criteria

### Quantitative
- ✅ Show 50% more table rows without scrolling
- ✅ Calendar shows 14+ days and 20+ rooms on 1920x1080
- ✅ Vertical space reduced by 40%
- ✅ Row heights 32-36px (down from 48-56px)
- ✅ Filter block height reduced by 30%

### Qualitative
- ✅ Looks like professional operational PMS
- ✅ Staff can quickly scan many items
- ✅ Less scrolling required
- ✅ Serious, practical, business-focused aesthetic
- ✅ Reference users feel familiar

## Conclusion

This plan provides a systematic approach to replicating the reference PMS interface design into Sandbox PMS. Each phase builds on the previous, with clear deliverables and validation steps. The implementation preserves all business logic while dramatically improving information density and operational efficiency.

**Estimated effort:** 20-30 hours for complete implementation and testing
**Risk level:** Medium (significant UI changes but business logic preserved)
**Impact:** High (major UX improvement for operational efficiency)
