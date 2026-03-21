# Dashboards and Daily Operational Reports

## Overview

The PMS provides two dashboard layers and a set of daily operational reports designed for front-desk and management staff:

| Surface | URL | Permission | Purpose |
|---|---|---|---|
| Front-desk dashboard | `/staff` | `reservation.view` | Shift planning, arrivals/departures, room readiness, urgent tasks, balances |
| Manager dashboard | `/staff/reports` | `reports.view` | Occupancy, revenue pacing, booking attribution, deposit pipeline, audit activity |
| Daily reports | `/staff/daily-reports/<type>` | Varies by type | Focused single-topic reports with filters and drill-through |

## Architecture

### Metric calculation

All dashboard and report metrics are computed in `pms/services/reporting_service.py`. Three builder functions aggregate the individual report functions:

- `build_front_desk_dashboard()` for the compact operational view
- `build_manager_dashboard()` for the broader manager reporting surface
- `build_daily_report()` for focused single-topic reports

Individual report functions are reused across these builders so the KPI definitions stay consistent.

### Metric definitions

| Metric | Definition |
|---|---|
| Arrivals today | Confirmed or tentative reservations with `check_in_date` equal to the business date |
| Departures today | Checked-in reservations with `check_out_date` equal to the business date |
| In-house guests | Reservations in `checked_in` status active on the business date |
| Occupancy today | Consuming inventory rooms divided by saleable inventory, excluding blocked and closed inventory |
| Occupancy range | Same occupancy formula applied per day across a selected range |
| Revenue management | Posted room revenue plus occupancy-derived ADR and RevPAR pacing inside the selected range; not a forecast engine |
| Rooms ready | Sellable rooms with housekeeping status `clean` or `inspected` |
| Rooms dirty | Rooms with housekeeping status `dirty` |
| Balance due | Folio balance greater than zero from authoritative `folio_summary()` output |
| Urgent tasks | Open, assigned, or in-progress housekeeping tasks with `urgent` or `high` priority |
| Deposit missing | Arrivals where deposit state is `missing` or `partial` |
| Cancellations | Reservation status history entries changed to `cancelled` inside the selected range |
| No-shows | Reservation status history entries changed to `no_show` inside the selected range |
| Booking source | UTM/source metadata captured during the public booking flow |

## Daily reports

| Report type | URL slug | Permission | Filters | Description |
|---|---|---|---|---|
| Arrivals | `arrivals` | `reservation.view` | Date | Full arrival list with room readiness and deposit status |
| Departures | `departures` | `reservation.view` | Date | Checkout readiness and outstanding balances |
| Room status | `room_status` | `housekeeping.view` | Date | Housekeeping status per room with priority context |
| Payment due | `payment_due` | `folio.view` | Date range | Outstanding folio balances requiring attention |
| Housekeeping performance | `housekeeping_performance` | `reports.view` | Date range | Task throughput, completion, and attendant output |
| Occupancy | `occupancy` | `reports.view` | Date range | Daily occupancy breakdown with averages, peaks, and year-over-year comparison |
| Revenue management | `revenue_management` | `folio.view` | Date range | Posted room-revenue pacing, ADR, RevPAR, room-type mix, and channel pacing |
| Channel performance | `channel_performance` | `reports.view` | Date range | Reservation counts, cancellations, sold nights, ADR, and room revenue by source |
| Booking source | `booking_source` | `reports.view` | Date range | Source/campaign attribution for public bookings |
| No-show & cancellation | `no_show_cancellation` | `reports.view` | Date range | Exception tracking with reason and source breakdown |

### Date filters

- Single-date reports (`arrivals`, `departures`, `room_status`) accept a `date` query parameter.
- Range-based reports accept `preset`, `date_from`, and `date_to`.
- Available presets: `today`, `tomorrow`, `next_7_days`, `next_30_days`, `current_month`, `custom`.

### Drill-through

- Dashboard cards and report rows link to the underlying reservation, room, or folio details where permissions allow.
- Back-links are preserved so staff can return to the originating dashboard or report.

### Export behavior

- Daily reports support CSV export through `/staff/daily-reports/<type>/csv`.
- HTML plus CSV is the current beta export standard.
- PDF / print-ready exports remain backlog work.

## Role-based visibility

| Role | Front-desk dashboard | Manager dashboard | Reports available |
|---|---|---|---|
| Front desk | Full access | No | Arrivals, departures |
| Housekeeping | No | No | Room status |
| Manager | Full access plus financial sections | Full access | All current report types |
| Admin | Full access plus financial sections | Full access | All current report types |

The front-desk dashboard conditionally includes:

- room status / urgent tasks only for users with `housekeeping.view`
- outstanding balances only for users with `folio.view`
- manager reports link only for users with `reports.view`

## How to test locally

```bash
cd sandbox_pms_mvp
python -m pytest tests/test_phase19_dashboards.py -q --tb=short
python -m pytest tests/test_phase12_reporting.py -q --tb=short
```

To test in a browser:

1. Start the app with the expected environment variables.
2. Log in as a staff user with the relevant permissions.
3. Visit `/staff` for the front-desk dashboard.
4. Visit `/staff/reports` for the manager dashboard.
5. Open the daily reports directly from the report shortcuts or via `/staff/daily-reports/<type>`.

## Known limitations

- Daily reports support CSV export, but PDF / print-ready exports are still backlog.
- Occupancy calculations depend on the inventory ledger being bootstrapped for the relevant date range.
- Urgent tasks only cover housekeeping tasks; there is no broader issue/task model yet.
- Pickup trends and forecasting automation are not implemented in the current revenue pacing view.

## Follow-up recommendations

1. Email scheduled daily summaries to managers once deployment verification is complete.
2. Add pickup and booking-velocity tracking for future-date pacing.
3. Layer forecast and yield automation on top of the current revenue pacing dashboard.
4. Allow staff to pin or reorder dashboard cards by role.
5. Keep board/report polling latency under review during live staff usage and only add a lighter-weight delta transport if needed.
