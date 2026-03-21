# Core Reservation Control Layer — Architecture Overview

This document describes the reservation control layer that powers
the Sandbox Hotel PMS front-desk operations.

---

## Reservation Lifecycle

```
inquiry → tentative → confirmed → checked_in → checked_out
                ↓                        ↓
           cancelled                  no_show
```

### Status Definitions

| Status | Description |
|--------|-------------|
| `inquiry` | Guest expressed interest; no commitment yet |
| `tentative` | Booking created but deposit not yet received |
| `confirmed` | Deposit received or deposit not required |
| `checked_in` | Guest is in-house |
| `checked_out` | Stay completed |
| `cancelled` | Booking cancelled before arrival |
| `no_show` | Guest did not arrive |
| `waitlist` | Booking on wait list when room type is full |
| `house_use` | Internal/staff use — no charge |

### Status Transitions

- **Create**: → `tentative` (if deposit required) or `confirmed`
- **Deposit received**: `tentative` → `confirmed`
- **Check-in**: `confirmed` → `checked_in`
- **Check-out**: `checked_in` → `checked_out`
- **Cancel**: `tentative` | `confirmed` → `cancelled`
- **No-show**: `confirmed` → `no_show`

Each transition records a `ReservationStatusHistory` entry and an
`AuditLog` / `ActivityLog` event.

---

## Availability Logic

### Inventory Model

Availability is tracked at the **room × date** level using the
`InventoryDay` table.  Each row represents one room for one
business date and carries:

| Field | Purpose |
|-------|---------|
| `availability_status` | `available`, `held`, `reserved`, `occupied`, `house_use`, `out_of_service`, `out_of_order` |
| `reservation_id` | Link to the occupying reservation (null when available) |
| `is_sellable` | Whether the row can be sold |
| `is_blocked` | Manual block flag |
| `maintenance_flag` | Maintenance hold |

### Centralized Availability Service

`pms/services/availability_service.py` provides a single source of
truth for all availability queries:

| Function | Purpose |
|----------|---------|
| `query_room_type_availability(check_in, check_out, room_type_id?)` | Full availability matrix |
| `count_available_rooms(room_type_id, check_in, check_out)` | Bottleneck count |
| `can_move_reservation(reservation_id, target_room_id, …)` | Validate room move |
| `list_assignable_rooms(room_type_id, check_in, check_out, …)` | Rooms available for assignment |
| `estimate_inventory_impact(action, room_type_id, dates, …)` | Preview create/modify/cancel effect |

The service checks:
- `InventoryDay` rows (status, sellability, blocks, maintenance)
- `BlackoutPeriod` records (property closures)
- `ExternalCalendarBlock` entries (OTA blocks via iCal sync)
- `InventoryOverride` records (manual closures)

### Inventory Mutation Flow

```
create_reservation()
  → choose_available_room()  (find room with all nights available)
  → allocate_inventory()     (set InventoryDay status to reserved)

cancel_reservation()
  → release_inventory()      (reset InventoryDay rows to available)

assign_room() / change_stay_dates()
  → release old inventory
  → allocate new inventory
```

---

## Rate Engine

### Rate Calculation (`pms/pricing.py`)

Rates are calculated per-night using `RateRule` records:

1. Query active rules matching room type, date, and stay length
2. Apply `base_rate` rules first (set the base nightly price)
3. Apply `adjustment` rules (percentage or fixed delta)
4. Apply `long_stay_discount` rules last
5. Sum nightly rates across the stay
6. Add extra-guest and child fees
7. Calculate VAT

### Rate Rule Types

| Type | Effect |
|------|--------|
| `base_rate` | Sets absolute nightly rate |
| `adjustment` | Adds/subtracts percentage or fixed amount |
| `long_stay_discount` | Discount applied after base calculation |

### Adjustment Types

| Type | Effect |
|------|--------|
| `fixed` | Replace with fixed amount |
| `amount_delta` | Add/subtract fixed amount |
| `percent_delta` | Add/subtract percentage |

---

## Channel Manager Integration

### Architecture

The channel layer uses a **provider adapter pattern** so the system
can support multiple external channel integrations.

```
ChannelProvider (abstract)
├── ICalChannelProvider   — wraps existing iCal sync
├── MockChannelProvider   — safe local testing
└── (future providers)    — Booking.com API, Expedia API, etc.
```

### Components

| Module | Purpose |
|--------|---------|
| `pms/services/channel_service.py` | Provider registry, sync orchestrator, DTOs |
| `pms/services/ical_service.py` | iCal feed export/import (Airbnb, Booking.com, VRBO) |

### Data Transfer Objects

| DTO | Direction | Purpose |
|-----|-----------|---------|
| `InboundReservation` | Pull | Normalized external booking payload |
| `OutboundInventoryUpdate` | Push | Availability/rate update for external channel |
| `SyncResult` | Both | Outcome of sync operation |
| `ChannelMapping` | Config | Maps internal room types to external codes |

### Sync Orchestrator (`ChannelSyncService`)

```python
service = ChannelSyncService(get_provider("ical"))

# Pull reservations from OTA
result = service.import_reservations(since=last_sync)

# Push inventory updates to OTA
result = service.push_inventory_updates(updates)
```

### iCal Integration

**Export** (push to OTAs):
- Route: `GET /calendar/feed/<token>.ics`
- OTAs fetch this URL to see our blocked dates
- Token rotation prevents feed hijacking

**Import** (pull from OTAs):
- `ExternalCalendarSource` stores OTA feed URLs
- `sync_external_calendar_source()` fetches and parses iCal data
- `ExternalCalendarBlock` records store OTA bookings
- Conflicts with existing PMS reservations are flagged for review

### Adding a New Provider

1. Create a subclass of `ChannelProvider`
2. Implement `pull_reservations()`, `push_inventory()`, `test_connection()`
3. Register in `PROVIDER_REGISTRY` dict
4. Map room types via `ChannelMapping` records

### Booking Source Channels

All reservations track their origin:

| Source | Description |
|--------|-------------|
| `direct_web` | Public booking engine |
| `walk_in` | Guest arrives without reservation |
| `phone` | Phone reservation |
| `line` | LINE messaging app |
| `whatsapp` | WhatsApp |
| `google_business` | Google Business Profile |
| `facebook` | Facebook/Meta |
| `qr` | QR code scan |
| `referral` | Referred guest |
| `admin_manual` | Staff-created booking |
| `ota_booking_com` | Booking.com (via channel sync) |
| `ota_agoda` | Agoda (via channel sync) |
| `ota_expedia` | Expedia (via channel sync) |

---

## Audit Trail

### Two-Tier Logging

| System | Table | Purpose |
|--------|-------|---------|
| Audit Log | `audit_logs` | Data change tracking (before/after snapshots) |
| Activity Log | `activity_logs` | User action tracking (events with metadata) |

### Logged Actions

- Reservation created / modified / cancelled / no-show
- Room assigned / moved
- Check-in / check-out
- Rate changed
- Channel sync import / push
- Payment received / refunded
- Manual override performed

### Audit Log Entry Format

```json
{
  "actor_user_id": "uuid",
  "entity_table": "reservations",
  "entity_id": "uuid",
  "action": "update",
  "before_data": { "status": "tentative" },
  "after_data": { "status": "confirmed" },
  "request_id": "req-xxx",
  "ip_address": "192.168.1.1"
}
```

---

## Front-Desk Planning Board

### Architecture

- **Backend**: `pms/services/front_desk_board_service.py` builds the board data
- **Frontend**: `static/front-desk-board.js` (41 KB) handles drag-and-drop
- **SSE**: `/staff/front-desk/board/events` streams real-time updates

### Board Operations

| Action | Endpoint |
|--------|----------|
| View board | `GET /staff/front-desk/board` |
| Move reservation | `POST /staff/front-desk/board/reservations/<id>/move` |
| Resize dates | `POST /staff/front-desk/board/reservations/<id>/resize` |
| Check in | `POST /staff/front-desk/board/reservations/<id>/check_in` |
| Check out | `POST /staff/front-desk/board/reservations/<id>/check_out` |
| Detail panel | `GET /staff/front-desk/board/reservations/<id>/panel` |

### Drag-and-Drop Validation

All board mutations validate:
- Room type compatibility
- Date overlap conflicts
- Out-of-order / blocked room restrictions
- External calendar blocks
- Blackout periods

---

## Environment Variables

See `.env.example` for the full list.  Key reservation-related settings:

| Variable | Purpose |
|----------|---------|
| `INVENTORY_BOOTSTRAP_DAYS` | Days of inventory to pre-create (default: 730) |
| `ICAL_SYNC_HTTP_TIMEOUT_SECONDS` | Timeout for OTA feed fetch (default: 15) |
| `PAYMENT_PROVIDER` | Payment provider (`stripe`, `disabled`) |

### AppSetting Keys (Database)

| Key | Purpose |
|-----|---------|
| `hotel.vat_rate` | VAT rate (default: 0.07) |
| `hotel.extra_guest_fee` | Extra guest per-night fee |
| `hotel.child_fee_6_11` | Child per-night fee |
| `reservation.deposit_percentage` | Deposit % of total |
| `payment.deposit_enabled` | Whether deposits are required |
| `calendar.export_enabled` | Enable iCal feed export |
| `calendar.import_enabled` | Enable iCal feed import |
| `hotel.timezone` | Property timezone |

---

## Testing the Reservation Control Layer Locally

```bash
cd sandbox_pms_mvp
pip install -r requirements-dev.txt

# Run all tests
python -m pytest tests/ -q

# Run availability and channel tests specifically
python -m pytest tests/test_availability_and_channel.py -v

# Run front-desk board tests (excluding SSE streaming)
python -m pytest tests/test_phase15_front_desk_board.py -k "not sse_endpoint_returns and not sse_emits_event" -v

# Run public booking tests
python -m pytest tests/test_phase4_public_booking.py -v

# Start development server
export FLASK_APP=app
export FLASK_DEBUG=1
flask run
```

---

## Known Limitations

1. **Channel sync is iCal-based only** — API-based OTA integrations
   (Booking.com, Agoda, Expedia) require provider-specific API
   credentials and are stubbed via the adapter pattern.

2. **No real-time push to OTAs** — iCal feeds are pull-based; the
   OTA fetches from us on its own schedule (typically every 15–60 min).

3. **External calendar blocks require manual review** — OTA bookings
   do not auto-create PMS reservations; staff must accept/reject.

4. **Rate engine is rule-based** — No dynamic pricing or revenue
   management. Rates follow priority-ordered `RateRule` records.
