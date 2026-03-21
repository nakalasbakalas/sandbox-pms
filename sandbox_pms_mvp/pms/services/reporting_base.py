"""Shared reporting imports, constants, and helpers."""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import sqlalchemy as sa
from sqlalchemy.orm import aliased, joinedload

from ..extensions import db
from ..models import (
    AuditLog,
    CashierActivityLog,
    FolioCharge,
    HousekeepingTask,
    InventoryDay,
    PaymentRequest,
    Reservation,
    ReservationStatusHistory,
    Room,
    RoomType,
    User,
    utc_now,
)
from ..pricing import money
from .cashier_service import folio_summary
from .front_desk_service import FrontDeskFilters, list_front_desk_arrivals, list_front_desk_departures, list_front_desk_in_house
from .housekeeping_service import HousekeepingBoardFilters, list_housekeeping_board
from .staff_reservations_service import build_reservation_summary, reservation_attribution_summary


CONSUMING_INVENTORY_STATUSES = {"reserved", "occupied", "house_use"}
CLOSED_INVENTORY_STATUSES = {"out_of_service", "out_of_order"}
ACTIVE_REPORTABLE_RESERVATION_STATUSES = {"tentative", "confirmed", "checked_in", "checked_out"}
SOLD_RESERVATION_STATUSES = {"confirmed", "checked_in", "checked_out"}
ACTIVE_HOUSEKEEPING_TASK_STATUSES = {"open", "assigned", "in_progress"}
COMPLETED_HOUSEKEEPING_TASK_STATUSES = {"completed", "inspected"}
HOUSEKEEPING_REPORT_TASK_TYPES = (
    "checkout_clean",
    "daily_service",
    "rush_clean",
    "deep_clean",
    "inspection",
    "turndown",
)
ADMIN_AUDIT_ENTITIES = {
    "app_settings",
    "blackout_periods",
    "inventory_overrides",
    "notification_templates",
    "payment_requests",
    "policy_documents",
    "rate_rules",
    "roles",
    "room_types",
    "rooms",
    "users",
}
RESERVATION_AUDIT_ENTITIES = {"reservations", "reservation_status_history", "reservation_review_queue", "guests"}
CASHIER_AUDIT_ENTITIES = {"folio_charges", "cashier_documents", "payment_requests", "payment_events"}


def report_metric_definitions() -> dict[str, str]:
    return {
        "occupancy_today": (
            "Confirmed or in-house occupied room-nights for the business date divided by total saleable room inventory for that date. "
            "The denominator excludes default non-sellable rooms, blocked rooms, out-of-order rooms, and out-of-service rooms."
        ),
        "occupancy_range": (
            "Daily occupancy uses the same definition as Occupancy Today for every date in the selected range."
        ),
        "occupancy_year_over_year": (
            "Compares the selected occupancy window with the same calendar dates one year earlier, using authoritative "
            "inventory-day occupancy where historical inventory exists."
        ),
        "pending_reservations": (
            "Reservations currently in tentative status with arrival dates inside the selected reporting range."
        ),
        "confirmed_reservations": (
            "Reservations currently in confirmed status with arrival dates inside the selected reporting range."
        ),
        "checked_in_guests": (
            "Reservations currently in checked_in status whose stay is active on the selected business date."
        ),
        "folio_balances_outstanding": (
            "Reservations overlapping the selected reporting range whose authoritative folio balance due is greater than zero."
        ),
        "deposit_requested_vs_paid": (
            "Reservations arriving in the selected reporting range with a deposit requirement, using the latest deposit request "
            "status and authoritative deposit received totals from folio/payment posting."
        ),
        "revenue_summary": (
            "Posted folio activity by service date in the selected reporting range. This is posted room and operational charge "
            "revenue, not booked revenue or cash collected."
        ),
        "revenue_management": (
            "Revenue management combines authoritative occupancy inventory with posted room revenue to summarize ADR, RevPAR, "
            "and day-level pacing for the selected reporting range. Forecasts are not modeled yet."
        ),
        "room_type_performance": (
            "Reservation count is based on confirmed or stayed reservations overlapping the selected reporting range. "
            "Sold nights come from consuming inventory ledger rows for confirmed or in-house stays, and room revenue "
            "comes from posted room charges in the same range."
        ),
        "housekeeping_performance": (
            "Housekeeping performance groups tasks by assigned attendant and task business date, with raw start and "
            "completion timestamps preserved because the schema does not yet store explicit roster shift codes."
        ),
        "cancellations": (
            "Cancellation count is based on reservation status history entries changed to cancelled inside the selected reporting range."
        ),
        "no_shows": (
            "No-show count is based on reservation status history entries changed to no_show inside the selected reporting range."
        ),
        "audit_activity": (
            "Audit activity summarizes authoritative audit log entries inside the selected reporting range, grouped for operational review."
        ),
        "booking_attribution": (
            "Booking attribution summarizes first-touch source metadata captured during the public booking flow. "
            "Counts use reservations booked inside the selected reporting range."
        ),
        "channel_performance": (
            "Channel performance groups reservations by source channel using arrivals inside the selected reporting range. "
            "Cancellation rate uses the same arrival cohort, while ADR uses posted room revenue divided by sold nights "
            "inside the range."
        ),
    }



def _folio_lines_in_range(date_from: date, date_to: date) -> list[FolioCharge]:
    return (
        db.session.execute(
            sa.select(FolioCharge)
            .where(
                FolioCharge.voided_at.is_(None),
                FolioCharge.service_date >= date_from,
                FolioCharge.service_date <= date_to,
                FolioCharge.charge_type.in_(["room", "manual_charge", "manual_discount", "fee", "refund", "correction"]),
            )
            .order_by(FolioCharge.service_date.asc(), FolioCharge.posted_at.asc())
        )
        .scalars()
        .all()
    )


def _occupancy_rows(date_from: date, date_to: date) -> list[dict]:
    sold_reservation = aliased(Reservation)
    raw_rows = {
        business_date: {
            "saleable_rooms": int(saleable_rooms or 0),
            "occupied_rooms": int(occupied_rooms or 0),
        }
        for business_date, saleable_rooms, occupied_rooms in db.session.execute(
            sa.select(
                InventoryDay.business_date,
                sa.func.count(InventoryDay.id),
                sa.func.sum(
                    sa.case(
                        (
                            sa.and_(
                                InventoryDay.availability_status.in_(tuple(CONSUMING_INVENTORY_STATUSES)),
                                sa.or_(
                                    InventoryDay.availability_status == "house_use",
                                    sold_reservation.current_status.in_(tuple(SOLD_RESERVATION_STATUSES)),
                                ),
                            ),
                            1,
                        ),
                        else_=0,
                    )
                ),
            )
            .join(Room, Room.id == InventoryDay.room_id)
            .outerjoin(sold_reservation, sold_reservation.id == InventoryDay.reservation_id)
            .where(
                InventoryDay.business_date >= date_from,
                InventoryDay.business_date <= date_to,
                Room.is_active.is_(True),
                Room.is_sellable.is_(True),
                InventoryDay.is_blocked.is_(False),
                InventoryDay.availability_status.notin_(tuple(CLOSED_INVENTORY_STATUSES)),
            )
            .group_by(InventoryDay.business_date)
            .order_by(InventoryDay.business_date.asc())
        ).all()
    }
    rows = []
    current = date_from
    while current <= date_to:
        metrics = raw_rows.get(current, {"saleable_rooms": 0, "occupied_rooms": 0})
        saleable_rooms = metrics["saleable_rooms"]
        occupied_rooms = metrics["occupied_rooms"]
        occupancy_percentage = Decimal("0.00")
        if saleable_rooms:
            occupancy_percentage = (
                (Decimal(occupied_rooms) / Decimal(saleable_rooms)) * Decimal("100.00")
            ).quantize(Decimal("0.01"))
        rows.append(
            {
                "date": current,
                "saleable_rooms": saleable_rooms,
                "occupied_rooms": occupied_rooms,
                "occupancy_percentage": occupancy_percentage,
            }
        )
        current += timedelta(days=1)
    return rows


def _reservation_listing_query():
    return sa.select(Reservation).options(
        joinedload(Reservation.primary_guest),
        joinedload(Reservation.room_type),
        joinedload(Reservation.assigned_room),
    )


def _reservation_overlaps_range(date_from: date, date_to: date):
    return sa.and_(
        Reservation.check_in_date < date_to + timedelta(days=1),
        Reservation.check_out_date > date_from,
    )


def _status_history_summary_report(status_code: str, date_from: date, date_to: date, *, limit: int) -> dict:
    start_dt = datetime.combine(date_from, datetime.min.time(), tzinfo=timezone.utc)
    end_dt = datetime.combine(date_to + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc)
    query = (
        sa.select(ReservationStatusHistory).options(
            joinedload(ReservationStatusHistory.reservation).joinedload(Reservation.primary_guest),
            joinedload(ReservationStatusHistory.reservation).joinedload(Reservation.room_type),
        )
        .where(
            ReservationStatusHistory.new_status == status_code,
            ReservationStatusHistory.changed_at >= start_dt,
            ReservationStatusHistory.changed_at < end_dt,
        )
    )
    histories = (
        db.session.execute(query.order_by(ReservationStatusHistory.changed_at.desc()))
        .unique()
        .scalars()
        .all()
    )
    total = len(histories)
    rows = []
    source_counts: dict[str, int] = {}
    room_type_counts: dict[str, int] = {}
    for item in histories:
        reservation = item.reservation
        source_counts[reservation.source_channel] = source_counts.get(reservation.source_channel, 0) + 1
        room_type_code = reservation.room_type.code if reservation.room_type else ""
        room_type_counts[room_type_code] = room_type_counts.get(room_type_code, 0) + 1
        if len(rows) >= limit:
            continue
        rows.append(
            {
                "reservation_id": reservation.id,
                "reservation_code": reservation.reservation_code,
                "guest_name": reservation.primary_guest.full_name if reservation.primary_guest else "Unknown guest",
                "arrival_date": reservation.check_in_date,
                "departure_date": reservation.check_out_date,
                "source_channel": reservation.source_channel,
                "room_type_code": room_type_code,
                "changed_at": item.changed_at,
                "reason": item.reason,
                "note": item.note,
                "deposit_received_amount": money(reservation.deposit_received_amount),
            }
        )
    return {
        "count": total,
        "source_counts": source_counts,
        "room_type_counts": room_type_counts,
        "items": rows,
    }


def _as_aware(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _shift_year_safe(day: date, *, years: int) -> date:
    try:
        return day.replace(year=day.year + years)
    except ValueError:
        # Feb 29 falls back to Feb 28 in non-leap years.
        return day.replace(month=2, day=28, year=day.year + years)


# ---------------------------------------------------------------------------
# CSV export helpers
# ---------------------------------------------------------------------------

