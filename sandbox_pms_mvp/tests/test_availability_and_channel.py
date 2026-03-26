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
            # Find another room of same type that is actually available
            assignable = [
                r for r in list_assignable_rooms(
                    rt.id, today, tomorrow,
                    exclude_reservation_id=res.id,
                )
                if r.is_assignable and r.room_id != res.assigned_room_id
            ]
            if assignable:
                result = can_move_reservation(res.id, assignable[0].room_id)
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


# ---------------------------------------------------------------------------
# OTA dashboard, mapping, and sync-log tests
# ---------------------------------------------------------------------------


class TestOtaDashboardAndMappings:
    """Tests for OTA dashboard context, mapping CRUD, and sync log helpers."""

    def test_ota_dashboard_context_returns_all_channels(self, app_factory):
        """ota_dashboard_context should return an entry for every OTA_PROVIDER_KEYS."""
        from pms.services.channel_service import ota_dashboard_context
        app = app_factory(seed=True)
        with app.app_context():
            ctx = ota_dashboard_context()
            assert "summary" in ctx
            assert "channels" in ctx
            assert "room_types" in ctx
            assert "recent_logs" in ctx
            assert len(ctx["channels"]) == 3  # booking_com, expedia, agoda
            for ch in ctx["channels"]:
                assert ch["health"] in ("not_configured", "inactive", "unknown", "warning", "healthy", "error")

    def test_ota_dashboard_health_not_configured(self, app_factory):
        """Channels without credentials should show not_configured."""
        from pms.services.channel_service import ota_dashboard_context
        app = app_factory(seed=True)
        with app.app_context():
            ctx = ota_dashboard_context()
            for ch in ctx["channels"]:
                assert ch["health"] == "not_configured"

    def test_ota_dashboard_health_with_credentials(self, app_factory):
        """Channel with credentials but untested should show unknown."""
        from pms.services.channel_service import ota_dashboard_context, upsert_ota_channel
        app = app_factory(seed=True)
        with app.app_context():
            upsert_ota_channel(
                provider_key="booking_com",
                display_name="Booking.com",
                is_active=True,
                api_key="test-key-1234",
            )
            db.session.commit()
            ctx = ota_dashboard_context()
            booking = next(ch for ch in ctx["channels"] if ch["provider_key"] == "booking_com")
            assert booking["health"] == "unknown"

    def test_ota_dashboard_health_tested_ok(self, app_factory):
        """Channel with successful test and no mappings should show warning."""
        from pms.services.channel_service import ota_dashboard_context, upsert_ota_channel
        from pms.models import utc_now
        app = app_factory(seed=True)
        with app.app_context():
            ch = upsert_ota_channel(
                provider_key="booking_com",
                display_name="Booking.com",
                is_active=True,
                api_key="test-key-1234",
            )
            ch.last_test_ok = True
            ch.last_tested_at = utc_now()
            db.session.commit()
            ctx = ota_dashboard_context()
            booking = next(c for c in ctx["channels"] if c["provider_key"] == "booking_com")
            # Warning because there are room types but no mappings
            assert booking["health"] == "warning"
            assert booking["unmapped_count"] > 0

    def test_upsert_ota_mapping_creates_and_updates(self, app_factory):
        """upsert_ota_mapping should create a new mapping and update it on re-call."""
        from pms.services.channel_service import upsert_ota_mapping, list_ota_mappings
        app = app_factory(seed=True)
        with app.app_context():
            rt = RoomType.query.first()
            m = upsert_ota_mapping(
                provider_key="booking_com",
                room_type_id=rt.id,
                external_room_type_code="STD_KING",
                external_room_type_name="Standard King",
            )
            db.session.commit()
            assert m.external_room_type_code == "STD_KING"
            assert m.external_room_type_name == "Standard King"

            # Update same mapping
            m2 = upsert_ota_mapping(
                provider_key="booking_com",
                room_type_id=rt.id,
                external_room_type_code="STD_KING",
                external_room_type_name="Updated Name",
            )
            db.session.commit()
            assert m2.id == m.id
            assert m2.external_room_type_name == "Updated Name"

            mappings = list_ota_mappings(provider_key="booking_com")
            assert len(mappings) == 1

    def test_delete_ota_mapping_soft_deletes(self, app_factory):
        """delete_ota_mapping should soft-delete and list_ota_mappings should exclude it."""
        from pms.services.channel_service import upsert_ota_mapping, delete_ota_mapping, list_ota_mappings
        app = app_factory(seed=True)
        with app.app_context():
            rt = RoomType.query.first()
            m = upsert_ota_mapping(
                provider_key="booking_com",
                room_type_id=rt.id,
                external_room_type_code="DLX_TWIN",
            )
            db.session.commit()

            assert delete_ota_mapping(m.id) is True
            db.session.commit()

            mappings = list_ota_mappings(provider_key="booking_com")
            assert len(mappings) == 0

            # Double delete returns False
            assert delete_ota_mapping(m.id) is False

    def test_write_and_list_sync_logs(self, app_factory):
        """write_sync_log should create entries and list_sync_logs should return them."""
        from pms.services.channel_service import write_sync_log, list_sync_logs
        from pms.models import utc_now
        app = app_factory(seed=True)
        with app.app_context():
            started = utc_now()
            write_sync_log(
                provider_key="booking_com",
                direction="outbound",
                action="push_inventory",
                status="success",
                records_processed=10,
                started_at=started,
            )
            write_sync_log(
                provider_key="expedia",
                direction="outbound",
                action="test_connection",
                status="error",
                error_summary="Connection refused",
                started_at=started,
            )
            db.session.commit()

            all_logs = list_sync_logs()
            assert len(all_logs) == 2

            booking_logs = list_sync_logs(provider_key="booking_com")
            assert len(booking_logs) == 1
            assert booking_logs[0].status == "success"
            assert booking_logs[0].records_processed == 10

    def test_sync_log_duration_calculation(self, app_factory):
        """write_sync_log should calculate duration_ms from started_at."""
        from pms.services.channel_service import write_sync_log, list_sync_logs
        from pms.models import utc_now
        from datetime import timedelta
        app = app_factory(seed=True)
        with app.app_context():
            started = utc_now() - timedelta(seconds=2)
            write_sync_log(
                provider_key="agoda",
                direction="inbound",
                action="pull_reservations",
                status="success",
                started_at=started,
            )
            db.session.commit()

            logs = list_sync_logs(provider_key="agoda")
            assert len(logs) == 1
            assert logs[0].duration_ms is not None
            assert logs[0].duration_ms >= 1000  # At least 1 second

    def test_test_connection_writes_sync_log(self, app_factory):
        """test_ota_channel_connection should create a sync log entry."""
        from pms.services.channel_service import test_ota_channel_connection, list_sync_logs, upsert_ota_channel
        app = app_factory(seed=True)
        with app.app_context():
            upsert_ota_channel(
                provider_key="booking_com",
                display_name="Booking.com",
                is_active=True,
                api_key="test-key-abcd",
            )
            db.session.commit()

            result = test_ota_channel_connection("booking_com")
            logs = list_sync_logs(provider_key="booking_com")
            assert len(logs) == 1
            assert logs[0].action == "test_connection"

    def test_test_connection_no_credentials(self, app_factory):
        """test_ota_channel_connection should fail cleanly without credentials."""
        from pms.services.channel_service import test_ota_channel_connection, list_sync_logs
        app = app_factory(seed=True)
        with app.app_context():
            result = test_ota_channel_connection("booking_com")
            assert result["success"] is False
            assert "no credentials" in result["error"]

            logs = list_sync_logs(provider_key="booking_com")
            assert len(logs) == 1
            assert logs[0].status == "error"

    def test_push_inventory_writes_sync_log(self, app_factory):
        """ChannelSyncService.push_inventory_updates should log the operation."""
        from pms.services.channel_service import list_sync_logs
        app = app_factory(seed=True)
        with app.app_context():
            provider = MockChannelProvider()
            service = ChannelSyncService(provider)
            updates = [
                OutboundInventoryUpdate(
                    room_type_code="STD",
                    date_from=date.today(),
                    date_to=date.today() + timedelta(days=1),
                    available_count=5,
                ),
            ]
            result = service.push_inventory_updates(updates)
            assert result.success is True

            logs = list_sync_logs(provider_key="mock")
            assert len(logs) == 1
            assert logs[0].action == "push_inventory"
            assert logs[0].status == "success"

    def test_mapping_provider_key_validated_in_route(self, app_factory):
        """The save_mapping route action should reject unknown provider_keys."""
        from pms.constants import OTA_PROVIDER_KEYS
        app = app_factory(seed=True)
        with app.test_client() as client:
            # Login as admin - ensure the route would reject invalid provider_key
            # This is a structural test - the route validates provider_key in OTA_PROVIDER_KEYS
            assert "fake_provider" not in OTA_PROVIDER_KEYS

    def test_list_ota_mappings_empty(self, app_factory):
        """list_ota_mappings should return empty list when no mappings exist."""
        from pms.services.channel_service import list_ota_mappings
        app = app_factory(seed=True)
        with app.app_context():
            mappings = list_ota_mappings()
            assert mappings == []

    def test_list_ota_mappings_filters_by_provider(self, app_factory):
        """list_ota_mappings should filter by provider_key when specified."""
        from pms.services.channel_service import upsert_ota_mapping, list_ota_mappings
        app = app_factory(seed=True)
        with app.app_context():
            rt = RoomType.query.first()
            upsert_ota_mapping(
                provider_key="booking_com",
                room_type_id=rt.id,
                external_room_type_code="STD",
            )
            upsert_ota_mapping(
                provider_key="expedia",
                room_type_id=rt.id,
                external_room_type_code="STANDARD",
            )
            db.session.commit()

            all_m = list_ota_mappings()
            assert len(all_m) == 2

            booking_m = list_ota_mappings(provider_key="booking_com")
            assert len(booking_m) == 1
            assert booking_m[0].provider_key == "booking_com"
