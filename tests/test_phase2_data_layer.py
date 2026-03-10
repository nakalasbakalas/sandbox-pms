from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from uuid import UUID

import pytest
import sqlalchemy as sa

from pms.extensions import db
from pms.models import (
    AuditLog,
    Guest,
    GuestNote,
    InventoryDay,
    PaymentEvent,
    PaymentRequest,
    Reservation,
    ReservationStatusHistory,
    Room,
    RoomType,
)
from pms.services.reservation_service import ReservationCreatePayload, cancel_reservation, create_reservation


def make_payload(room_type_id, **overrides):
    today = date.today() + timedelta(days=7)
    payload = {
        "first_name": "Jane",
        "last_name": "Doe",
        "phone": f"080000{overrides.pop('phone_suffix', '1000')}",
        "email": "jane@example.com",
        "room_type_id": room_type_id,
        "check_in_date": today,
        "check_out_date": today + timedelta(days=2),
        "adults": 2,
        "children": 0,
        "extra_guests": 0,
        "source_channel": "direct",
        "request_payment": False,
    }
    payload.update(overrides)
    return ReservationCreatePayload(**payload)


def test_schema_can_migrate_from_empty_database(app_factory):
    app = app_factory(seed=False)
    with app.app_context():
        inspector = sa.inspect(db.engine)
        tables = set(inspector.get_table_names())
        assert "reservations" in tables
        assert "inventory_days" in tables
        assert "audit_log" in tables


def test_seeds_load_successfully_and_rooms_match_phase1(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        saleable_rooms = Room.query.filter_by(is_sellable=True, is_active=True).count()
        control_rooms = {room.room_number: room for room in Room.query.filter(Room.room_number.in_(["216", "316"])).all()}

        assert saleable_rooms == 30
        assert control_rooms["216"].is_sellable is False
        assert control_rooms["316"].is_sellable is False


def test_reservation_code_generation_is_unique_and_sequential(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        twin = RoomType.query.filter_by(code="TWN").first()
        first = create_reservation(make_payload(twin.id, phone_suffix="1001"))
        second = create_reservation(
            make_payload(
                twin.id,
                phone_suffix="1002",
                check_in_date=date.today() + timedelta(days=10),
                check_out_date=date.today() + timedelta(days=12),
            )
        )

        assert first.reservation_code == "SBX-00000001"
        assert second.reservation_code == "SBX-00000002"
        assert first.reservation_code != second.reservation_code


def test_cannot_create_reservation_with_invalid_dates(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        twin = RoomType.query.filter_by(code="TWN").first()
        with pytest.raises(ValueError, match="check_in_date must be before check_out_date"):
            create_reservation(
                make_payload(
                    twin.id,
                    check_out_date=date.today() + timedelta(days=7),
                    check_in_date=date.today() + timedelta(days=7),
                )
            )


def test_cannot_exceed_occupancy_rules(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        twin = RoomType.query.filter_by(code="TWN").first()
        with pytest.raises(ValueError, match="Occupancy exceeds room type maximum"):
            create_reservation(make_payload(twin.id, adults=2, children=2))


def test_cannot_double_book_same_room_date_range(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        twin = RoomType.query.filter_by(code="TWN").first()
        room = Room.query.filter_by(room_number="201").first()
        create_reservation(make_payload(twin.id, assigned_room_id=room.id, phone_suffix="1003"))
        with pytest.raises(ValueError, match="No available room could be assigned"):
            create_reservation(make_payload(twin.id, assigned_room_id=room.id, phone_suffix="1004"))


def test_cancellation_updates_reservation_history_and_inventory(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        twin = RoomType.query.filter_by(code="TWN").first()
        reservation = create_reservation(make_payload(twin.id, phone_suffix="1005"))
        cancel_reservation(reservation.id, None, "guest_requested")

        refreshed = db.session.get(Reservation, reservation.id)
        history = (
            ReservationStatusHistory.query.filter_by(reservation_id=reservation.id)
            .order_by(ReservationStatusHistory.changed_at.asc())
            .all()
        )
        inventory_rows = InventoryDay.query.filter_by(reservation_id=reservation.id).all()

        assert refreshed.current_status == "cancelled"
        assert len(history) == 2
        assert history[-1].new_status == "cancelled"
        assert inventory_rows == []


def test_payment_request_and_payment_event_relations_are_valid(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        twin = RoomType.query.filter_by(code="TWN").first()
        reservation = create_reservation(make_payload(twin.id, request_payment=True, phone_suffix="1006"))

        payment_request = PaymentRequest.query.filter_by(reservation_id=reservation.id).one()
        payment_event = PaymentEvent.query.filter_by(payment_request_id=payment_request.id).one()

        assert payment_request.status == "pending"
        assert payment_event.reservation_id == reservation.id
        assert payment_event.event_type == "payment_request_created"


def test_backup_restore_scripts_reference_postgres_tools():
    project_root = Path(__file__).resolve().parents[1]
    backup_sh = (project_root / "scripts" / "backup_db.sh").read_text()
    restore_sh = (project_root / "scripts" / "restore_db.sh").read_text()
    backup_ps1 = (project_root / "scripts" / "backup_db.ps1").read_text()
    restore_ps1 = (project_root / "scripts" / "restore_db.ps1").read_text()

    assert "pg_dump" in backup_sh
    assert "pg_restore" in restore_sh
    assert "pg_dump" in backup_ps1
    assert "pg_restore" in restore_ps1


def test_audit_log_writes_on_critical_mutations(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        twin = RoomType.query.filter_by(code="TWN").first()
        reservation = create_reservation(make_payload(twin.id, phone_suffix="1007"))
        cancel_reservation(reservation.id, None, "audit_test")

        actions = [
            log.action
            for log in AuditLog.query.filter_by(entity_table="reservations", entity_id=str(reservation.id))
            .order_by(AuditLog.created_at.asc())
            .all()
        ]
        assert actions == ["create", "cancel"]


def test_soft_deletes_behave_correctly(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        guest = Guest(
            first_name="Soft",
            last_name="Delete",
            full_name="Soft Delete",
            phone="0899999999",
            email="soft@example.com",
        )
        db.session.add(guest)
        db.session.flush()
        note = GuestNote(
            guest_id=guest.id,
            note_text="Test note",
            note_type="general",
            visibility_scope="all_staff",
        )
        db.session.add(note)
        db.session.commit()

        guest.deleted_at = datetime.now(timezone.utc)
        note.deleted_at = datetime.now(timezone.utc)
        db.session.commit()

        assert Guest.query.filter_by(phone="0899999999", deleted_at=None).first() is None
        assert Guest.query.filter_by(phone="0899999999").first() is not None
        assert GuestNote.query.filter_by(guest_id=guest.id, deleted_at=None).first() is None
