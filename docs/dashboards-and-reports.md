# Dashboards and Daily Operational Reports

## Overview

The PMS provides two dashboard layers and a set of daily operational reports designed for front-desk and management staff:

| Surface | URL | Permission | Purpose |
|---|---|---|---|
| Front-desk dashboard | `/staff` | `reservation.view` | Shift planning, arrivals/departures, room readiness, urgent tasks, balances |
| Manager dashboard | `/staff/reports` | `reports.view` | Occupancy, revenue, booking attribution, deposit pipeline, audit activity |
| Daily reports | `/staff/daily-reports/<type>` | Varies by type | Focused single-topic reports with filters and drill-through |

## Architecture

### Metric calculation

All dashboard and report metrics are computed in `pms/services/reporting_service.py`. Two builder functions aggregate the individual report functions:

- **`build_front_desk_dashboard()`** — compact operational view for front-desk agents.
- **`build_manager_dashboard()`** — comprehensive view for managers, including financials and audit.
- **`build_daily_report()`** — dispatches to the appropriate report function based on report type.

Individual report functions (e.g., `arrivals_today_report()`, `occupancy_today_report()`) are reused across all three builders, ensuring consistent metric definitions.

### Metric definitions

| Metric | Definition |
|---|---|
| Arrivals today | Confirmed or tentative reservations with `check_in_date` = business date |
| Departures today | Checked-in reservations with `check_out_date` = business date |
| In-house guests | Reservations in `checked_in` status active on the business date |
| Occupancy today | Consuming inventory rooms ÷ saleable inventory (excluding blocked, out-of-order, out-of-service) |
| Occupancy range | Same formula applied per day across a date range |
| Rooms ready | Sellable rooms with housekeeping status `clean` or `inspected` |
| Rooms dirty | Rooms with housekeeping status `dirty` |
| Rooms blocked | Rooms with `is_blocked` flag set |
| Out of order | Rooms with housekeeping status `out_of_order` |
| Unassigned arrivals | Arrivals with no `assigned_room_id` |
| Balance due | Folio balance > 0 from authoritative `folio_summary()` |
| Urgent tasks | Open/assigned/in-progress housekeeping tasks with `urgent` or `high` priority |
| Deposit missing | Arrivals where deposit state is `missing` or `partial` |
| Cancellations | Reservation status history entries changed to `cancelled` in range |
| No-shows | Reservation status history entries changed to `no_show` in range |
| Booking source | UTM/source metadata from public booking flow |

## Daily reports

| Report type | URL slug | Permission | Filters | Description |
|---|---|---|---|---|
| Arrivals | `arrivals` | `reservation.view` | Date | Full arrival list with room readiness and deposit status |
| Departures | `departures` | `reservation.view` | Date | Checkout readiness and outstanding balances |
| Room status | `room_status` | `housekeeping.view` | Date | Housekeeping status per room with priority context |
| Payment due | `payment_due` | `folio.view` | Date range | Outstanding folio balances requiring attention |
| Occupancy | `occupancy` | `reports.view` | Date range | Daily occupancy breakdown with averages and peaks |
| Booking source | `booking_source` | `reports.view` | Date range | Source/campaign attribution for public bookings |
| No-show & cancellation | `no_show_cancellation` | `reports.view` | Date range | Exception tracking with reason and source breakdown |

### Date filters

- Single-date reports (arrivals, departures, room status) accept a `date` query parameter.
- Range-based reports accept `preset`, `date_from`, and `date_to` query parameters.
- Available presets: `today`, `tomorrow`, `next_7_days`, `next_30_days`, `current_month`, `custom`.

### Drill-through

- Dashboard metric cards and report table rows link to the underlying reservation, room, or folio detail pages.
- Back-links are preserved so users can navigate to a record and return to the originating dashboard or report.

## Role-based visibility

| Role | Front-desk dashboard | Manager dashboard | Reports available |
|---|---|---|---|
| Front desk | Full access | ❌ (requires `reports.view`) | Arrivals, departures |
| Housekeeping | ❌ | ❌ | Room status |
| Manager | Full access + financial sections | Full access | All report types |
| Admin | Full access + financial sections | Full access | All report types |

The front-desk dashboard conditionally includes:
- **Room status / urgent tasks** — visible only if user has `housekeeping.view`
- **Outstanding balances** — visible only if user has `folio.view`
- **Manager reports link** — visible only if user has `reports.view`

## How to test locally

```bash
cd sandbox_pms_mvp
python -m pytest tests/test_phase19_dashboards.py -q --tb=short
python -m pytest tests/test_phase12_reporting.py -q --tb=short
```

To test in a browser:
1. Start the app: `flask run` (with appropriate env vars)
2. Log in as a staff user
3. Navigate to `/staff` for the front-desk dashboard
4. Navigate to `/staff/reports` for the manager dashboard
5. Use the "Report shortcuts" section or navigate directly to `/staff/daily-reports/<type>`

## Known limitations

- Daily reports do not currently support CSV/PDF export. Export can be added by wiring report data through a serialization endpoint.
- Occupancy calculations use the inventory ledger, which must be bootstrapped for the relevant date range.
- Urgent tasks only cover housekeeping tasks; there is no general-purpose issue/task model beyond housekeeping.
- Pickup trends (day-over-day booking velocity) are not implemented in this version.

## Follow-up recommendations

1. **Export**: Add CSV export endpoints for each daily report type.
2. **Scheduled reports**: Email daily summary reports to managers on a schedule.
3. **Pickup trends**: Track booking velocity (reservations booked per day for future dates).
4. **Forecasting**: Use occupancy range data to project revenue and staffing needs.
5. **Dashboard customization**: Allow staff to pin/reorder dashboard cards based on role.
6. **Real-time updates**: Use SSE or polling to refresh dashboard metrics during shifts.
