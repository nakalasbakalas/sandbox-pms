from __future__ import annotations

from .front_desk_base import *  # noqa: F401,F403
from . import front_desk_base as _base

_apply_front_desk_filters = _base._apply_front_desk_filters
_combine_local = _base._combine_local
_current_time = _base._current_time
_front_desk_query = _base._front_desk_query
_housekeeping_code = _base._housekeeping_code
_lock_inventory_rows = _base._lock_inventory_rows
_ready_housekeeping_codes = _base._ready_housekeeping_codes
_setting_time = _base._setting_time


def list_front_desk_workspace(filters: FrontDeskFilters) -> dict:
    if filters.mode == "departures":
        items = list_front_desk_departures(filters.business_date, filters=filters)
    elif filters.mode == "in_house":
        items = list_front_desk_in_house(filters.business_date, filters=filters)
    else:
        items = list_front_desk_arrivals(filters.business_date, filters=filters)
    return {
        "mode": filters.mode,
        "business_date": filters.business_date,
        "items": items,
        "counts": {
            "arrivals": len(
                list_front_desk_arrivals(
                    filters.business_date,
                    filters=FrontDeskFilters(business_date=filters.business_date, mode="arrivals"),
                )
            ),
            "departures": len(
                list_front_desk_departures(
                    filters.business_date,
                    filters=FrontDeskFilters(business_date=filters.business_date, mode="departures"),
                )
            ),
            "in_house": len(
                list_front_desk_in_house(
                    filters.business_date,
                    filters=FrontDeskFilters(business_date=filters.business_date, mode="in_house"),
                )
            ),
        },
    }


def list_front_desk_arrivals(business_date: date, *, filters: FrontDeskFilters) -> list[dict]:
    query = _front_desk_query().where(
        Reservation.check_in_date == business_date,
        Reservation.current_status.in_(["tentative", "confirmed"]),
    )
    query = _apply_front_desk_filters(query, filters)
    reservations = (
        db.session.execute(query.order_by(Reservation.booked_at.asc()))
        .unique()
        .scalars()
        .all()
    )
    return [_front_desk_summary(reservation, business_date) for reservation in reservations]


def list_front_desk_departures(business_date: date, *, filters: FrontDeskFilters) -> list[dict]:
    query = _front_desk_query().where(
        Reservation.check_out_date == business_date,
        Reservation.current_status.in_(["checked_in", "checked_out"]),
    )
    query = _apply_front_desk_filters(query, filters)
    reservations = (
        db.session.execute(query.order_by(Reservation.assigned_room_id.asc(), Reservation.booked_at.asc()))
        .unique()
        .scalars()
        .all()
    )
    return [_front_desk_summary(reservation, business_date) for reservation in reservations]


def list_front_desk_in_house(business_date: date, *, filters: FrontDeskFilters) -> list[dict]:
    query = _front_desk_query().where(
        Reservation.current_status == "checked_in",
        Reservation.check_in_date <= business_date,
        Reservation.check_out_date > business_date,
    )
    query = _apply_front_desk_filters(query, filters)
    reservations = (
        db.session.execute(query.order_by(Reservation.check_out_date.asc(), Reservation.assigned_room_id.asc()))
        .unique()
        .scalars()
        .all()
    )
    return [_front_desk_summary(reservation, business_date) for reservation in reservations]


def get_front_desk_detail(reservation_id: uuid.UUID, *, business_date: date | None = None) -> dict:
    detail = get_reservation_detail(reservation_id)
    reservation = detail["reservation"]
    business_date = business_date or date.today()
    front_desk = _front_desk_summary(reservation, business_date)
    front_desk["early_fee"] = evaluate_early_check_in(reservation, _combine_local(business_date, _current_time()))
    front_desk["late_fee"] = evaluate_late_check_out(reservation, _combine_local(business_date, _current_time()))
    front_desk["folio_charges"] = (
        db.session.execute(
            sa.select(FolioCharge)
            .where(FolioCharge.reservation_id == reservation.id)
            .order_by(FolioCharge.posted_at.desc())
            .limit(20)
        )
        .scalars()
        .all()
    )
    front_desk["payment_events"] = (
        db.session.execute(
            sa.select(PaymentEvent)
            .where(PaymentEvent.reservation_id == reservation.id)
            .order_by(PaymentEvent.created_at.desc())
            .limit(20)
        )
        .scalars()
        .all()
    )
    detail["front_desk"] = front_desk
    return detail


def evaluate_early_check_in(reservation: Reservation, action_at: datetime) -> dict:
    check_in_dt = _combine_local(reservation.check_in_date, _setting_time("hotel.check_in_time", "14:00"))
    amount = Decimal(str(get_setting_value("reservation.early_check_in_fee", "100.00")))
    applies = amount > Decimal("0.00") and action_at < check_in_dt
    return {"applies": applies, "amount": amount, "cutoff": check_in_dt}


def evaluate_late_check_out(reservation: Reservation, action_at: datetime) -> dict:
    check_out_dt = _combine_local(reservation.check_out_date, _setting_time("hotel.check_out_time", "11:00"))
    amount = Decimal(str(get_setting_value("reservation.late_check_out_fee", "100.00")))
    applies = amount > Decimal("0.00") and action_at > check_out_dt
    return {"applies": applies, "amount": amount, "cutoff": check_out_dt}


def room_readiness_snapshot(reservation: Reservation, business_date: date) -> dict:
    if not reservation.assigned_room_id:
        return {
            "is_ready": False,
            "label": "unassigned",
            "reason": "No room is assigned yet.",
            "housekeeping_status_code": None,
        }
    row = (
        db.session.execute(
            sa.select(InventoryDay).where(
                InventoryDay.room_id == reservation.assigned_room_id,
                InventoryDay.business_date == business_date,
            )
        )
        .scalars()
        .first()
    )
    if not row:
        return {
            "is_ready": False,
            "label": "missing_inventory",
            "reason": "Inventory is missing for this room and date.",
            "housekeeping_status_code": None,
        }
    housekeeping_code = _housekeeping_code(row.housekeeping_status_id)
    if room_has_external_block(reservation.assigned_room_id, business_date, reservation.check_out_date):
        return {
            "is_ready": False,
            "label": "calendar_conflict",
            "reason": "Room is blocked by an external calendar sync.",
            "housekeeping_status_code": housekeeping_code,
        }
    if getattr(row, "is_blocked", False):
        return {
            "is_ready": False,
            "label": "blocked",
            "reason": row.blocked_reason or "Room is blocked from sale.",
            "housekeeping_status_code": housekeeping_code,
        }
    if row.availability_status in {"out_of_service", "out_of_order"}:
        return {
            "is_ready": False,
            "label": row.availability_status,
            "reason": "Room is not sellable for arrival.",
            "housekeeping_status_code": housekeeping_code,
        }
    if row.reservation_id not in {None, reservation.id} and row.availability_status in {"reserved", "occupied", "house_use"}:
        return {
            "is_ready": False,
            "label": "conflict",
            "reason": "Room has a conflicting reservation.",
            "housekeeping_status_code": housekeeping_code,
        }
    if row.reservation_id is None and not row.is_sellable:
        return {
            "is_ready": False,
            "label": "not_sellable",
            "reason": "Room is not sellable for arrival.",
            "housekeeping_status_code": housekeeping_code,
        }
    if housekeeping_code not in _ready_housekeeping_codes():
        return {
            "is_ready": False,
            "label": "not_ready",
            "reason": f"Room is {housekeeping_code or 'not ready'} for arrival.",
            "housekeeping_status_code": housekeeping_code,
        }
    return {
        "is_ready": True,
        "label": "ready",
        "reason": "Room is ready for arrival.",
        "housekeeping_status_code": housekeeping_code,
    }


def _front_desk_summary(reservation: Reservation, business_date: date) -> dict:
    summary = build_reservation_summary(reservation)
    readiness = room_readiness_snapshot(reservation, business_date)
    payment = payment_summary(reservation)
    early_requested = bool(reservation.special_requests and "early" in reservation.special_requests.lower())
    pc_list = reservation.pre_checkin
    pre_checkin = pc_list[0] if pc_list else None
    flagged_issue = any(
        [
            not readiness["is_ready"],
            summary["assigned_room_number"] is None,
            payment["deposit_state"] in {"missing", "partial"},
            summary["duplicate_suspected"],
            summary["special_requests_present"],
        ]
    )
    summary.update(
        {
            "room_ready": readiness["is_ready"],
            "room_readiness_label": readiness["label"],
            "room_readiness_reason": readiness["reason"],
            "housekeeping_status_code": readiness["housekeeping_status_code"],
            "payment_summary": payment,
            "refund_due": payment["refund_due"],
            "early_check_in_requested": early_requested,
            "flagged_issue": flagged_issue,
            "turnover_status": "awaiting_housekeeping" if reservation.current_status == "checked_out" else None,
            "pre_checkin": pre_checkin,
        }
    )
    return summary


def _locked_room_readiness(reservation: Reservation, room: Room, business_date: date) -> dict:
    rows = _lock_inventory_rows(room.id, business_date, reservation.check_out_date)
    if len(rows) != (reservation.check_out_date - business_date).days:
        return {
            "is_ready": False,
            "label": "missing_inventory",
            "reason": "Room availability is missing for part of this stay. Review inventory for the assigned room before check-in.",
        }
    first_row = rows[0]
    housekeeping_code = _housekeeping_code(first_row.housekeeping_status_id)
    if room_has_external_block(room.id, business_date, reservation.check_out_date, for_update=True):
        return {
            "is_ready": False,
            "label": "calendar_conflict",
            "reason": "Assigned room is blocked by an external calendar sync. Review the room assignment before check-in.",
        }
    if getattr(first_row, "is_blocked", False):
        return {
            "is_ready": False,
            "label": "blocked",
            "reason": first_row.blocked_reason or "Assigned room is blocked. Clear the room block or assign another room before check-in.",
        }
    if housekeeping_code not in _ready_housekeeping_codes():
        return {
            "is_ready": False,
            "label": "not_ready",
            "reason": f"Room is marked {housekeeping_code or 'not ready'} for arrival. Update housekeeping to clean or inspected, or assign another ready room.",
        }
    consuming_conflict = any(
        row.reservation_id not in {None, reservation.id} and row.availability_status in {"reserved", "occupied", "house_use"}
        for row in rows
    )
    if consuming_conflict:
        return {
            "is_ready": False,
            "label": "conflict",
            "reason": "Assigned room conflicts with another active stay. Assign another room before check-in.",
        }
    bad_rows = [
        row
        for row in rows
        if row.availability_status in {"out_of_service", "out_of_order"}
        or (row.reservation_id is None and not row.is_sellable)
        or getattr(row, "is_blocked", False)
    ]
    if bad_rows:
        return {
            "is_ready": False,
            "label": "not_sellable",
            "reason": "Assigned room is not sellable for the full stay. Review room status or assign another room before check-in.",
        }
    return {"is_ready": True, "label": "ready", "reason": "Room is ready for arrival."}


def _locked_room_readiness_for_new_stay(room: Room, check_in_date: date, check_out_date: date) -> dict:
    rows = _lock_inventory_rows(room.id, check_in_date, check_out_date)
    if len(rows) != (check_out_date - check_in_date).days:
        return {"is_ready": False, "reason": "Inventory is missing for the requested walk-in stay."}
    first_row = rows[0]
    housekeeping_code = _housekeeping_code(first_row.housekeeping_status_id)
    if room_has_external_block(room.id, check_in_date, check_out_date, for_update=True):
        return {"is_ready": False, "reason": "Selected room is blocked by an external calendar sync."}
    if getattr(first_row, "is_blocked", False):
        return {"is_ready": False, "reason": first_row.blocked_reason or "Selected room is blocked."}
    if housekeeping_code not in _ready_housekeeping_codes():
        return {"is_ready": False, "reason": f"Selected room is {housekeeping_code or 'not ready'} for arrival."}
    if not all(row.availability_status == "available" and row.is_sellable and not getattr(row, "is_blocked", False) for row in rows):
        return {"is_ready": False, "reason": "Selected room is not available for the full stay."}
    return {"is_ready": True, "reason": "Room is ready for arrival."}
