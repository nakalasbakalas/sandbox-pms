"""Pre-check-in service — manages the guest digital pre-check-in lifecycle.

Handles token generation, guest form submission, document upload,
staff verification, readiness computation, and link delivery hooks.
"""

from __future__ import annotations

import os
import re
import secrets
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from flask import current_app

from ..audit import write_audit_log
from ..activity import write_activity_log
from ..extensions import db
from ..models import (
    Guest,
    PreCheckIn,
    Reservation,
    ReservationDocument,
    utc_now,
)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

TOKEN_BYTES = 32
DEFAULT_EXPIRY_DAYS = 7
MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024  # 10 MB
ALLOWED_CONTENT_TYPES = {
    "image/jpeg",
    "image/png",
    "image/webp",
    "application/pdf",
}
ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".pdf"}

_SAFE_FILENAME_RE = re.compile(r"[^\w\s\-.]", re.ASCII)


# ---------------------------------------------------------------------------
# Payloads
# ---------------------------------------------------------------------------


@dataclass
class PreCheckInSavePayload:
    """Guest-submitted pre-check-in data (partial save or full submit)."""

    primary_contact_name: str | None = None
    primary_contact_phone: str | None = None
    primary_contact_email: str | None = None
    nationality: str | None = None
    number_of_occupants: int | None = None
    eta: str | None = None
    special_requests: str | None = None
    notes_for_staff: str | None = None
    vehicle_registration: str | None = None
    occupant_details: list[dict[str, str]] | None = None
    acknowledgment_accepted: bool = False
    acknowledgment_name: str | None = None


@dataclass
class DocumentVerifyPayload:
    """Staff action to verify or reject a document."""

    verification_status: str  # "verified" or "rejected"
    rejection_reason: str | None = None


# ---------------------------------------------------------------------------
# Token helpers
# ---------------------------------------------------------------------------


def _generate_token() -> str:
    return secrets.token_urlsafe(TOKEN_BYTES)


def _expiry_from_now(days: int | None = None) -> datetime:
    d = days if days is not None else DEFAULT_EXPIRY_DAYS
    return utc_now() + timedelta(days=d)


# ---------------------------------------------------------------------------
# File storage helpers
# ---------------------------------------------------------------------------


def _upload_dir() -> Path:
    base = current_app.config.get("UPLOAD_DIR") or os.path.join(
        current_app.instance_path, "uploads", "documents"
    )
    p = Path(base)
    p.mkdir(parents=True, exist_ok=True)
    return p


def _sanitize_filename(name: str) -> str:
    name = name.strip()
    name = _SAFE_FILENAME_RE.sub("_", name)
    return name[:200] if name else "upload"


def _validate_upload(file_storage) -> tuple[str, str, int]:
    """Validate an uploaded file and return (content_type, ext, size).

    Raises ``ValueError`` for invalid uploads.
    """
    if file_storage is None or file_storage.filename == "":
        raise ValueError("No file provided.")

    original = file_storage.filename or "upload"
    ext = os.path.splitext(original)[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise ValueError(f"File type '{ext}' is not allowed. Accepted: {', '.join(sorted(ALLOWED_EXTENSIONS))}")

    content_type = (file_storage.content_type or "").lower()
    if content_type not in ALLOWED_CONTENT_TYPES:
        raise ValueError(f"Content type '{content_type}' is not allowed.")

    # Read into memory to check size — for production, stream to storage.
    data = file_storage.read()
    size = len(data)
    file_storage.seek(0)
    if size > MAX_FILE_SIZE_BYTES:
        raise ValueError(f"File exceeds maximum allowed size of {MAX_FILE_SIZE_BYTES // (1024 * 1024)} MB.")
    if size == 0:
        raise ValueError("Uploaded file is empty.")

    return content_type, ext, size


def _save_file(file_storage, reservation_id: uuid.UUID, ext: str) -> str:
    """Persist file to local storage and return the storage key."""
    res_dir = _upload_dir() / str(reservation_id)
    res_dir.mkdir(parents=True, exist_ok=True)
    unique_name = f"{uuid.uuid4().hex}{ext}"
    dest = res_dir / unique_name
    file_storage.save(str(dest))
    return f"{reservation_id}/{unique_name}"


# ---------------------------------------------------------------------------
# Core service functions
# ---------------------------------------------------------------------------


def generate_pre_checkin(
    reservation_id: uuid.UUID,
    *,
    actor_user_id: uuid.UUID | None = None,
    expiry_days: int | None = None,
) -> PreCheckIn:
    """Create (or regenerate) a pre-check-in record with a fresh token.

    If one already exists for the reservation, a new token and expiry are set.
    """
    reservation = db.session.get(Reservation, reservation_id)
    if reservation is None:
        raise ValueError("Reservation not found.")
    if reservation.current_status not in ("confirmed", "tentative"):
        raise ValueError("Pre-check-in can only be created for confirmed or tentative reservations.")

    existing: PreCheckIn | None = (
        db.session.query(PreCheckIn)
        .filter(PreCheckIn.reservation_id == reservation_id)
        .first()
    )

    token = _generate_token()
    expires_at = _expiry_from_now(expiry_days)

    if existing is not None:
        old_data = {"token": existing.token, "status": existing.status}
        existing.token = token
        existing.expires_at = expires_at
        if existing.status in ("expired", "rejected"):
            existing.status = "sent"
            existing.readiness = "awaiting_guest"
        elif existing.status == "not_sent":
            existing.status = "sent"
        existing.link_sent_at = utc_now()
        existing.updated_by_user_id = actor_user_id
        write_audit_log(
            actor_user_id=actor_user_id,
            entity_table="pre_checkins",
            entity_id=str(existing.id),
            action="update",
            before_data=old_data,
            after_data={"token": "[redacted]", "status": existing.status},
        )
        write_activity_log(
            actor_user_id=actor_user_id,
            event_type="pre_checkin.link_regenerated",
            entity_table="pre_checkins",
            entity_id=str(existing.id),
            metadata={"reservation_id": str(reservation_id)},
        )
        db.session.flush()
        return existing

    pc = PreCheckIn(
        reservation_id=reservation_id,
        token=token,
        status="sent",
        readiness="awaiting_guest",
        expires_at=expires_at,
        link_sent_at=utc_now(),
        created_by_user_id=actor_user_id,
        updated_by_user_id=actor_user_id,
    )
    db.session.add(pc)
    db.session.flush()
    write_audit_log(
        actor_user_id=actor_user_id,
        entity_table="pre_checkins",
        entity_id=str(pc.id),
        action="create",
        after_data={"reservation_id": str(reservation_id), "status": "sent"},
    )
    write_activity_log(
        actor_user_id=actor_user_id,
        event_type="pre_checkin.created",
        entity_table="pre_checkins",
        entity_id=str(pc.id),
        metadata={"reservation_id": str(reservation_id)},
    )
    return pc


def load_pre_checkin_by_token(token: str) -> PreCheckIn | None:
    """Look up a pre-check-in by its access token. Returns None if not found."""
    if not token:
        return None
    return db.session.query(PreCheckIn).filter(PreCheckIn.token == token).first()


def validate_token_access(pc: PreCheckIn) -> str | None:
    """Return an error message if the token is not valid for guest access, else None."""
    if pc is None:
        return "Invalid or expired pre-check-in link."
    if pc.status in ("verified", "rejected", "expired"):
        return "This pre-check-in link is no longer active."
    if pc.expires_at and pc.expires_at < utc_now():
        pc.status = "expired"
        db.session.flush()
        return "This pre-check-in link has expired."
    res = pc.reservation
    if res is None or res.current_status not in ("confirmed", "tentative"):
        return "This reservation is no longer eligible for pre-check-in."
    return None


def mark_opened(pc: PreCheckIn) -> None:
    """Mark the pre-check-in as opened if not already progressed past that."""
    if pc.status in ("not_sent", "sent"):
        pc.status = "opened"
    if pc.started_at is None:
        pc.started_at = utc_now()
    if pc.link_opened_at is None:
        pc.link_opened_at = utc_now()
    db.session.flush()


def save_pre_checkin(
    pc: PreCheckIn,
    payload: PreCheckInSavePayload,
    *,
    submit: bool = False,
) -> PreCheckIn:
    """Save (partial or full) guest-submitted pre-check-in data.

    If *submit* is True the status moves to ``submitted`` and
    readiness is recomputed.
    """
    if payload.primary_contact_name is not None:
        pc.primary_contact_name = payload.primary_contact_name.strip()[:255]
    if payload.primary_contact_phone is not None:
        pc.primary_contact_phone = payload.primary_contact_phone.strip()[:60]
    if payload.primary_contact_email is not None:
        pc.primary_contact_email = payload.primary_contact_email.strip()[:255]
    if payload.nationality is not None:
        pc.nationality = payload.nationality.strip()[:80]
    if payload.number_of_occupants is not None:
        pc.number_of_occupants = max(1, payload.number_of_occupants)
    if payload.eta is not None:
        pc.eta = payload.eta.strip()[:40]
    if payload.special_requests is not None:
        pc.special_requests = payload.special_requests.strip()[:2000]
    if payload.notes_for_staff is not None:
        pc.notes_for_staff = payload.notes_for_staff.strip()[:2000]
    if payload.vehicle_registration is not None:
        pc.vehicle_registration = payload.vehicle_registration.strip()[:80]
    if payload.occupant_details is not None:
        # Sanitize — only keep name fields
        cleaned = []
        for occ in payload.occupant_details[:20]:  # cap at 20
            cleaned.append({
                "name": str(occ.get("name", "")).strip()[:255],
            })
        pc.occupant_details = cleaned

    if payload.acknowledgment_accepted:
        pc.acknowledgment_accepted = True
        pc.acknowledgment_name = (payload.acknowledgment_name or "").strip()[:255]
        pc.acknowledgment_at = utc_now()

    if pc.status in ("sent", "opened"):
        pc.status = "in_progress"

    if submit:
        _validate_submission(pc)
        pc.status = "submitted"
        pc.completed_at = utc_now()
        # Push guest data to reservation special_requests
        res = pc.reservation
        if res and pc.special_requests:
            existing = res.special_requests or ""
            prefix = "[Pre-check-in] "
            if prefix not in existing:
                res.special_requests = (existing + "\n" + prefix + pc.special_requests).strip()

    _recompute_readiness(pc)
    db.session.flush()

    write_activity_log(
        actor_user_id=None,
        event_type="pre_checkin.submitted" if submit else "pre_checkin.saved",
        entity_table="pre_checkins",
        entity_id=str(pc.id),
        metadata={"reservation_id": str(pc.reservation_id), "status": pc.status},
    )
    return pc


def _validate_submission(pc: PreCheckIn) -> None:
    """Raise ``ValueError`` if required submission fields are missing."""
    errors: list[str] = []
    if not pc.primary_contact_name:
        errors.append("Full name is required.")
    if not pc.primary_contact_phone:
        errors.append("Phone number is required.")
    if not pc.acknowledgment_accepted:
        errors.append("You must accept the registration acknowledgment.")
    if errors:
        raise ValueError(" ".join(errors))


def _recompute_readiness(pc: PreCheckIn) -> None:
    """Recompute the ``readiness`` field based on current state."""
    if pc.status == "verified":
        pc.readiness = "checked_at_desk"
        return
    if pc.status in ("not_sent", "sent", "opened"):
        pc.readiness = "awaiting_guest"
        return

    # Check documents
    docs = (
        db.session.query(ReservationDocument)
        .filter(ReservationDocument.reservation_id == pc.reservation_id)
        .all()
    )
    has_id = any(d.verification_status in ("pending", "verified") for d in docs)
    all_verified = all(d.verification_status == "verified" for d in docs) if docs else False

    if not has_id:
        pc.readiness = "docs_missing"
        return
    if not pc.acknowledgment_accepted:
        pc.readiness = "signature_missing"
        return

    # Check deposit
    res = pc.reservation
    if res and res.deposit_required_amount and res.deposit_received_amount < res.deposit_required_amount:
        pc.readiness = "payment_pending"
        return

    if pc.status == "submitted" and all_verified:
        pc.readiness = "ready_for_arrival"
        return

    pc.readiness = "id_uploaded"


# ---------------------------------------------------------------------------
# Document upload / verification
# ---------------------------------------------------------------------------


def upload_document(
    pc: PreCheckIn,
    file_storage,
    document_type: str,
) -> ReservationDocument:
    """Handle a guest document upload linked to a pre-check-in."""
    from ..constants import DOCUMENT_TYPES

    if document_type not in DOCUMENT_TYPES:
        raise ValueError(f"Invalid document type. Must be one of: {', '.join(DOCUMENT_TYPES)}")

    content_type, ext, size = _validate_upload(file_storage)
    original_filename = _sanitize_filename(file_storage.filename or "upload")
    storage_key = _save_file(file_storage, pc.reservation_id, ext)

    doc = ReservationDocument(
        reservation_id=pc.reservation_id,
        guest_id=pc.reservation.primary_guest_id if pc.reservation else None,
        document_type=document_type,
        storage_key=storage_key,
        original_filename=original_filename,
        content_type=content_type,
        file_size_bytes=size,
    )
    db.session.add(doc)
    db.session.flush()

    _recompute_readiness(pc)
    db.session.flush()

    write_activity_log(
        actor_user_id=None,
        event_type="pre_checkin.document_uploaded",
        entity_table="reservation_documents",
        entity_id=str(doc.id),
        metadata={
            "reservation_id": str(pc.reservation_id),
            "document_type": document_type,
            "original_filename": original_filename,
        },
    )
    return doc


def verify_document(
    doc_id: uuid.UUID,
    payload: DocumentVerifyPayload,
    *,
    actor_user_id: uuid.UUID,
) -> ReservationDocument:
    """Staff action to verify or reject a reservation document."""
    doc = db.session.get(ReservationDocument, doc_id)
    if doc is None:
        raise ValueError("Document not found.")
    if payload.verification_status not in ("verified", "rejected"):
        raise ValueError("Status must be 'verified' or 'rejected'.")

    old_status = doc.verification_status
    doc.verification_status = payload.verification_status
    doc.verified_by_user_id = actor_user_id
    doc.verified_at = utc_now()
    doc.updated_by_user_id = actor_user_id
    if payload.verification_status == "rejected":
        doc.rejection_reason = (payload.rejection_reason or "").strip()[:255]
    else:
        doc.rejection_reason = None

    db.session.flush()

    # Recompute readiness on linked pre-check-in
    pc = (
        db.session.query(PreCheckIn)
        .filter(PreCheckIn.reservation_id == doc.reservation_id)
        .first()
    )
    if pc:
        _recompute_readiness(pc)
        db.session.flush()

    write_audit_log(
        actor_user_id=actor_user_id,
        entity_table="reservation_documents",
        entity_id=str(doc.id),
        action="update",
        before_data={"verification_status": old_status},
        after_data={"verification_status": doc.verification_status},
    )
    write_activity_log(
        actor_user_id=actor_user_id,
        event_type=f"pre_checkin.document_{payload.verification_status}",
        entity_table="reservation_documents",
        entity_id=str(doc.id),
        metadata={
            "reservation_id": str(doc.reservation_id),
            "document_type": doc.document_type,
        },
    )
    return doc


# ---------------------------------------------------------------------------
# Staff verification
# ---------------------------------------------------------------------------


def mark_verified(
    pc: PreCheckIn,
    *,
    actor_user_id: uuid.UUID,
) -> PreCheckIn:
    """Staff marks the pre-check-in as verified (desk verification complete)."""
    old_status = pc.status
    pc.status = "verified"
    pc.readiness = "checked_at_desk"
    pc.updated_by_user_id = actor_user_id
    db.session.flush()

    write_audit_log(
        actor_user_id=actor_user_id,
        entity_table="pre_checkins",
        entity_id=str(pc.id),
        action="update",
        before_data={"status": old_status},
        after_data={"status": "verified", "readiness": "checked_at_desk"},
    )
    write_activity_log(
        actor_user_id=actor_user_id,
        event_type="pre_checkin.verified",
        entity_table="pre_checkins",
        entity_id=str(pc.id),
        metadata={"reservation_id": str(pc.reservation_id)},
    )
    return pc


def mark_rejected(
    pc: PreCheckIn,
    *,
    actor_user_id: uuid.UUID,
    reason: str | None = None,
) -> PreCheckIn:
    """Staff rejects a submitted pre-check-in (e.g. documents are not acceptable)."""
    old_status = pc.status
    pc.status = "rejected"
    pc.updated_by_user_id = actor_user_id
    _recompute_readiness(pc)
    db.session.flush()

    write_audit_log(
        actor_user_id=actor_user_id,
        entity_table="pre_checkins",
        entity_id=str(pc.id),
        action="update",
        before_data={"status": old_status},
        after_data={"status": "rejected", "reason": reason},
    )
    return pc


# ---------------------------------------------------------------------------
# Query helpers
# ---------------------------------------------------------------------------


def get_pre_checkin_for_reservation(reservation_id: uuid.UUID) -> PreCheckIn | None:
    return (
        db.session.query(PreCheckIn)
        .filter(PreCheckIn.reservation_id == reservation_id)
        .first()
    )


def get_documents_for_reservation(reservation_id: uuid.UUID) -> list[ReservationDocument]:
    return (
        db.session.query(ReservationDocument)
        .filter(ReservationDocument.reservation_id == reservation_id)
        .order_by(ReservationDocument.uploaded_at.desc())
        .all()
    )


def get_pre_checkin_context(pc: PreCheckIn) -> dict[str, Any]:
    """Build the context dict for the guest-facing pre-check-in form."""
    res = pc.reservation
    guest = res.primary_guest if res else None
    rt = res.room_type if res else None
    docs = get_documents_for_reservation(pc.reservation_id)

    return {
        "pre_checkin": pc,
        "reservation": res,
        "guest": guest,
        "room_type": rt,
        "documents": docs,
        "reservation_code": res.reservation_code if res else "",
        "check_in_date": res.check_in_date if res else None,
        "check_out_date": res.check_out_date if res else None,
        "adults": res.adults if res else 1,
        "children": res.children if res else 0,
        "room_type_name": rt.name if rt else "",
    }


def build_pre_checkin_link(token: str) -> str:
    """Build the full URL for a guest pre-check-in form."""
    base = (current_app.config.get("APP_BASE_URL") or "").rstrip("/")
    return f"{base}/pre-checkin/{token}"


def list_todays_arrivals_with_readiness(business_date) -> list[dict[str, Any]]:
    """Return today's arriving reservations augmented with pre-check-in status."""
    reservations = (
        db.session.query(Reservation)
        .filter(
            Reservation.check_in_date == business_date,
            Reservation.current_status.in_(["confirmed", "tentative"]),
        )
        .order_by(Reservation.check_in_date)
        .all()
    )
    result = []
    for res in reservations:
        pc = get_pre_checkin_for_reservation(res.id)
        docs = get_documents_for_reservation(res.id) if pc else []
        result.append({
            "reservation": res,
            "pre_checkin": pc,
            "documents": docs,
            "readiness": pc.readiness if pc else "awaiting_guest",
            "status": pc.status if pc else "not_sent",
            "has_documents": len(docs) > 0,
            "docs_verified": all(d.verification_status == "verified" for d in docs) if docs else False,
        })
    return result
