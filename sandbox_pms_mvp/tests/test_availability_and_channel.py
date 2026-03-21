"""Tests for the centralized availability service and channel manager adapter layer."""

from __future__ import annotations

import json
from datetime import date, timedelta
from decimal import Decimal

import pytest

from pms.extensions import db
from pms.models import (
    AppSetting,
    InventoryDay,
    OtaChannel,
    Reservation,
    Room,
    RoomType,
)
from pms.services.availability_service import (
    RoomAssignability,
    can_move_reservation,
    count_available_rooms,
    estimate_inventory_impact,
    list_assignable_rooms,
    query_room_type_availability,
)
from pms.services.channel_service import (
    AgodaChannelProvider,
    BookingComChannelProvider,
    ChannelSyncService,
    ExpediaChannelProvider,
    InboundReservation,
    MockChannelProvider,
    OutboundInventoryUpdate,
    build_outbound_inventory_updates,
    get_provider,
    provider_push_context,
)
from pms.services.reservation_service import (
    ReservationCreatePayload,
    create_reservation,
)


# ---------------------------------------------------------------------------
# Availability service tests
# ---------------------------------------------------------------------------

class TestAvailabilityService:
    """Tests for the centralized availability service."""

    def test_query_room_type_availability_returns_results(self, app_factory):
        """Availability query should return results for seeded data."""
        app = app_factory(seed=True)
        with app.app_context():
            today = date.today()
            tomorrow = today + timedelta(days=1)
            result = query_room_type_availability(today, tomorrow)
            assert len(result) > 0
            for rta in result:
                assert rta.room_type_id is not None
                assert rta.total_rooms >= 0
                assert len(rta.dates) == 1

    def test_count_available_rooms_seeded(self, app_factory):
        """count_available_rooms should return a non-negative integer."""
        app = app_factory(seed=True)
        with app.app_context():
            rt = RoomType.query.first()
            today = date.today()
            count = count_available_rooms(rt.id, today, today + timedelta(days=1))
            assert isinstance(count, int)
            assert count >= 0

    def test_availability_queries_handle_200_plus_inventory_days(self, app_factory):
        """Long-horizon availability queries should stay correct on bootstrapped inventory."""
        app = app_factory(seed=True, config={"INVENTORY_BOOTSTRAP_DAYS": 240})
        with app.app_context():
            rt = RoomType.query.first()
            check_in = date.today()
            check_out = check_in + timedelta(days=210)

            result = query_room_type_availability(check_in, check_out, rt.id)

            assert len(result) == 1
            assert len(result[0].dates) == 210
            assert result[0].available_rooms == min(day.available_count for day in result[0].dates)
            assert count_available_rooms(rt.id, check_in, check_out) == result[0].available_rooms

    def test_availability_decreases_after_booking(self, app_factory):
        """Creating a reservation should reduce available rooms."""
        app = app_factory(seed=True)
        with app.app_context():
            rt = RoomType.query.first()
            today = date.today()
            tomorrow = today + timedelta(days=1)
            before = count_available_rooms(rt.id, today, tomorrow)

            # Create a reservation
            create_reservation(
                ReservationCreatePayload(
                    room_type_id=rt.id,
                    check_in_date=today,
                    check_out_date=tomorrow,
                    first_name="Avail",
                    last_name="Test",
                    email="avail@test.com",
                    phone="0800000001",
                    adults=1,
                    children=0,
                ),
                actor_user_id=None,
            )
            after = count_available_rooms(rt.id, today, tomorrow)
            assert after < before

    def test_list_assignable_rooms_returns_rooms(self, app_factory):
        """list_assignable_rooms should return rooms for the given room type."""
        app = app_factory(seed=True)
        with app.app_context():
            rt = RoomType.query.first()
            today = date.today()
            rooms = list_assignable_rooms(rt.id, today, today + timedelta(days=1))
            assert len(rooms) > 0
            for r in rooms:
                assert isinstance(r, RoomAssignability)
                assert r.room_number is not None

    def test_estimate_inventory_impact_create(self, app_factory):
        """estimate_inventory_impact for create action."""
        app = app_factory(seed=True)
        with app.app_context():
            rt = RoomType.query.first()
            today = date.today()
            impact = estimate_inventory_impact(
                "create", rt.id, today, today + timedelta(days=3),
            )
            assert impact.action == "create"
            assert impact.rooms_consumed == 3
            assert impact.rooms_released == 0
            assert impact.net_change == -3

    def test_estimate_inventory_impact_cancel(self, app_factory):
        """estimate_inventory_impact for cancel action."""
        app = app_factory(seed=True)
        with app.app_context():
            rt = RoomType.query.first()
            today = date.today()
            impact = estimate_inventory_impact(
                "cancel", rt.id, today, today + timedelta(days=2),
            )
            assert impact.action == "cancel"
            assert impact.rooms_released == 2
            assert impact.rooms_consumed == 0
            assert impact.net_change == 2

    def test_estimate_inventory_impact_modify(self, app_factory):
        """estimate_inventory_impact for modify action shows net change."""
        app = app_factory(seed=True)
        with app.app_context():
            rt = RoomType.query.first()
            today = date.today()
            impact = estimate_inventory_impact(
                "modify", rt.id,
                check_in=today + timedelta(days=1),
                check_out=today + timedelta(days=4),
                old_check_in=today,
                old_check_out=today + timedelta(days=2),
            )
            assert impact.action == "modify"
            # Old: day0, day1 → New: day1, day2, day3
            # Released: day0; Consumed: day2, day3
            assert impact.rooms_released == 1
            assert impact.rooms_consumed == 2
            assert impact.net_change == -1

    def test_can_move_reservation_valid(self, app_factory):
        """can_move_reservation returns assignable=True for valid move."""
        app = app_factory(seed=True)
        with app.app_context():
            rt = RoomType.query.first()
            today = date.today()
            tomorrow = today + timedelta(days=1)
            res = create_reservation(
                ReservationCreatePayload(
                    room_type_id=rt.id,
                    check_in_date=today,
                    check_out_date=tomorrow,
                    first_name="Move",
                    last_name="Test",
                    email="move@test.com",
                    phone="0800000002",
                    adults=1,
                    children=0,
                ),
                actor_user_id=None,
            )
            # Find another room of same type
            other_rooms = Room.query.filter(
                Room.room_type_id == rt.id,
                Room.is_active.is_(True),
                Room.id != res.assigned_room_id,
            ).all()
            if other_rooms:
                result = can_move_reservation(res.id, other_rooms[0].id)
                assert result.is_assignable is True

    def test_can_move_reservation_wrong_type(self, app_factory):
        """can_move_reservation returns False for wrong room type."""
        app = app_factory(seed=True)
        with app.app_context():
            room_types = RoomType.query.all()
            if len(room_types) < 2:
                return  # Need 2 room types for this test
            rt1, rt2 = room_types[0], room_types[1]
            today = date.today()
            res = create_reservation(
                ReservationCreatePayload(
                    room_type_id=rt1.id,
                    check_in_date=today,
                    check_out_date=today + timedelta(days=1),
                    first_name="WrongType",
                    last_name="Test",
                    email="wrongtype@test.com",
                    phone="0800000003",
                    adults=1,
                    children=0,
                ),
                actor_user_id=None,
            )
            other_room = Room.query.filter(
                Room.room_type_id == rt2.id,
                Room.is_active.is_(True),
            ).first()
            if other_room:
                result = can_move_reservation(res.id, other_room.id)
                assert result.is_assignable is False
                assert "mismatch" in (result.blocking_reason or "").lower()


# ---------------------------------------------------------------------------
# Channel manager adapter tests
# ---------------------------------------------------------------------------

class TestChannelService:
    """Tests for the channel manager adapter layer."""

    def test_mock_provider_pull_returns_empty(self, app_factory):
        """MockChannelProvider.pull_reservations returns an empty list."""
        app = app_factory(seed=True)
        with app.app_context():
            provider = MockChannelProvider()
            results = provider.pull_reservations()
            assert results == []

    def test_mock_provider_push_succeeds(self, app_factory):
        """MockChannelProvider.push_inventory returns success."""
        app = app_factory(seed=True)
        with app.app_context():
            provider = MockChannelProvider()
            updates = [
                OutboundInventoryUpdate(
                    room_type_code="STD",
                    date_from=date.today(),
                    date_to=date.today() + timedelta(days=1),
                    available_count=5,
                    rate_amount=Decimal("1500.00"),
                ),
            ]
            result = provider.push_inventory(updates)
            assert result.success is True
            assert result.records_processed == 1

    def test_mock_provider_logs_operations(self, app_factory):
        """MockChannelProvider records operations for inspection."""
        app = app_factory(seed=True)
        with app.app_context():
            provider = MockChannelProvider()
            provider.pull_reservations()
            provider.push_inventory([])
            assert len(provider.operation_log) == 2
            assert provider.operation_log[0]["action"] == "pull_reservations"
            assert provider.operation_log[1]["action"] == "push_inventory"

    def test_mock_provider_connection_test(self, app_factory):
        """MockChannelProvider.test_connection always returns True."""
        app = app_factory(seed=True)
        with app.app_context():
            provider = MockChannelProvider()
            assert provider.test_connection() is True

    def test_get_provider_mock(self, app_factory):
        """get_provider('mock') returns MockChannelProvider."""
        app = app_factory(seed=True)
        with app.app_context():
            provider = get_provider("mock")
            assert provider.provider_key == "mock"

    def test_get_provider_ical(self, app_factory):
        """get_provider('ical') returns ICalChannelProvider."""
        app = app_factory(seed=True)
        with app.app_context():
            provider = get_provider("ical")
            assert provider.provider_key == "ical"

    def test_get_provider_webhook(self, app_factory):
        app = app_factory(seed=True)
        with app.app_context():
            provider = get_provider("webhook")
            assert provider.provider_key == "webhook"

    def test_get_provider_unknown_raises(self, app_factory):
        """get_provider with unknown key raises ValueError."""
        app = app_factory(seed=True)
        with app.app_context():
            with pytest.raises(ValueError, match="Unknown channel provider"):
                get_provider("nonexistent_provider")

    def test_sync_service_import_idempotent(self, app_factory):
        """ChannelSyncService.import_reservations is idempotent for mock."""
        app = app_factory(seed=True)
        with app.app_context():
            provider = MockChannelProvider()
            service = ChannelSyncService(provider)
            result1 = service.import_reservations()
            result2 = service.import_reservations()
            assert result1.success is True
            assert result2.success is True

    def test_sync_service_push_inventory(self, app_factory):
        """ChannelSyncService.push_inventory_updates succeeds for mock."""
        app = app_factory(seed=True)
        with app.app_context():
            provider = MockChannelProvider()
            service = ChannelSyncService(provider)
            updates = [
                OutboundInventoryUpdate(
                    room_type_code="DLX",
                    date_from=date.today(),
                    date_to=date.today() + timedelta(days=7),
                    available_count=3,
                ),
            ]
            result = service.push_inventory_updates(updates)
            assert result.success is True
            assert result.records_processed == 1

    def test_ical_provider_push_is_noop(self, app_factory):
        """ICalChannelProvider.push_inventory is a no-op (pull-based feeds)."""
        app = app_factory(seed=True)
        with app.app_context():
            provider = get_provider("ical")
            result = provider.push_inventory([])
            assert result.success is True
            assert result.records_processed == 0

    def test_ical_provider_connection_test(self, app_factory):
        """ICalChannelProvider.test_connection always returns True."""
        app = app_factory(seed=True)
        with app.app_context():
            provider = get_provider("ical")
            assert provider.test_connection() is True

    def test_booking_com_provider_fails_clearly_without_endpoint(self, app_factory):
        app = app_factory(seed=True)
        with app.app_context():
            provider = get_provider("booking_com")
            result = provider.push_inventory([])
            assert result.success is False
            assert "endpoint is not configured" in result.errors[0]

    def test_build_outbound_inventory_updates_and_provider_context(self, app_factory, monkeypatch):
        app = app_factory(seed=True)
        captured: dict[str, object] = {}

        class _FakeResponse:
            status = 202

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, tb):
                return False

            def read(self):
                return b'{"accepted": true}'

        def fake_urlopen(request, timeout):  # noqa: ANN001
            captured["url"] = request.full_url
            captured["auth"] = request.headers.get("Authorization")
            captured["body"] = json.loads(request.data.decode("utf-8"))
            captured["timeout"] = timeout
            return _FakeResponse()

        with app.app_context():
            db.session.add_all(
                [
                    AppSetting(
                        key="channel_push.booking_com.endpoint",
                        value_json={"value": "https://channels.example.test/booking"},
                        value_type="string",
                    ),
                    AppSetting(
                        key="channel_push.booking_com.api_token",
                        value_json={"value": "booking-token"},
                        value_type="string",
                    ),
                    AppSetting(
                        key="channel_push.booking_com.account_id",
                        value_json={"value": "hotel-123"},
                        value_type="string",
                    ),
                ]
            )
            db.session.commit()

            room_type = RoomType.query.filter_by(code="TWN").one()
            updates = build_outbound_inventory_updates(
                date_from=date.today(),
                date_to=date.today() + timedelta(days=1),
                room_type_id=room_type.id,
            )
            assert len(updates) == 2
            assert all(update.room_type_code == "TWN" for update in updates)
            assert all(update.date_to == update.date_from + timedelta(days=1) for update in updates)

            context = provider_push_context()
            assert context["booking_com"]["configured"] is True
            assert context["booking_com"]["has_api_token"] is True
            assert context["booking_com"]["account_id"] == "hotel-123"

            monkeypatch.setattr("pms.services.channel_service.urllib.request.urlopen", fake_urlopen)
            provider = get_provider("booking_com")
            result = provider.push_inventory(updates)

        assert result.success is True
        assert result.records_processed == 2
        assert captured["url"] == "https://channels.example.test/booking"
        assert captured["auth"] == "Bearer booking-token"
        assert captured["body"]["provider"] == "booking_com"
        assert captured["body"]["account_id"] == "hotel-123"
        assert len(captured["body"]["updates"]) == 2
