"""Front desk board — panel and status transition routes.

Handles the reservation side-panel (folio, charges, payments, notes, HK)
and board-level status transitions (check-in, check-out, no-show, room-ready).
"""

from __future__ import annotations

import logging
from datetime import date
from decimal import Decimal

import sqlalchemy as sa
from flask import (
    abort,
    current_app,
    jsonify,
    render_template,
    request,
)

from ..activity import write_activity_log
from ..audit import write_audit_log
from ..extensions import db
from ..helpers import (
    can,
    ensure_csrf_token,
    require_any_permission,
    require_permission,
)
from ..models import (
    HousekeepingStatus,
    InventoryDay,
    Reservation,
    Room,
)
from ..security import public_error_message
from ..services.front_desk_service import (
    CheckInPayload,
    CheckoutPayload,
    NoShowPayload,
    complete_check_in,
    complete_checkout,
    process_no_show,
)
from ..services.loyalty_service import award_checkout_points
from ..services.messaging_service import fire_automation_event
from .front_desk_board import board_json_or_redirect
from .front_desk_core import front_desk_bp

logger = logging.getLogger(__name__)


# ── Board status transition routes ────────────────────────────────────


@front_desk_bp.route("/staff/front-desk/board/reservations/<uuid:reservation_id>/check_in", methods=["POST"])
def staff_front_desk_board_check_in(reservation_id):
    """Check in a reservation via the front desk board."""
    user = require_permission("reservation.check_in")
    reservation = db.session.get(Reservation, reservation_id) or abort(404)

    if reservation.current_status in ("checked_in", "checked_out"):
        return jsonify(ok=False, error=f"Cannot check in a {reservation.current_status} reservation.")

    try:
        complete_check_in(
            reservation_id,
            CheckInPayload(
                room_id=reservation.assigned_room_id,
                first_name=reservation.primary_guest.first_name or "",
                last_name=reservation.primary_guest.last_name or "",
                phone=reservation.primary_guest.phone or "",
                email=reservation.primary_guest.email,
                nationality=reservation.primary_guest.nationality,
                id_document_type=reservation.primary_guest.id_document_type,
                id_document_number=reservation.primary_guest.id_document_number,
                preferred_language=reservation.primary_guest.preferred_language or reservation.booking_language,
                notes_summary=reservation.primary_guest.notes_summary,
                identity_verified=reservation.identity_verified_at is not None,
            ),
            actor_user_id=user.id,
        )

        write_activity_log(
            actor_user_id=user.id,
            event_type="front_desk.board_check_in",
            entity_table="reservations",
            entity_id=str(reservation_id),
            metadata={"via": "board_keyboard"},
        )

        db.session.refresh(reservation)
        try:
            fire_automation_event(
                "arrival_today",
                reservation_id=str(reservation_id),
                guest_id=str(reservation.primary_guest_id) if reservation.primary_guest_id else None,
                context={
                    "reservation_code": reservation.reservation_code,
                    "guest_name": reservation.primary_guest.full_name if reservation.primary_guest else "",
                    "check_in_date": str(reservation.check_in_date),
                    "check_out_date": str(reservation.check_out_date),
                    "hotel_name": current_app.config.get("HOTEL_NAME", ""),
                },
            )
        except Exception:  # noqa: BLE001
            logger.exception("Automation hook failed for arrival_today (board)")
        return jsonify(ok=True, message="Checked in.", status=reservation.current_status)
    except Exception as exc:
        write_audit_log(
            actor_user_id=user.id,
            entity_table="reservations",
            entity_id=str(reservation_id),
            action="front_desk_board_check_in_failed",
            after_data={"error": str(exc)},
        )
        return jsonify(ok=False, error=str(exc)), 409


@front_desk_bp.route("/staff/front-desk/board/reservations/<uuid:reservation_id>/check_out", methods=["POST"])
def staff_front_desk_board_check_out(reservation_id):
    """Check out a reservation via the front desk board."""
    user = require_permission("reservation.check_out")
    reservation = db.session.get(Reservation, reservation_id) or abort(404)

    if reservation.current_status in ("checked_out", "canceled"):
        return jsonify(ok=False, error=f"Cannot check out a {reservation.current_status} reservation.")

    try:
        complete_checkout(reservation_id, CheckoutPayload(), actor_user_id=user.id)

        write_activity_log(
            actor_user_id=user.id,
            event_type="front_desk.board_check_out",
            entity_table="reservations",
            entity_id=str(reservation_id),
            metadata={"via": "board_keyboard"},
        )

        db.session.refresh(reservation)
        try:
            award_checkout_points(reservation)
        except Exception:  # noqa: BLE001
            logger.exception("Loyalty points award failed for board checkout %s", reservation_id)
        try:
            fire_automation_event(
                "checkout_completed",
                reservation_id=str(reservation_id),
                guest_id=str(reservation.primary_guest_id) if reservation.primary_guest_id else None,
                context={
                    "reservation_code": reservation.reservation_code,
                    "guest_name": reservation.primary_guest.full_name if reservation.primary_guest else "",
                    "check_in_date": str(reservation.check_in_date),
                    "check_out_date": str(reservation.check_out_date),
                    "hotel_name": current_app.config.get("HOTEL_NAME", ""),
                },
            )
        except Exception:  # noqa: BLE001
            logger.exception("Automation hook failed for checkout_completed (board)")
        return jsonify(ok=True, message="Checked out.", status=reservation.current_status)
    except Exception as exc:
        write_audit_log(
            actor_user_id=user.id,
            entity_table="reservations",
            entity_id=str(reservation_id),
            action="front_desk_board_check_out_failed",
            after_data={"error": str(exc)},
        )
        return jsonify(ok=False, error=str(exc)), 409


@front_desk_bp.route("/staff/front-desk/board/reservations/<uuid:reservation_id>/no-show", methods=["POST"])
def staff_front_desk_board_no_show(reservation_id):
    """Mark a reservation as no-show via the front desk board (JSON)."""
    user = require_permission("reservation.cancel")
    reservation = db.session.get(Reservation, reservation_id) or abort(404)

    if reservation.current_status not in ("tentative", "confirmed"):
        return jsonify(ok=False, error=f"Cannot mark a {reservation.current_status} reservation as no-show.")

    try:
        process_no_show(
            reservation_id,
            NoShowPayload(reason="board_no_show"),
            actor_user_id=user.id,
        )
        write_activity_log(
            actor_user_id=user.id,
            event_type="front_desk.board_no_show",
            entity_table="reservations",
            entity_id=str(reservation_id),
            metadata={"via": "board_context_menu"},
        )
        return jsonify(ok=True, message="Marked as no-show.", status="no_show")
    except Exception as exc:
        write_audit_log(
            actor_user_id=user.id,
            entity_table="reservations",
            entity_id=str(reservation_id),
            action="front_desk_board_no_show_failed",
            after_data={"error": str(exc)},
        )
        return jsonify(ok=False, error=str(exc)), 409


@front_desk_bp.route("/staff/front-desk/board/reservations/<uuid:reservation_id>/room-ready", methods=["POST"])
def staff_front_desk_board_room_ready(reservation_id):
    """Mark the assigned room for a reservation as clean via the board context menu."""
    user = require_permission("reservation.edit")
    reservation = db.session.get(Reservation, reservation_id) or abort(404)
    if not reservation.assigned_room_id:
        return jsonify(ok=False, error="No room assigned to this reservation."), 400
    from ..services.housekeeping_service import RoomStatusUpdatePayload, update_housekeeping_status
    try:
        update_housekeeping_status(
            reservation.assigned_room_id,
            business_date=date.today(),
            payload=RoomStatusUpdatePayload(status_code="clean", note="Marked ready via front desk board"),
            actor_user_id=user.id,
        )
        write_audit_log(
            actor_user_id=user.id,
            entity_table="reservations",
            entity_id=str(reservation_id),
            action="board_mark_room_ready",
            after_data={"room_id": str(reservation.assigned_room_id)},
        )
        return jsonify(ok=True, message="Room marked clean.")
    except Exception as exc:  # noqa: BLE001
        return jsonify(ok=False, error=str(exc)), 409


# ── Board reservation panel ──────────────────────────────────────────


@front_desk_bp.route("/staff/front-desk/board/reservations/<uuid:reservation_id>/panel", methods=["GET"])
def staff_front_desk_board_reservation_panel(reservation_id):
    """Load panel content for a reservation — includes folio, charges, payments, notes, HK."""
    from ..models import FolioCharge

    user = require_permission("reservation.view")
    reservation = db.session.get(Reservation, reservation_id) or abort(404)
    deposit_gap = max(
        Decimal("0.00"),
        Decimal(str(reservation.deposit_required_amount or 0)) - Decimal(str(reservation.deposit_received_amount or 0)),
    )

    can_reassign = user.has_permission("reservation.edit")
    can_change_dates = user.has_permission("reservation.edit")
    can_check_in_perm = user.has_permission("reservation.check_in") and reservation.current_status in ["tentative", "confirmed"]
    can_check_out_perm = user.has_permission("reservation.check_out") and reservation.current_status == "checked_in"

    available_rooms = []
    if can_reassign and reservation.room_type_id:
        all_rooms = db.session.execute(
            sa.select(Room).filter(
                Room.room_type_id == reservation.room_type_id,
                Room.is_active.is_(True),
            ).order_by(Room.room_number)
        ).scalars().all()
        conflict_statuses = {"tentative", "confirmed", "checked_in", "house_use"}
        conflicting_room_ids = set(
            db.session.execute(
                sa.select(Reservation.assigned_room_id).filter(
                    Reservation.id != reservation.id,
                    Reservation.assigned_room_id.isnot(None),
                    Reservation.current_status.in_(conflict_statuses),
                    Reservation.check_in_date < reservation.check_out_date,
                    Reservation.check_out_date > reservation.check_in_date,
                )
            ).scalars().all()
        )
        for room in all_rooms:
            label = f"Room {room.room_number} — Floor {room.floor_number}"
            if room.id in conflicting_room_ids:
                label += " (unavailable)"
            available_rooms.append({"id": str(room.id), "label": label, "available": room.id not in conflicting_room_ids})

    # Check if arrival today and assigned room is dirty (turnaround conflict)
    is_conflict_room = False
    room_hk_status = None
    if reservation.assigned_room_id:
        hk_code = db.session.execute(
            sa.select(HousekeepingStatus.code).join(
                InventoryDay, InventoryDay.housekeeping_status_id == HousekeepingStatus.id
            ).where(
                InventoryDay.room_id == reservation.assigned_room_id,
                InventoryDay.business_date == date.today(),
            )
        ).scalar_one_or_none()
        room_hk_status = hk_code
        if (
            reservation.current_status in ("tentative", "confirmed")
            and reservation.check_in_date <= date.today()
            and hk_code in ("dirty", "occupied_dirty")
        ):
            is_conflict_room = True

    # Folio charges (non-voided, non-room, non-payment for extra charges display)
    folio_charges = db.session.execute(
        sa.select(FolioCharge)
        .where(
            FolioCharge.reservation_id == reservation.id,
            FolioCharge.voided_at.is_(None),
            FolioCharge.charge_type.notin_(["room", "deposit", "payment", "refund"]),
        )
        .order_by(FolioCharge.service_date.asc(), FolioCharge.posted_at.asc())
        .limit(20)
    ).scalars().all()

    context = {
        "reservation": reservation,
        "can_reassign": can_reassign,
        "can_change_dates": can_change_dates,
        "can_check_in": can_check_in_perm,
        "can_check_out": can_check_out_perm,
        "available_rooms": available_rooms,
        "csrf_token": ensure_csrf_token(),
        "nights": (reservation.check_out_date - reservation.check_in_date).days,
        "balance": max(Decimal(0), Decimal(str(reservation.quoted_grand_total or 0)) - Decimal(str(reservation.deposit_received_amount or 0))),
        "payment_state": "paid" if Decimal(str(reservation.deposit_received_amount or 0)) >= Decimal(str(reservation.quoted_grand_total or 0)) and Decimal(str(reservation.quoted_grand_total or 0)) > 0 else ("partial" if Decimal(str(reservation.deposit_received_amount or 0)) > 0 else "unpaid"),
        "recent_notes": list(reservation.notes[:5]) if reservation.notes else [],
        "can_cancel": user.has_permission("reservation.edit") and reservation.current_status in ["tentative", "confirmed"],
        "can_no_show": user.has_permission("reservation.edit") and reservation.current_status in ["tentative", "confirmed"] and reservation.check_in_date <= date.today(),
        "is_conflict_room": is_conflict_room,
        "room_hk_status": room_hk_status,
        "deposit_gap": deposit_gap,
        "arrival_due": reservation.current_status in ["tentative", "confirmed"] and reservation.check_in_date <= date.today(),
        "arrival_ready": reservation.current_status in ["tentative", "confirmed"] and reservation.check_in_date <= date.today() and bool(reservation.assigned_room_id) and not is_conflict_room and deposit_gap <= 0,
        "folio_charges": folio_charges,
        "can_add_charge": user.has_permission("folio.charge_add"),
        "can_add_payment": user.has_permission("payment.create"),
        "can_add_note": user.has_permission("reservation.edit"),
        "can_manage_hk": user.has_permission("housekeeping.edit") or user.has_permission("reservation.edit"),
    }

    return render_template("_panel_reservation_details.html", **context)


@front_desk_bp.route("/staff/front-desk/board/reservations/<uuid:reservation_id>/panel/charge", methods=["POST"])
def staff_front_desk_board_panel_charge(reservation_id):
    """Post a quick charge from the board panel."""
    from ..services.cashier_service import ManualAdjustmentPayload, post_manual_adjustment

    user = require_permission("folio.charge_add")
    try:
        post_manual_adjustment(
            reservation_id,
            ManualAdjustmentPayload(
                charge_type=request.form.get("charge_type", "manual_charge"),
                amount=Decimal(request.form.get("amount") or "0.00"),
                description=request.form.get("description", ""),
                note="Charged via board panel",
            ),
            actor_user_id=user.id,
        )
        return board_json_or_redirect(ok=True, message="Charge posted.", status_code=200)
    except Exception as exc:  # noqa: BLE001
        return board_json_or_redirect(ok=False, message="Charge could not be posted.", error=public_error_message(exc), status_code=409)


@front_desk_bp.route("/staff/front-desk/board/reservations/<uuid:reservation_id>/panel/payment", methods=["POST"])
def staff_front_desk_board_panel_payment(reservation_id):
    """Record a quick payment from the board panel."""
    from ..services.cashier_service import PaymentPostingPayload, record_payment

    user = require_permission("payment.create")
    try:
        record_payment(
            reservation_id,
            PaymentPostingPayload(
                amount=Decimal(request.form.get("amount") or "0.00"),
                payment_method=request.form.get("payment_method", "cash"),
                note=request.form.get("note") or "Recorded via board panel",
            ),
            actor_user_id=user.id,
        )
        return board_json_or_redirect(ok=True, message="Payment recorded.", status_code=200)
    except Exception as exc:  # noqa: BLE001
        return board_json_or_redirect(ok=False, message="Payment could not be recorded.", error=public_error_message(exc), status_code=409)


@front_desk_bp.route("/staff/front-desk/board/reservations/<uuid:reservation_id>/panel/note", methods=["POST"])
def staff_front_desk_board_panel_note(reservation_id):
    """Add a note from the board panel."""
    from ..services.staff_reservations_service import ReservationNotePayload, add_reservation_note

    user = require_permission("reservation.edit")
    try:
        add_reservation_note(
            reservation_id,
            ReservationNotePayload(
                note_text=request.form.get("note_text", ""),
                note_type="general",
                is_important=request.form.get("is_important") == "on",
                visibility_scope="all_staff",
            ),
            actor_user_id=user.id,
        )
        return board_json_or_redirect(ok=True, message="Note added.", status_code=200)
    except Exception as exc:  # noqa: BLE001
        return board_json_or_redirect(ok=False, message="Note could not be added.", error=public_error_message(exc), status_code=409)


@front_desk_bp.route("/staff/front-desk/board/reservations/<uuid:reservation_id>/panel/hk", methods=["POST"])
def staff_front_desk_board_panel_hk(reservation_id):
    """Update housekeeping status from the board panel."""
    from ..services.housekeeping_service import RoomStatusUpdatePayload, update_housekeeping_status

    user = require_any_permission("housekeeping.edit", "reservation.edit")
    reservation = db.session.get(Reservation, reservation_id) or abort(404)
    if not reservation.assigned_room_id:
        return board_json_or_redirect(ok=False, message="Room status could not be updated.", error="No room assigned.", status_code=400)
    status_code = request.form.get("status_code", "clean")
    try:
        update_housekeeping_status(
            reservation.assigned_room_id,
            business_date=date.today(),
            payload=RoomStatusUpdatePayload(status_code=status_code, note=f"Updated via board panel to {status_code}"),
            actor_user_id=user.id,
        )
        return board_json_or_redirect(ok=True, message=f"Room marked {status_code.replace('_', ' ')}.", status_code=200)
    except Exception as exc:  # noqa: BLE001
        return board_json_or_redirect(ok=False, message="Room status could not be updated.", error=public_error_message(exc), status_code=409)
