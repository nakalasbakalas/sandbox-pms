# Real-Time Housekeeping & Room-Readiness Sync

## Architecture Overview

This module adds a production-quality housekeeping task management and room-readiness sync layer to the Sandbox Hotel PMS. It integrates with the existing reservation, room, inventory, front-desk, and audit systems.

### Core Components

| Component | Location | Purpose |
|-----------|----------|---------|
| `HousekeepingTask` model | `pms/models.py` | Task-based housekeeping workflow |
| `room_readiness_service.py` | `pms/services/` | Single source of truth for room assignability |
| `housekeeping_service.py` (enhanced) | `pms/services/` | Task lifecycle management, status updates |
| `front_desk_service.py` (enhanced) | `pms/services/` | Auto-turnover task creation on checkout |
| `front_desk_board_service.py` (enhanced) | `pms/services/` | Room readiness data in board lanes |
| Migration `20260314_02` | `migrations/versions/` | Database schema for housekeeping_tasks |

---

## Room-State Model

### Housekeeping Statuses

| Code | Name | Sellable? | Description |
|------|------|-----------|-------------|
| `clean` | Clean | ✅ | Vacant, clean, ready for sale |
| `dirty` | Dirty | ❌ | Needs cleaning |
| `inspected` | Inspected | ✅ | Supervisor approved, ready |
| `pickup` | Pickup | ❌ | Quick touch-up needed |
| `occupied_clean` | Occupied Clean | ❌ | In-house guest, clean |
| `occupied_dirty` | Occupied Dirty | ❌ | In-house guest, dirty |
| `do_not_disturb` | Do Not Disturb | ❌ | Guest requested no service |
| `sleep` | Sleep | ❌ | Sleeping guest |
| `out_of_service` | Out of Service | ❌ | Temporarily not sellable |
| `out_of_order` | Out of Order | ❌ | Major maintenance outage |
| `cleaning_in_progress` | Cleaning In Progress | ❌ | **New** — Housekeeper actively cleaning |

### Readiness Determination Rules

A room is **ready for assignment** when ALL of the following are true:

1. An `InventoryDay` row exists for the room and date
2. Room is NOT blocked (`is_blocked = false`)
3. Room availability status is NOT `out_of_service` or `out_of_order`
4. Room has NO maintenance flag
5. Room is NOT currently occupied (no active `reservation_id`)
6. Housekeeping status is `clean` or `inspected`

The `room_readiness_service.is_room_assignable()` function is the single source of truth.

---

## Housekeeping Task Lifecycle

### Task Types

| Type | Description |
|------|-------------|
| `checkout_clean` | Post-departure cleaning (auto-created on checkout) |
| `daily_service` | Regular occupied room service |
| `rush_clean` | Urgent cleaning for early arrivals / VIP |
| `deep_clean` | Deep cleaning |
| `inspection` | Supervisor inspection task |
| `turndown` | Evening turndown service |

### Task Priorities

| Priority | Description |
|----------|-------------|
| `urgent` | Rush rooms, early arrivals, VIP |
| `high` | Arrival demand exists for room type |
| `normal` | Standard cleaning |
| `low` | No urgency |

### Task Status Flow

```
open → assigned → in_progress → completed → inspected
                                     ↘ cancelled (from any active state)
```

### Status Transitions and Room Effects

| Task Action | Room Effect |
|-------------|-------------|
| `start_task` | Room → `cleaning_in_progress`, `is_sellable = false` |
| `complete_task` | Room → `clean`, `cleaned_at` set, sellability recalculated |
| `inspect_task` | Room → `inspected`, `inspected_at` set, sellability recalculated |

---

## Departure Turnover Workflow

### Automatic Flow

1. **Guest checks out** via `complete_checkout()`
2. Room inventory status → `available`, housekeeping status → `dirty`
3. `create_departure_turnover_task()` automatically creates a `checkout_clean` task
4. If an incoming arrival is assigned to the same room, priority is auto-set to `urgent`
5. Housekeeper starts the task → room → `cleaning_in_progress`
6. Housekeeper completes the task → room → `clean`
7. Supervisor inspects → room → `inspected` (ready for next guest)

### Duplicate Prevention

If an active `checkout_clean` task already exists for the room and date, a new one is not created.

---

## Block / Out-of-Order Handling

- **Blocked rooms** (`is_blocked = true`) are excluded from assignment logic
- **Out-of-service / out-of-order** rooms are excluded from assignment
- **Maintenance-flagged** rooms are excluded from assignment
- All block/unblock operations are logged in `RoomStatusHistory` and `AuditLog`
- Block reasons are visible in the housekeeping board and front desk

---

## UI Usage Notes

### Housekeeping Board (`/staff/housekeeping`)

- Displays all rooms with their current housekeeping status
- Shows active tasks, priority, and cleaning progress
- Supports filters: floor, status, priority, room type, arrival/departure today
- Quick actions: mark dirty, mark clean, mark inspected, block/unblock, rush clean

### Front Desk Board (`/staff/front-desk/board`)

- Each room lane now includes:
  - `housekeepingStatus` — current housekeeping status code
  - `isRoomReady` — boolean readiness indicator
  - `isBlocked` — block status
  - `isMaintenance` — maintenance flag

### Front Desk Workspace (`/staff/front-desk`)

- Arrivals and departures show room readiness status (already existed)
- `room_ready` boolean and `room_readiness_label` in each item

### Room Readiness API

```
GET /staff/api/room-readiness?date=YYYY-MM-DD
→ JSON list of all rooms with readiness state

GET /staff/api/room-readiness/<room_id>?date=YYYY-MM-DD
→ JSON single room readiness
```

### Housekeeping Tasks API

```
GET  /staff/housekeeping/tasks?date=YYYY-MM-DD
POST /staff/housekeeping/tasks                      (create)
POST /staff/housekeeping/tasks/<id>/assign           (assign to housekeeper)
POST /staff/housekeeping/tasks/<id>/start            (start cleaning)
POST /staff/housekeeping/tasks/<id>/complete          (mark completed)
POST /staff/housekeeping/tasks/<id>/inspect           (pass inspection)
POST /staff/housekeeping/tasks/<id>/cancel            (cancel task)
```

### Quick Actions

```
POST /staff/housekeeping/quick-action
  action: mark_dirty | mark_cleaning | mark_clean | mark_inspected |
          block_room | unblock_room | maintenance_on | maintenance_off | rush_clean
  room_id: UUID
  business_date: YYYY-MM-DD
```

---

## Real-Time / Refresh Strategy

The system uses **Server-Sent Events (SSE)** via `/staff/front-desk/board/events`:

- All `housekeeping.*` activity events are now included in the SSE stream
- When a housekeeper updates a room status or completes a task, an `ActivityLog` event is written
- The SSE endpoint picks up `housekeeping.*` events alongside `front_desk.*` and `reservation.*` events
- Connected front-desk clients receive the event within ~1 second
- The SSE connection auto-reconnects after 5-minute timeout

For polling-based setups, the `/staff/api/room-readiness` endpoint can be polled every 10–30 seconds.

---

## Environment / Config

### Settings (via admin panel)

| Setting | Default | Description |
|---------|---------|-------------|
| `housekeeping.require_inspected_for_ready` | `false` | If true, only `inspected` rooms are ready |
| `housekeeping.checkout_dirty_status` | `dirty` | Status applied after checkout handoff |

No new environment variables are required.

---

## Database Migration

**Migration:** `20260314_02_housekeeping_tasks.py`

Creates the `housekeeping_tasks` table with indexes on:
- `(room_id, business_date)`
- `(status, business_date)`
- `(assigned_to_user_id, status)`

Also seeds the `cleaning_in_progress` housekeeping status.

---

## Testing

Run all readiness and task tests:

```bash
python -m pytest sandbox_pms_mvp/tests/test_housekeeping_readiness.py -q
```

Run existing housekeeping tests:

```bash
python -m pytest sandbox_pms_mvp/tests/test_phase7_housekeeping.py -q -k "not sse"
```

### Test Coverage

| Test | What It Covers |
|------|----------------|
| `test_room_readiness_clean_room_is_assignable` | Clean room → ready |
| `test_room_readiness_dirty_room_not_assignable` | Dirty room → not ready |
| `test_room_readiness_blocked_room_not_assignable` | Blocked → excluded |
| `test_room_readiness_maintenance_room_not_assignable` | Maintenance → excluded |
| `test_room_readiness_board_returns_all_active_rooms` | Board returns all active rooms |
| `test_get_assignable_rooms_filters_ready_only` | Only ready rooms returned |
| `test_create_housekeeping_task` | Task creation with audit |
| `test_assign_housekeeping_task` | Task assignment flow |
| `test_start_housekeeping_task_sets_cleaning_in_progress` | Start → CIP status |
| `test_complete_housekeeping_task_sets_room_clean` | Complete → clean |
| `test_inspect_housekeeping_task_sets_room_inspected` | Inspect → ready |
| `test_cancel_housekeeping_task` | Cancellation |
| `test_cannot_start_completed_task` | Error guard |
| `test_cannot_inspect_non_completed_task` | Error guard |
| `test_list_housekeeping_tasks_filters` | Listing and filtering |
| `test_departure_turnover_task_created_on_checkout` | Auto-task on checkout |
| `test_departure_turnover_auto_task_not_duplicated` | Dedup logic |
| `test_full_turnover_flow_dirty_to_ready` | Full dirty→CIP→clean→inspected flow |
| `test_cleaning_in_progress_status_in_board` | CIP visible in board |
| `test_task_lifecycle_produces_audit_trail` | Audit logging |
| `test_room_status_change_produces_history_entry` | Status history |
| `test_quick_action_mark_dirty_route` | Quick action route |
| `test_quick_action_rush_clean_creates_task` | Rush clean route |
| `test_room_readiness_api_endpoint` | API endpoint |
| `test_room_readiness_single_api_endpoint` | Single room API |
| `test_housekeeping_tasks_api_endpoint` | Tasks API |

---

## Known Limitations

1. **No push notifications to mobile** — Housekeepers need to poll/refresh the board to see new tasks
2. **No estimated completion time** — Tasks don't predict when cleaning will finish
3. **No workforce scheduling** — Task assignment is manual, no auto-balancing across housekeepers
4. **No IoT integration** — No door lock, minibar, or sensor integration
5. **No photo upload** — Cannot attach condition photos to tasks (could be added as RoomNote attachments)

---

## Follow-Up Recommendations

1. **Add task-level push notifications** — Notify housekeepers when urgent tasks are created
2. **Add task duration tracking** — Calculate average cleaning times for capacity planning
3. **Add mobile-optimized task view** — Dedicated mobile interface for housekeepers
4. **Add task auto-assignment** — Round-robin or zone-based automatic assignment
5. **Add supervisor dashboard** — Overview of pending/completed tasks with SLA tracking
6. **Add night audit integration** — Auto-create daily service tasks during night audit
