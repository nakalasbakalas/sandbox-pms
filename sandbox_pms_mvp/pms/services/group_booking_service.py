from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from ..activity import write_activity_log
from ..audit import write_audit_log
from ..extensions import db
from ..models import Reservation, ReservationHold, Room, RoomType, utc_now
from .public_booking_service import (
    HoldRequestPayload,
    _release_hold_inventory,
    cleanup_expired_holds,
    create_reservation_hold,
    get_live_available_rooms,
)


@dataclass
class GroupBlockCreatePayload:
    group_name: str
    check_in_date: date
    check_out_date: date
    room_type_id: uuid.UUID
    room_count: int
    adults: int = 2
    children: int = 0
    extra_guests: int = 0
    contact_name: str | None = None
    contact_email: str | None = None
    notes: str | None = None
    booking_language: str = "en"
    source_channel: str = "admin_manual"


def create_group_room_block(
    payload: GroupBlockCreatePayload,
    *,
    actor_user_id: uuid.UUID | None,
) -> dict:
    payload.group_name = (payload.group_name or "").strip()[:120]
    if not payload.group_name:
        raise ValueError("Group name is required.")
    if payload.room_count < 1:
        raise ValueError("Room count must be at least one.")
    if payload.check_in_date >= payload.check_out_date:
        raise ValueError("Check-in date must be before check-out date.")
    if payload.adults < 1 or payload.children < 0 or payload.extra_guests < 0:
        raise ValueError("Occupancy values are invalid.")

    cleanup_expired_holds()
    available_rooms = get_live_available_rooms(
        room_type_id=payload.room_type_id,
        check_in_date=payload.check_in_date,
        check_out_date=payload.check_out_date,
    )
    if len(available_rooms) < payload.room_count:
        raise ValueError(
            f"Only {len(available_rooms)} room(s) are currently available for this room type and date range."
        )

    group_block_code = f"GRP-{uuid.uuid4().hex[:8].upper()}"
    created_holds: list[ReservationHold] = []
    try:
        for index in range(payload.room_count):
            created_holds.append(
                create_reservation_hold(
                    HoldRequestPayload(
                        check_in_date=payload.check_in_date,
                        check_out_date=payload.check_out_date,
                        adults=payload.adults,
                        children=payload.children,
                        room_type_id=payload.room_type_id,
                        # Group blocks intentionally hold multiple rooms under the same
                        # coordinator, so they must bypass the guest-email duplicate
                        # safeguard used for public one-room holds.
                        guest_email=None,
                        idempotency_key=f"group:{group_block_code}:{index + 1}",
                        language=payload.booking_language,
                        source_channel=payload.source_channel,
                        source_metadata={
                            "group_block_code": group_block_code,
                            "group_name": payload.group_name,
                            "contact_name": (payload.contact_name or "").strip()[:120] or None,
                            "contact_email": (payload.contact_email or "").strip()[:255] or None,
                            "notes": (payload.notes or "").strip()[:500] or None,
                            "room_block_index": index + 1,
                            "room_block_total": payload.room_count,
                            "created_by_user_id": str(actor_user_id) if actor_user_id else None,
                            "source_label": "group_room_block",
                        },
                        request_ip=None,
                        user_agent="staff-group-block",
                        extra_guests=payload.extra_guests,
                    )
                )
            )
    except Exception:
        _rollback_created_group_block(created_holds, actor_user_id=actor_user_id, group_block_code=group_block_code)
        raise

    write_audit_log(
        actor_user_id=actor_user_id,
        entity_table="group_blocks",
        entity_id=group_block_code,
        action="create",
        after_data={
            "group_name": payload.group_name,
            "room_count": payload.room_count,
            "check_in_date": payload.check_in_date.isoformat(),
            "check_out_date": payload.check_out_date.isoformat(),
            "room_type_id": str(payload.room_type_id),
            "hold_codes": [hold.hold_code for hold in created_holds],
        },
    )
    write_activity_log(
        actor_user_id=actor_user_id,
        event_type="group_block.created",
        entity_table="group_blocks",
        entity_id=group_block_code,
        metadata={
            "room_count": payload.room_count,
            "check_in_date": payload.check_in_date.isoformat(),
            "check_out_date": payload.check_out_date.isoformat(),
        },
    )
    db.session.commit()
    return get_group_block_detail(group_block_code)


def list_group_room_blocks(*, include_inactive: bool = False, limit: int = 12) -> list[dict]:
    cleanup_expired_holds()
    query = ReservationHold.query.order_by(ReservationHold.created_at.desc())
    if not include_inactive:
        query = query.filter(ReservationHold.status == "active")
    holds = [
        hold
        for hold in query.limit(250).all()
        if _group_block_code(hold)
    ]
    grouped: dict[str, list[ReservationHold]] = {}
    for hold in holds:
        grouped.setdefault(_group_block_code(hold), []).append(hold)
    summaries = [_serialize_group_block(group_code, group_holds) for group_code, group_holds in grouped.items()]
    summaries.sort(key=lambda item: item["created_at"] or item["updated_at"], reverse=True)
    return summaries[:limit]


def get_group_block_detail(group_block_code: str) -> dict:
    cleanup_expired_holds()
    holds = _load_group_block_holds(group_block_code)
    if not holds:
        raise ValueError("Group room block not found.")
    return _serialize_group_block(group_block_code, holds)


def release_group_room_block(
    group_block_code: str,
    *,
    actor_user_id: uuid.UUID | None,
) -> dict:
    holds = _load_group_block_holds(group_block_code, active_only=True, for_update=True)
    if not holds:
        raise ValueError("No active holds found for this group room block.")

    released_codes: list[str] = []
    for hold in holds:
        before_status = hold.status
        _release_hold_inventory(hold)
        hold.status = "released"
        hold.updated_at = utc_now()
        released_codes.append(hold.hold_code)
        write_audit_log(
            actor_user_id=actor_user_id,
            entity_table="reservation_holds",
            entity_id=str(hold.id),
            action="release",
            before_data={"status": before_status},
            after_data={"status": hold.status, "group_block_code": group_block_code},
        )

    write_audit_log(
        actor_user_id=actor_user_id,
        entity_table="group_blocks",
        entity_id=group_block_code,
        action="release",
        after_data={"released_hold_codes": released_codes},
    )
    write_activity_log(
        actor_user_id=actor_user_id,
        event_type="group_block.released",
        entity_table="group_blocks",
        entity_id=group_block_code,
        metadata={"released_hold_codes": released_codes},
    )
    db.session.commit()
    return get_group_block_detail(group_block_code)


def _rollback_created_group_block(
    holds: list[ReservationHold],
    *,
    actor_user_id: uuid.UUID | None,
    group_block_code: str,
) -> None:
    if not holds:
        return
    db.session.rollback()
    hold_ids = [hold.id for hold in holds if hold.id]
    if not hold_ids:
        return
    stored_holds = (
        db.session.query(ReservationHold)
        .filter(ReservationHold.id.in_(hold_ids))
        .all()
    )
    for hold in stored_holds:
        if hold.status != "active":
            continue
        _release_hold_inventory(hold)
        hold.status = "released"
        hold.updated_at = utc_now()
    write_activity_log(
        actor_user_id=actor_user_id,
        event_type="group_block.rollback",
        entity_table="group_blocks",
        entity_id=group_block_code,
        metadata={"released_hold_count": len(stored_holds)},
    )
    db.session.commit()


def _load_group_block_holds(
    group_block_code: str,
    *,
    active_only: bool = False,
    for_update: bool = False,
) -> list[ReservationHold]:
    normalized_code = (group_block_code or "").strip().upper()
    if not normalized_code:
        return []
    query = db.session.query(ReservationHold).order_by(
        ReservationHold.created_at.asc(),
        ReservationHold.hold_code.asc(),
    )
    if active_only:
        query = query.filter(ReservationHold.status == "active")
    if for_update:
        query = query.with_for_update()
    return [
        hold
        for hold in query.all()
        if _group_block_code(hold) == normalized_code
    ]


def _serialize_group_block(group_block_code: str, holds: list[ReservationHold]) -> dict:
    room_type_ids = {hold.room_type_id for hold in holds}
    room_ids = {hold.assigned_room_id for hold in holds if hold.assigned_room_id}
    converted_ids = {hold.converted_reservation_id for hold in holds if hold.converted_reservation_id}
    room_type_map = {
        room_type.id: room_type
        for room_type in RoomType.query.filter(RoomType.id.in_(room_type_ids)).all()
    } if room_type_ids else {}
    room_map = {
        room.id: room
        for room in Room.query.filter(Room.id.in_(room_ids)).all()
    } if room_ids else {}
    reservation_map = {
        reservation.id: reservation
        for reservation in Reservation.query.filter(Reservation.id.in_(converted_ids)).all()
    } if converted_ids else {}
    first_hold = holds[0]
    metadata = first_hold.source_metadata_json or {}
    active_count = sum(1 for hold in holds if hold.status == "active")
    converted_count = sum(1 for hold in holds if hold.status == "converted")
    released_count = sum(1 for hold in holds if hold.status == "released")
    total_room_revenue = sum((Decimal(str(hold.quoted_room_total or 0)) for hold in holds), Decimal("0.00"))
    total_grand = sum((Decimal(str(hold.quoted_grand_total or 0)) for hold in holds), Decimal("0.00"))
    items = []
    for hold in holds:
        room = room_map.get(hold.assigned_room_id)
        converted = reservation_map.get(hold.converted_reservation_id)
        items.append(
            {
                "hold_id": hold.id,
                "hold_code": hold.hold_code,
                "status": hold.status,
                "assigned_room_id": hold.assigned_room_id,
                "assigned_room_number": room.room_number if room else None,
                "quoted_grand_total": Decimal(str(hold.quoted_grand_total or 0)).quantize(Decimal("0.01")),
                "quoted_room_total": Decimal(str(hold.quoted_room_total or 0)).quantize(Decimal("0.01")),
                "expires_at": hold.expires_at,
                "converted_reservation_id": hold.converted_reservation_id,
                "converted_reservation_code": converted.reservation_code if converted else None,
            }
        )
    items.sort(key=lambda item: (item["assigned_room_number"] or "", item["hold_code"]))
    room_type = room_type_map.get(first_hold.room_type_id)
    block_status = "active"
    if active_count == 0 and converted_count:
        block_status = "converted"
    elif active_count == 0 and released_count:
        block_status = "released"
    return {
        "group_block_code": group_block_code,
        "group_name": metadata.get("group_name") or group_block_code,
        "contact_name": metadata.get("contact_name"),
        "contact_email": metadata.get("contact_email"),
        "notes": metadata.get("notes"),
        "created_by_user_id": metadata.get("created_by_user_id"),
        "status": block_status,
        "check_in_date": first_hold.check_in_date,
        "check_out_date": first_hold.check_out_date,
        "room_type_id": first_hold.room_type_id,
        "room_type_code": room_type.code if room_type else None,
        "room_type_name": room_type.name if room_type else None,
        "room_count": len(holds),
        "active_count": active_count,
        "converted_count": converted_count,
        "released_count": released_count,
        "total_room_revenue": total_room_revenue.quantize(Decimal("0.01")),
        "total_grand_total": total_grand.quantize(Decimal("0.01")),
        "created_at": min((hold.created_at for hold in holds), default=None),
        "updated_at": max((hold.updated_at for hold in holds), default=None),
        "holds": items,
    }


def _group_block_code(hold: ReservationHold) -> str:
    return str((hold.source_metadata_json or {}).get("group_block_code") or "").strip().upper()
