"""Phase 17 — Digital Pre-Check-In module tests.

Tests cover:
- Token generation and validation
- Pre-check-in save and submit flow
- Document upload validation
- Readiness state transitions
- Staff verification actions
- Reservation linkage
- Audit logging
- Unauthorized access prevention
"""

from __future__ import annotations

import io
import uuid
from datetime import date, datetime, timedelta, timezone

import pytest

from pms.models import (
    Guest,
    PreCheckIn,
    Reservation,
    ReservationDocument,
    RoomType,
    AuditLog,
    ActivityLog,
    utc_now,
)
from pms.services.pre_checkin_service import (
    DocumentVerifyPayload,
    PreCheckInSavePayload,
    generate_pre_checkin,
    get_documents_for_reservation,
    get_pre_checkin_for_reservation,
    load_pre_checkin_by_token,
    mark_opened,
    mark_rejected,
    mark_verified,
    save_pre_checkin,
    upload_document,
    validate_token_access,
    verify_document,
    build_pre_checkin_link,
)


@pytest.fixture()
def seeded_app(app_factory):
    return app_factory(seed=True)


@pytest.fixture()
def db_session(seeded_app):
    from pms.extensions import db
    with seeded_app.app_context():
        yield db.session


def _create_reservation(db_session, *, status="confirmed"):
    """Create a minimal reservation for testing."""
    from pms.extensions import db

    rt = db_session.query(RoomType).first()
    guest = Guest(
        first_name="Test",
        last_name="Guest",
        full_name="Test Guest",
        phone="+66812345678",
        email="guest@example.com",
        nationality="Thai",
    )
    db_session.add(guest)
    db_session.flush()

    reservation = Reservation(
        reservation_code=f"SBX-{uuid.uuid4().hex[:5].upper()}",
        current_status=status,
        check_in_date=date.today(),
        check_out_date=date.today() + timedelta(days=2),
        booked_at=utc_now(),
        primary_guest_id=guest.id,
        room_type_id=rt.id,
        adults=2,
        children=0,
    )
    db_session.add(reservation)
    db_session.flush()
    return reservation


class TestTokenGeneration:
    """Test pre-check-in link/token generation."""

    def test_generate_creates_pre_checkin(self, seeded_app):
        with seeded_app.app_context():
            from pms.extensions import db
            res = _create_reservation(db.session)
            pc = generate_pre_checkin(res.id)
            db.session.commit()

            assert pc.token is not None
            assert len(pc.token) > 20
            assert pc.status == "sent"
            assert pc.readiness == "awaiting_guest"
            assert pc.expires_at is not None
            assert pc.reservation_id == res.id

    def test_generate_regenerates_token(self, seeded_app):
        with seeded_app.app_context():
            from pms.extensions import db
            res = _create_reservation(db.session)
            pc1 = generate_pre_checkin(res.id)
            token1 = pc1.token
            db.session.commit()

            pc2 = generate_pre_checkin(res.id)
            db.session.commit()
            assert pc2.id == pc1.id
            assert pc2.token != token1
            assert pc2.status == "sent"

    def test_generate_fails_for_checked_in(self, seeded_app):
        with seeded_app.app_context():
            from pms.extensions import db
            res = _create_reservation(db.session, status="checked_in")
            with pytest.raises(ValueError, match="confirmed or tentative"):
                generate_pre_checkin(res.id)

    def test_generate_fails_for_nonexistent(self, seeded_app):
        with seeded_app.app_context():
            with pytest.raises(ValueError, match="not found"):
                generate_pre_checkin(uuid.uuid4())


class TestTokenValidation:
    """Test token access validation."""

    def test_valid_token_allows_access(self, seeded_app):
        with seeded_app.app_context():
            from pms.extensions import db
            res = _create_reservation(db.session)
            pc = generate_pre_checkin(res.id)
            db.session.commit()

            loaded = load_pre_checkin_by_token(pc.token)
            error = validate_token_access(loaded)
            assert error is None

    def test_invalid_token_returns_error(self, seeded_app):
        with seeded_app.app_context():
            loaded = load_pre_checkin_by_token("nonexistent-token")
            error = validate_token_access(loaded)
            assert error is not None
            assert "Invalid" in error

    def test_expired_token_returns_error(self, seeded_app):
        with seeded_app.app_context():
            from pms.extensions import db
            res = _create_reservation(db.session)
            pc = generate_pre_checkin(res.id, expiry_days=0)
            pc.expires_at = utc_now() - timedelta(hours=1)
            db.session.commit()

            loaded = load_pre_checkin_by_token(pc.token)
            error = validate_token_access(loaded)
            assert error is not None
            assert "expired" in error.lower()

    def test_verified_token_returns_error(self, seeded_app):
        with seeded_app.app_context():
            from pms.extensions import db
            res = _create_reservation(db.session)
            pc = generate_pre_checkin(res.id)
            pc.status = "verified"
            db.session.commit()

            loaded = load_pre_checkin_by_token(pc.token)
            error = validate_token_access(loaded)
            assert error is not None
            assert "no longer active" in error.lower()

    def test_empty_token_returns_none(self, seeded_app):
        with seeded_app.app_context():
            assert load_pre_checkin_by_token("") is None
            assert load_pre_checkin_by_token(None) is None


class TestMarkOpened:
    """Test the mark_opened function."""

    def test_mark_opened_updates_status(self, seeded_app):
        with seeded_app.app_context():
            from pms.extensions import db
            res = _create_reservation(db.session)
            pc = generate_pre_checkin(res.id)
            db.session.commit()

            assert pc.status == "sent"
            mark_opened(pc)
            db.session.commit()
            assert pc.status == "opened"
            assert pc.started_at is not None
            assert pc.link_opened_at is not None


class TestSavePreCheckIn:
    """Test the save and submit flow."""

    def test_save_partial_data(self, seeded_app):
        with seeded_app.app_context():
            from pms.extensions import db
            res = _create_reservation(db.session)
            pc = generate_pre_checkin(res.id)
            mark_opened(pc)
            db.session.commit()

            payload = PreCheckInSavePayload(
                primary_contact_name="John Doe",
                primary_contact_phone="+66812345678",
                eta="14:00",
            )
            save_pre_checkin(pc, payload)
            db.session.commit()

            assert pc.primary_contact_name == "John Doe"
            assert pc.primary_contact_phone == "+66812345678"
            assert pc.eta == "14:00"
            assert pc.status == "in_progress"

    def test_submit_with_required_fields(self, seeded_app):
        with seeded_app.app_context():
            from pms.extensions import db
            res = _create_reservation(db.session)
            pc = generate_pre_checkin(res.id)
            mark_opened(pc)
            db.session.commit()

            payload = PreCheckInSavePayload(
                primary_contact_name="John Doe",
                primary_contact_phone="+66812345678",
                eta="15:00",
                acknowledgment_accepted=True,
                acknowledgment_name="John Doe",
            )
            save_pre_checkin(pc, payload, submit=True)
            db.session.commit()

            assert pc.status == "submitted"
            assert pc.completed_at is not None
            assert pc.acknowledgment_accepted is True

    def test_submit_fails_without_name(self, seeded_app):
        with seeded_app.app_context():
            from pms.extensions import db
            res = _create_reservation(db.session)
            pc = generate_pre_checkin(res.id)
            mark_opened(pc)
            db.session.commit()

            payload = PreCheckInSavePayload(
                primary_contact_phone="+66812345678",
                acknowledgment_accepted=True,
            )
            with pytest.raises(ValueError, match="Full name"):
                save_pre_checkin(pc, payload, submit=True)

    def test_submit_fails_without_acknowledgment(self, seeded_app):
        with seeded_app.app_context():
            from pms.extensions import db
            res = _create_reservation(db.session)
            pc = generate_pre_checkin(res.id)
            mark_opened(pc)
            db.session.commit()

            payload = PreCheckInSavePayload(
                primary_contact_name="John Doe",
                primary_contact_phone="+66812345678",
            )
            with pytest.raises(ValueError, match="acknowledgment"):
                save_pre_checkin(pc, payload, submit=True)

    def test_occupant_details_saved(self, seeded_app):
        with seeded_app.app_context():
            from pms.extensions import db
            res = _create_reservation(db.session)
            pc = generate_pre_checkin(res.id)
            mark_opened(pc)
            db.session.commit()

            payload = PreCheckInSavePayload(
                primary_contact_name="John Doe",
                primary_contact_phone="+66812345678",
                occupant_details=[{"name": "Jane Doe"}, {"name": "Child Doe"}],
            )
            save_pre_checkin(pc, payload)
            db.session.commit()

            assert len(pc.occupant_details) == 2
            assert pc.occupant_details[0]["name"] == "Jane Doe"


class TestDocumentUpload:
    """Test document upload validation."""

    def _make_file(self, content=b"fake-image-content", filename="passport.jpg", content_type="image/jpeg"):
        from werkzeug.datastructures import FileStorage
        return FileStorage(
            stream=io.BytesIO(content),
            filename=filename,
            content_type=content_type,
        )

    def test_upload_valid_document(self, seeded_app):
        with seeded_app.app_context():
            from pms.extensions import db
            res = _create_reservation(db.session)
            pc = generate_pre_checkin(res.id)
            db.session.commit()

            file = self._make_file()
            doc = upload_document(pc, file, "passport")
            db.session.commit()

            assert doc.reservation_id == res.id
            assert doc.document_type == "passport"
            assert doc.verification_status == "pending"
            assert doc.file_size_bytes > 0
            assert doc.original_filename == "passport.jpg"

    def test_upload_rejects_invalid_type(self, seeded_app):
        with seeded_app.app_context():
            from pms.extensions import db
            res = _create_reservation(db.session)
            pc = generate_pre_checkin(res.id)
            db.session.commit()

            file = self._make_file(filename="script.exe", content_type="application/x-executable")
            with pytest.raises(ValueError, match="not allowed"):
                upload_document(pc, file, "passport")

    def test_upload_rejects_invalid_document_type(self, seeded_app):
        with seeded_app.app_context():
            from pms.extensions import db
            res = _create_reservation(db.session)
            pc = generate_pre_checkin(res.id)
            db.session.commit()

            file = self._make_file()
            with pytest.raises(ValueError, match="Invalid document type"):
                upload_document(pc, file, "birth_certificate")

    def test_upload_rejects_empty_file(self, seeded_app):
        with seeded_app.app_context():
            from pms.extensions import db
            res = _create_reservation(db.session)
            pc = generate_pre_checkin(res.id)
            db.session.commit()

            file = self._make_file(content=b"")
            with pytest.raises(ValueError, match="empty"):
                upload_document(pc, file, "passport")

    def test_upload_rejects_oversized_file(self, seeded_app):
        with seeded_app.app_context():
            from pms.extensions import db
            res = _create_reservation(db.session)
            pc = generate_pre_checkin(res.id)
            db.session.commit()

            big_content = b"x" * (11 * 1024 * 1024)
            file = self._make_file(content=big_content)
            with pytest.raises(ValueError, match="exceeds maximum"):
                upload_document(pc, file, "passport")


class TestReadinessComputation:
    """Test that readiness state is correctly computed."""

    def test_no_docs_shows_docs_missing(self, seeded_app):
        with seeded_app.app_context():
            from pms.extensions import db
            res = _create_reservation(db.session)
            pc = generate_pre_checkin(res.id)
            mark_opened(pc)
            payload = PreCheckInSavePayload(
                primary_contact_name="John",
                primary_contact_phone="+66812345678",
                acknowledgment_accepted=True,
                acknowledgment_name="John",
            )
            save_pre_checkin(pc, payload, submit=True)
            db.session.commit()
            assert pc.readiness == "docs_missing"

    def test_with_doc_and_acknowledgment_shows_id_uploaded(self, seeded_app):
        with seeded_app.app_context():
            from pms.extensions import db
            res = _create_reservation(db.session)
            pc = generate_pre_checkin(res.id)
            mark_opened(pc)
            db.session.commit()

            from werkzeug.datastructures import FileStorage
            file = FileStorage(stream=io.BytesIO(b"fake"), filename="id.jpg", content_type="image/jpeg")
            upload_document(pc, file, "passport")
            db.session.commit()

            payload = PreCheckInSavePayload(
                primary_contact_name="John",
                primary_contact_phone="+66812345678",
                acknowledgment_accepted=True,
                acknowledgment_name="John",
            )
            save_pre_checkin(pc, payload, submit=True)
            db.session.commit()
            # Doc is pending, not verified, so readiness should be id_uploaded
            assert pc.readiness == "id_uploaded"


class TestStaffVerification:
    """Test staff verify/reject actions."""

    def test_mark_verified(self, seeded_app):
        with seeded_app.app_context():
            from pms.extensions import db
            from pms.models import User
            user = db.session.query(User).first()
            res = _create_reservation(db.session)
            pc = generate_pre_checkin(res.id)
            pc.status = "submitted"
            db.session.commit()

            mark_verified(pc, actor_user_id=user.id)
            db.session.commit()
            assert pc.status == "verified"
            assert pc.readiness == "checked_at_desk"

    def test_mark_rejected(self, seeded_app):
        with seeded_app.app_context():
            from pms.extensions import db
            from pms.models import User
            user = db.session.query(User).first()
            res = _create_reservation(db.session)
            pc = generate_pre_checkin(res.id)
            pc.status = "submitted"
            db.session.commit()

            mark_rejected(pc, actor_user_id=user.id, reason="Bad ID photo")
            db.session.commit()
            assert pc.status == "rejected"


class TestDocumentVerification:
    """Test staff document verify/reject."""

    def _upload_doc(self, db_session, pc):
        from werkzeug.datastructures import FileStorage
        file = FileStorage(stream=io.BytesIO(b"fake-doc"), filename="id.png", content_type="image/png")
        return upload_document(pc, file, "national_id")

    def test_verify_document(self, seeded_app):
        with seeded_app.app_context():
            from pms.extensions import db
            from pms.models import User
            user = db.session.query(User).first()
            res = _create_reservation(db.session)
            pc = generate_pre_checkin(res.id)
            db.session.commit()

            doc = self._upload_doc(db.session, pc)
            db.session.commit()

            verify_document(
                doc.id,
                DocumentVerifyPayload(verification_status="verified"),
                actor_user_id=user.id,
            )
            db.session.commit()
            assert doc.verification_status == "verified"
            assert doc.verified_by_user_id == user.id
            assert doc.verified_at is not None

    def test_reject_document(self, seeded_app):
        with seeded_app.app_context():
            from pms.extensions import db
            from pms.models import User
            user = db.session.query(User).first()
            res = _create_reservation(db.session)
            pc = generate_pre_checkin(res.id)
            db.session.commit()

            doc = self._upload_doc(db.session, pc)
            db.session.commit()

            verify_document(
                doc.id,
                DocumentVerifyPayload(verification_status="rejected", rejection_reason="Blurry image"),
                actor_user_id=user.id,
            )
            db.session.commit()
            assert doc.verification_status == "rejected"
            assert doc.rejection_reason == "Blurry image"


class TestAuditLogging:
    """Test audit and activity logging for critical actions."""

    def test_generate_creates_audit_entry(self, seeded_app):
        with seeded_app.app_context():
            from pms.extensions import db
            from pms.models import User
            user = db.session.query(User).first()
            res = _create_reservation(db.session)
            pc = generate_pre_checkin(res.id, actor_user_id=user.id)
            db.session.commit()

            audit = db.session.query(AuditLog).filter(
                AuditLog.entity_table == "pre_checkins",
                AuditLog.action == "create",
            ).first()
            assert audit is not None
            assert audit.actor_user_id == user.id

    def test_verification_creates_audit_entry(self, seeded_app):
        with seeded_app.app_context():
            from pms.extensions import db
            from pms.models import User
            user = db.session.query(User).first()
            res = _create_reservation(db.session)
            pc = generate_pre_checkin(res.id)
            pc.status = "submitted"
            db.session.commit()

            mark_verified(pc, actor_user_id=user.id)
            db.session.commit()

            audit = db.session.query(AuditLog).filter(
                AuditLog.entity_table == "pre_checkins",
                AuditLog.action == "update",
            ).first()
            assert audit is not None

    def test_submit_creates_activity_log(self, seeded_app):
        with seeded_app.app_context():
            from pms.extensions import db
            res = _create_reservation(db.session)
            pc = generate_pre_checkin(res.id)
            mark_opened(pc)
            db.session.commit()

            payload = PreCheckInSavePayload(
                primary_contact_name="John",
                primary_contact_phone="+66812345678",
                acknowledgment_accepted=True,
                acknowledgment_name="John",
            )
            save_pre_checkin(pc, payload, submit=True)
            db.session.commit()

            activity = db.session.query(ActivityLog).filter(
                ActivityLog.event_type == "pre_checkin.submitted",
            ).first()
            assert activity is not None


class TestUnauthorizedAccess:
    """Test that different reservations can't access each other's pre-check-in."""

    def test_wrong_token_cannot_access(self, seeded_app):
        with seeded_app.app_context():
            from pms.extensions import db
            res1 = _create_reservation(db.session)
            res2 = _create_reservation(db.session)
            pc1 = generate_pre_checkin(res1.id)
            pc2 = generate_pre_checkin(res2.id)
            db.session.commit()

            loaded = load_pre_checkin_by_token(pc1.token)
            assert loaded.reservation_id == res1.id
            assert loaded.reservation_id != res2.id


class TestQueryHelpers:
    """Test query helper functions."""

    def test_get_pre_checkin_for_reservation(self, seeded_app):
        with seeded_app.app_context():
            from pms.extensions import db
            res = _create_reservation(db.session)
            pc = generate_pre_checkin(res.id)
            db.session.commit()

            found = get_pre_checkin_for_reservation(res.id)
            assert found is not None
            assert found.id == pc.id

    def test_get_pre_checkin_for_reservation_none(self, seeded_app):
        with seeded_app.app_context():
            from pms.extensions import db
            res = _create_reservation(db.session)
            db.session.commit()

            found = get_pre_checkin_for_reservation(res.id)
            assert found is None

    def test_get_documents_for_reservation(self, seeded_app):
        with seeded_app.app_context():
            from pms.extensions import db
            res = _create_reservation(db.session)
            pc = generate_pre_checkin(res.id)
            db.session.commit()

            from werkzeug.datastructures import FileStorage
            file = FileStorage(stream=io.BytesIO(b"fake"), filename="id.jpg", content_type="image/jpeg")
            upload_document(pc, file, "passport")
            db.session.commit()

            docs = get_documents_for_reservation(res.id)
            assert len(docs) == 1
            assert docs[0].document_type == "passport"

    def test_build_pre_checkin_link(self, seeded_app):
        with seeded_app.app_context():
            link = build_pre_checkin_link("test-token-123")
            assert "/pre-checkin/test-token-123" in link


class TestGuestRoutes:
    """Test guest-facing HTTP routes."""

    def test_pre_checkin_form_loads(self, seeded_app):
        with seeded_app.app_context():
            from pms.extensions import db
            res = _create_reservation(db.session)
            pc = generate_pre_checkin(res.id)
            db.session.commit()
            token = pc.token

        client = seeded_app.test_client()
        resp = client.get(f"/pre-checkin/{token}")
        assert resp.status_code == 200
        assert b"Pre-Check-In" in resp.data

    def test_pre_checkin_form_invalid_token(self, seeded_app):
        client = seeded_app.test_client()
        resp = client.get("/pre-checkin/invalid-token-abc")
        assert resp.status_code == 403

    def test_pre_checkin_save(self, seeded_app):
        with seeded_app.app_context():
            from pms.extensions import db
            res = _create_reservation(db.session)
            pc = generate_pre_checkin(res.id)
            db.session.commit()
            token = pc.token

        client = seeded_app.test_client()
        resp = client.post(f"/pre-checkin/{token}/save", data={
            "primary_contact_name": "Test Guest",
            "primary_contact_phone": "+66812345678",
            "eta": "14:30",
            "action": "save",
        })
        assert resp.status_code == 200
        assert b"Pre-Check-In" in resp.data

    def test_pre_checkin_submit(self, seeded_app):
        with seeded_app.app_context():
            from pms.extensions import db
            res = _create_reservation(db.session)
            pc = generate_pre_checkin(res.id)
            db.session.commit()
            token = pc.token

        client = seeded_app.test_client()
        resp = client.post(f"/pre-checkin/{token}/save", data={
            "primary_contact_name": "Test Guest",
            "primary_contact_phone": "+66812345678",
            "eta": "14:30",
            "acknowledgment_accepted": "on",
            "acknowledgment_name": "Test Guest",
            "action": "submit",
        })
        assert resp.status_code == 200
        assert b"Complete" in resp.data or b"complete" in resp.data

    def test_pre_checkin_upload_document(self, seeded_app):
        with seeded_app.app_context():
            from pms.extensions import db
            res = _create_reservation(db.session)
            pc = generate_pre_checkin(res.id)
            db.session.commit()
            token = pc.token

        client = seeded_app.test_client()
        data = {
            "document_type": "passport",
            "document_file": (io.BytesIO(b"fake-image-content"), "passport.jpg"),
        }
        resp = client.post(
            f"/pre-checkin/{token}/upload",
            data=data,
            content_type="multipart/form-data",
        )
        assert resp.status_code == 200


def _login_staff(client, user_id):
    """Inject staff session for tests (matching existing test patterns)."""
    with client.session_transaction() as sess:
        sess["staff_user_id"] = str(user_id)
        sess["_csrf_token"] = "test-csrf-token"


def _post_staff(client, url, **kwargs):
    """POST with CSRF token (matching existing test patterns)."""
    data = kwargs.pop("data", {})
    data["csrf_token"] = "test-csrf-token"
    return client.post(url, data=data, **kwargs)


class TestStaffRoutes:
    """Test staff-facing HTTP routes (requires authenticated staff user)."""

    def test_generate_pre_checkin_link(self, seeded_app):
        with seeded_app.app_context():
            from pms.extensions import db
            from pms.models import User
            res = _create_reservation(db.session)
            db.session.commit()
            res_id = res.id
            user = db.session.query(User).first()
            user_id = user.id

        client = seeded_app.test_client()
        _login_staff(client, user_id)
        resp = _post_staff(client, f"/staff/reservations/{res_id}/pre-checkin/generate", follow_redirects=True)
        assert resp.status_code == 200

    def test_view_pre_checkin_detail(self, seeded_app):
        with seeded_app.app_context():
            from pms.extensions import db
            from pms.models import User
            res = _create_reservation(db.session)
            pc = generate_pre_checkin(res.id)
            db.session.commit()
            res_id = res.id
            user = db.session.query(User).first()
            user_id = user.id

        client = seeded_app.test_client()
        _login_staff(client, user_id)
        resp = client.get(f"/staff/reservations/{res_id}/pre-checkin")
        assert resp.status_code == 200
        assert b"Pre-Check-In" in resp.data
