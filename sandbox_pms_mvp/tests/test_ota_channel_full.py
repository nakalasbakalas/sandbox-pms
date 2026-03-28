"""Comprehensive OTA channel manager tests — inbound import, webhook, sync, outbound push."""

from __future__ import annotations

import hashlib
import hmac
import json
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import pytest

from pms.extensions import db
from pms.models import (
    ChannelSyncLog,
    OtaChannel,
    Reservation,
    RoomType,
)
from pms.services.channel_service import (
    ChannelSyncService,
    InboundReservation,
    MockChannelProvider,
    OutboundInventoryUpdate,
    SyncResult,
    build_outbound_inventory_updates,
    channel_sync_summary,
    get_provider,
    list_channel_sync_logs,
    log_sync_operation,
    sync_all_active_channels,
    trigger_outbound_push_for_change,
)
from pms.services.reservation_service import (
    ReservationCreatePayload,
    create_reservation,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _first_room_type(app):
    """Return the first active room type from seeded data."""
    with app.app_context():
        return RoomType.query.filter_by(is_active=True).first()


def _make_inbound(
    *,
    external_booking_id="EXT-001",
    external_source="booking_com",
    room_type_code="STD",
    check_in=None,
    check_out=None,
    is_cancellation=False,
    total_amount=None,
    guest_name="John Smith",
    guest_email="john@example.com",
    guest_phone="0800000099",
) -> InboundReservation:
    today = date.today()
    return InboundReservation(
        external_booking_id=external_booking_id,
        external_source=external_source,
        guest_name=guest_name,
        guest_email=guest_email,
        guest_phone=guest_phone,
        room_type_code=room_type_code,
        check_in=check_in or today + timedelta(days=7),
        check_out=check_out or today + timedelta(days=10),
        adults=2,
        children=0,
        total_amount=total_amount,
        currency="THB",
        raw_payload={"test": True},
        is_cancellation=is_cancellation,
    )


# ---------------------------------------------------------------------------
# Inbound import tests
# ---------------------------------------------------------------------------


class TestInboundImport:
    """Tests for OTA reservation import via ChannelSyncService._import_single."""

    def test_import_creates_reservation(self, app_factory):
        """Importing an inbound reservation creates a real Reservation record."""
        app = app_factory(seed=True)
        with app.app_context():
            rt = RoomType.query.filter_by(is_active=True).first()
            provider = MockChannelProvider()
            service = ChannelSyncService(provider)

            data = _make_inbound(room_type_code=rt.code)
            service._import_single(data, actor_user_id=None)

            res = Reservation.query.filter_by(external_booking_id="EXT-001").first()
            assert res is not None
            assert res.external_source == "booking_com"
            assert res.source_channel == "ota_mock"
            assert res.current_status == "confirmed"
            assert res.source_metadata_json == {"test": True}

    def test_import_is_idempotent(self, app_factory):
        """Importing the same external_booking_id twice does not create a duplicate."""
        app = app_factory(seed=True)
        with app.app_context():
            rt = RoomType.query.filter_by(is_active=True).first()
            provider = MockChannelProvider()
            service = ChannelSyncService(provider)

            data = _make_inbound(room_type_code=rt.code)
            service._import_single(data, actor_user_id=None)
            service._import_single(data, actor_user_id=None)

            count = Reservation.query.filter_by(external_booking_id="EXT-001").count()
            assert count == 1

    def test_import_cancellation_cancels_existing(self, app_factory):
        """Importing a cancellation transitions the reservation to cancelled."""
        app = app_factory(seed=True)
        with app.app_context():
            rt = RoomType.query.filter_by(is_active=True).first()
            provider = MockChannelProvider()
            service = ChannelSyncService(provider)

            # Create the reservation first
            data = _make_inbound(room_type_code=rt.code)
            service._import_single(data, actor_user_id=None)

            # Now cancel it
            cancel_data = _make_inbound(room_type_code=rt.code, is_cancellation=True)
            service._import_single(cancel_data, actor_user_id=None)

            res = Reservation.query.filter_by(external_booking_id="EXT-001").first()
            assert res.current_status == "cancelled"

    def test_import_cancellation_for_unknown_booking_is_noop(self, app_factory):
        """Cancellation for a booking that doesn't exist silently succeeds."""
        app = app_factory(seed=True)
        with app.app_context():
            provider = MockChannelProvider()
            service = ChannelSyncService(provider)

            data = _make_inbound(
                external_booking_id="NONEXIST",
                is_cancellation=True,
            )
            # Should not raise
            service._import_single(data, actor_user_id=None)

    def test_import_modification_updates_dates(self, app_factory):
        """Re-importing with different dates updates the reservation."""
        app = app_factory(seed=True)
        with app.app_context():
            rt = RoomType.query.filter_by(is_active=True).first()
            provider = MockChannelProvider()
            service = ChannelSyncService(provider)

            today = date.today()
            data = _make_inbound(
                room_type_code=rt.code,
                check_in=today + timedelta(days=7),
                check_out=today + timedelta(days=10),
            )
            service._import_single(data, actor_user_id=None)

            # Modify dates
            modified = _make_inbound(
                room_type_code=rt.code,
                check_in=today + timedelta(days=8),
                check_out=today + timedelta(days=12),
            )
            service._import_single(modified, actor_user_id=None)

            res = Reservation.query.filter_by(external_booking_id="EXT-001").first()
            assert res.check_in_date == today + timedelta(days=8)
            assert res.check_out_date == today + timedelta(days=12)

    def test_import_modification_updates_total(self, app_factory):
        """Re-importing with a different total_amount updates the reservation."""
        app = app_factory(seed=True)
        with app.app_context():
            rt = RoomType.query.filter_by(is_active=True).first()
            provider = MockChannelProvider()
            service = ChannelSyncService(provider)

            data = _make_inbound(room_type_code=rt.code, total_amount=Decimal("5000.00"))
            service._import_single(data, actor_user_id=None)

            modified = _make_inbound(room_type_code=rt.code, total_amount=Decimal("7500.00"))
            service._import_single(modified, actor_user_id=None)

            res = Reservation.query.filter_by(external_booking_id="EXT-001").first()
            assert res.quoted_grand_total == Decimal("7500.00")

    def test_import_unknown_room_type_raises(self, app_factory):
        """Importing with an unknown room type code raises ValueError."""
        app = app_factory(seed=True)
        with app.app_context():
            provider = MockChannelProvider()
            service = ChannelSyncService(provider)

            data = _make_inbound(room_type_code="NONEXIST_ROOM_TYPE_XYZ")
            with pytest.raises(ValueError, match="Unknown room type"):
                service._import_single(data, actor_user_id=None)


# ---------------------------------------------------------------------------
# Sync service tests
# ---------------------------------------------------------------------------


class TestSyncService:
    """Tests for sync_all_active_channels and log_sync_operation."""

    def test_sync_all_skips_inactive_channels(self, app_factory):
        """sync_all_active_channels does not process inactive channels."""
        app = app_factory(seed=True)
        with app.app_context():
            ch = OtaChannel(
                provider_key="booking_com",
                display_name="Booking.com",
                is_active=False,
            )
            db.session.add(ch)
            db.session.commit()

            result = sync_all_active_channels()
            assert "booking_com" not in result

    def test_sync_all_processes_active_channels(self, app_factory):
        """sync_all_active_channels processes active channels."""
        app = app_factory(seed=True)
        with app.app_context():
            ch = OtaChannel(
                provider_key="booking_com",
                display_name="Booking.com",
                is_active=True,
            )
            db.session.add(ch)
            db.session.commit()

            result = sync_all_active_channels()
            # booking_com provider has no endpoint configured so outbound will fail,
            # but inbound (pull_reservations returns []) should succeed.
            assert "booking_com" in result
            assert result["booking_com"]["inbound"]["success"] is True

    def test_log_sync_operation_writes_record(self, app_factory):
        """log_sync_operation creates a ChannelSyncLog entry."""
        app = app_factory(seed=True)
        with app.app_context():
            sr = SyncResult(
                provider="mock",
                direction="inbound",
                success=True,
                records_processed=5,
            )
            from pms.models import utc_now
            log_sync_operation(
                provider_key="mock",
                direction="inbound",
                result=sr,
                started_at=utc_now(),
            )

            logs = list_channel_sync_logs("mock")
            assert len(logs) >= 1
            assert logs[0].provider_key == "mock"
            assert logs[0].records_processed == 5
            assert logs[0].status == "success"

    def test_log_sync_operation_records_failures(self, app_factory):
        """log_sync_operation sets status=failed when errors present."""
        app = app_factory(seed=True)
        with app.app_context():
            sr = SyncResult(
                provider="mock",
                direction="outbound",
                success=False,
                records_processed=0,
                errors=["Connection refused"],
            )
            from pms.models import utc_now
            log_sync_operation(
                provider_key="mock",
                direction="outbound",
                result=sr,
                started_at=utc_now(),
            )

            logs = list_channel_sync_logs("mock")
            failed_logs = [l for l in logs if l.status == "failed"]
            assert len(failed_logs) >= 1
            assert "Connection refused" in failed_logs[0].error_summary

    def test_channel_sync_summary(self, app_factory):
        """channel_sync_summary returns per-provider summary."""
        app = app_factory(seed=True)
        with app.app_context():
            from pms.models import utc_now
            sr = SyncResult(provider="mock", direction="inbound", success=True, records_processed=3)
            log_sync_operation(
                provider_key="mock", direction="inbound", result=sr, started_at=utc_now(),
            )
            summary = channel_sync_summary()
            assert "mock" in summary
            assert summary["mock"]["total_processed"] >= 3


# ---------------------------------------------------------------------------
# Outbound push tests
# ---------------------------------------------------------------------------


class TestOutboundPush:
    """Tests for outbound inventory push triggering."""

    def test_trigger_outbound_push_no_active_channels(self, app_factory):
        """trigger_outbound_push_for_change is a no-op when no channels are active."""
        app = app_factory(seed=True)
        with app.app_context():
            # Should not raise
            trigger_outbound_push_for_change()

    def test_outbound_push_after_reservation_create(self, app_factory, monkeypatch):
        """Creating a reservation triggers outbound push (best-effort)."""
        app = app_factory(seed=True)
        push_calls = []

        def fake_push(self_prov, updates):
            push_calls.append(len(updates))
            return SyncResult(provider="mock", direction="outbound", success=True, records_processed=len(updates))

        with app.app_context():
            ch = OtaChannel(provider_key="booking_com", display_name="Booking.com", is_active=True)
            db.session.add(ch)
            db.session.commit()

            # Monkeypatch the push method on BookingComChannelProvider
            from pms.services.channel_service import BookingComChannelProvider
            monkeypatch.setattr(BookingComChannelProvider, "push_inventory", fake_push)

            rt = RoomType.query.filter_by(is_active=True).first()
            create_reservation(
                ReservationCreatePayload(
                    room_type_id=rt.id,
                    check_in_date=date.today() + timedelta(days=5),
                    check_out_date=date.today() + timedelta(days=7),
                    first_name="Push",
                    last_name="Test",
                    email="push@test.com",
                    phone="0800000055",
                    adults=1,
                    children=0,
                ),
                actor_user_id=None,
            )

        assert len(push_calls) >= 1

    def test_build_outbound_inventory_updates_reflects_booking(self, app_factory):
        """After a booking, build_outbound_inventory_updates shows reduced availability."""
        app = app_factory(seed=True)
        with app.app_context():
            rt = RoomType.query.filter_by(is_active=True).first()
            today = date.today()
            tomorrow = today + timedelta(days=1)

            before_updates = build_outbound_inventory_updates(
                date_from=today, date_to=today, room_type_id=rt.id,
            )
            before_counts = {u.date_from: u.available_count for u in before_updates}

            create_reservation(
                ReservationCreatePayload(
                    room_type_id=rt.id,
                    check_in_date=today,
                    check_out_date=tomorrow,
                    first_name="Avail",
                    last_name="Check",
                    email="avail@check.com",
                    phone="0800000066",
                    adults=1,
                    children=0,
                ),
                actor_user_id=None,
            )

            after_updates = build_outbound_inventory_updates(
                date_from=today, date_to=today, room_type_id=rt.id,
            )
            after_counts = {u.date_from: u.available_count for u in after_updates}

            for d in before_counts:
                if d in after_counts:
                    assert after_counts[d] < before_counts[d]


# ---------------------------------------------------------------------------
# Webhook endpoint tests
# ---------------------------------------------------------------------------


class TestChannelWebhook:
    """Tests for the /api/channel/inbound webhook endpoint."""

    def _sign(self, body: bytes, secret: str) -> str:
        return hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()

    def test_webhook_rejects_missing_secret_config(self, app_factory):
        """Webhook returns 503 if CHANNEL_WEBHOOK_SECRET is not configured."""
        app = app_factory(seed=True, config={"CHANNEL_WEBHOOK_SECRET": ""})
        with app.test_client() as client:
            resp = client.post(
                "/api/channel/inbound",
                data=b"{}",
                content_type="application/json",
            )
            assert resp.status_code == 503

    def test_webhook_rejects_invalid_signature(self, app_factory):
        """Webhook returns 401 for invalid HMAC signature."""
        app = app_factory(seed=True, config={"CHANNEL_WEBHOOK_SECRET": "test-secret"})
        with app.test_client() as client:
            resp = client.post(
                "/api/channel/inbound",
                data=b'{"provider": "mock"}',
                content_type="application/json",
                headers={"X-Channel-Signature": "invalid-signature"},
            )
            assert resp.status_code == 401

    def test_webhook_processes_valid_payload(self, app_factory):
        """Webhook accepts a properly signed payload and imports reservations."""
        secret = "test-webhook-secret"
        app = app_factory(seed=True, config={"CHANNEL_WEBHOOK_SECRET": secret})
        with app.app_context():
            rt = RoomType.query.filter_by(is_active=True).first()
            today = date.today()

            payload = json.dumps({
                "provider": "mock",
                "reservations": [
                    {
                        "external_booking_id": "WH-001",
                        "guest_name": "Webhook Guest",
                        "guest_email": "wh@test.com",
                        "guest_phone": "0800000077",
                        "room_type_code": rt.code,
                        "check_in": (today + timedelta(days=5)).isoformat(),
                        "check_out": (today + timedelta(days=8)).isoformat(),
                        "adults": 2,
                        "children": 0,
                        "total_amount": "9000.00",
                        "is_cancellation": False,
                    }
                ],
            }).encode()
            signature = self._sign(payload, secret)

            with app.test_client() as client:
                resp = client.post(
                    "/api/channel/inbound",
                    data=payload,
                    content_type="application/json",
                    headers={"X-Channel-Signature": signature},
                )
                assert resp.status_code == 200
                data = resp.get_json()
                assert data["success"] is True
                assert data["processed"] == 1

            # Verify reservation was created
            res = Reservation.query.filter_by(external_booking_id="WH-001").first()
            assert res is not None
            assert res.external_source == "mock"

    def test_webhook_rejects_unknown_provider(self, app_factory):
        """Webhook returns 400 for unknown provider."""
        secret = "test-webhook-secret"
        app = app_factory(seed=True, config={"CHANNEL_WEBHOOK_SECRET": secret})
        with app.app_context():
            payload = json.dumps({
                "provider": "nonexistent_provider",
                "reservations": [],
            }).encode()
            signature = self._sign(payload, secret)

            with app.test_client() as client:
                resp = client.post(
                    "/api/channel/inbound",
                    data=payload,
                    content_type="application/json",
                    headers={"X-Channel-Signature": signature},
                )
                assert resp.status_code == 400

    def test_webhook_handles_cancellation(self, app_factory):
        """Webhook can process a cancellation for an existing reservation."""
        secret = "test-webhook-secret"
        app = app_factory(seed=True, config={"CHANNEL_WEBHOOK_SECRET": secret})
        with app.app_context():
            rt = RoomType.query.filter_by(is_active=True).first()
            today = date.today()

            # First create via webhook
            create_payload = json.dumps({
                "provider": "mock",
                "reservations": [{
                    "external_booking_id": "WH-CANCEL-001",
                    "guest_name": "Cancel Test",
                    "guest_phone": "0800000088",
                    "room_type_code": rt.code,
                    "check_in": (today + timedelta(days=10)).isoformat(),
                    "check_out": (today + timedelta(days=12)).isoformat(),
                    "adults": 1,
                    "is_cancellation": False,
                }],
            }).encode()
            sig = self._sign(create_payload, secret)

            with app.test_client() as client:
                resp = client.post(
                    "/api/channel/inbound",
                    data=create_payload,
                    content_type="application/json",
                    headers={"X-Channel-Signature": sig},
                )
                assert resp.status_code == 200

            # Now cancel via webhook
            cancel_payload = json.dumps({
                "provider": "mock",
                "reservations": [{
                    "external_booking_id": "WH-CANCEL-001",
                    "is_cancellation": True,
                }],
            }).encode()
            sig = self._sign(cancel_payload, secret)

            with app.test_client() as client:
                resp = client.post(
                    "/api/channel/inbound",
                    data=cancel_payload,
                    content_type="application/json",
                    headers={"X-Channel-Signature": sig},
                )
                assert resp.status_code == 200

            res = Reservation.query.filter_by(external_booking_id="WH-CANCEL-001").first()
            assert res.current_status == "cancelled"

    def test_webhook_creates_sync_log(self, app_factory):
        """Webhook creates a ChannelSyncLog entry."""
        secret = "test-webhook-secret"
        app = app_factory(seed=True, config={"CHANNEL_WEBHOOK_SECRET": secret})
        with app.app_context():
            payload = json.dumps({
                "provider": "mock",
                "reservations": [],
            }).encode()
            sig = self._sign(payload, secret)

            with app.test_client() as client:
                client.post(
                    "/api/channel/inbound",
                    data=payload,
                    content_type="application/json",
                    headers={"X-Channel-Signature": sig},
                )

            logs = ChannelSyncLog.query.filter_by(provider_key="mock").all()
            assert len(logs) >= 1
