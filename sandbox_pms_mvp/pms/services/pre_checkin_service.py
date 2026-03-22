"""Pre-check-in service — manages the guest digital pre-check-in lifecycle.

Handles token generation, guest form submission, document upload,
staff verification, readiness computation, and link delivery hooks.
"""

from __future__ import annotations

import json
import re
import secrets
import uuid
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from io import BytesIO
from typing import Any

from flask import current_app
from werkzeug.datastructures import FileStorage

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
from .storage import StorageBackend, get_storage_backend  # noqa: F401 re-exported

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


@dataclass
class ScannerCapturePayload:
    """Structured document capture received from a scanner workstation."""

    document_type: str
    raw_text: str | None = None
    raw_payload: dict[str, Any] | None = None
    filename: str | None = None
    content_type: str | None = None
    scanner_name: str | None = None
    source: str | None = None


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


def _sanitize_filename(name: str) -> str:
    name = name.strip()
    name = _SAFE_FILENAME_RE.sub("_", name)
    return name[:200] if name else "upload"


def _validate_upload(file_storage) -> tuple[str, str, int]:
    """Validate an uploaded file and return (content_type, ext, size).

    Raises ``ValueError`` for invalid uploads.
    """
    import os

    if file_storage is None or file_storage.filename == "":
        raise ValueError("No file provided.")

    original = file_storage.filename or "upload"
    ext = os.path.splitext(original)[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise ValueError(f"File type '{ext}' is not allowed. Accepted: {', '.join(sorted(ALLOWED_EXTENSIONS))}")

    content_type = (file_storage.content_type or "").lower()
    if content_type not in ALLOWED_CONTENT_TYPES:
        raise ValueError(f"Content type '{content_type}' is not allowed.")

    # Read into memory to check size; storage backend may stream differently.
    data = file_storage.read()
    size = len(data)
    file_storage.seek(0)
    if size > MAX_FILE_SIZE_BYTES:
        raise ValueError(f"File exceeds maximum allowed size of {MAX_FILE_SIZE_BYTES // (1024 * 1024)} MB.")
    if size == 0:
        raise ValueError("Uploaded file is empty.")

    return content_type, ext, size


def read_document_bytes(doc: ReservationDocument) -> bytes:
    """Read and return the raw bytes for a stored document.

    Delegates to the configured ``StorageBackend``; raises ``FileNotFoundError``
    if the object does not exist.
    """
    return get_storage_backend().read(doc.storage_key)


def get_document_serve_url(
    doc: ReservationDocument, expires_in: int = 3600
) -> str | None:
    """Return a pre-signed URL for the document, or *None* to serve directly.

    For ``LocalStorageBackend`` this always returns *None* (the caller reads
    bytes via ``read_document_bytes``).  For ``S3StorageBackend`` a time-limited
    presigned URL is returned so the browser fetches the file directly from S3.
    """
    return get_storage_backend().generate_url(
        doc.storage_key, doc.original_filename, doc.content_type, expires_in=expires_in
    )


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
    if pc.expires_at:
        expires = pc.expires_at
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)
        if expires < utc_now():
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
    if res and res.deposit_required_amount and (res.deposit_received_amount or 0) < res.deposit_required_amount:
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
    storage_key = get_storage_backend().save(file_storage, pc.reservation_id, ext)

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


def send_pre_checkin_link_email(
    pc: PreCheckIn,
    *,
    actor_user_id: uuid.UUID | None = None,
) -> None:
    """Send the pre-check-in link to the guest email via the messaging service.

    Uses the unified messaging hub (send_message). Silently skips if the
    guest has no email address.  Logs the event regardless.
    """
    from .messaging_service import ComposePayload, send_message  # local import avoids circular dep

    res = pc.reservation
    guest = res.primary_guest if res else None
    recipient_email = (
        pc.primary_contact_email
        or (guest.email if guest else None)
    )

    link = build_pre_checkin_link(pc.token)
    hotel_name = current_app.config.get("HOTEL_NAME", "the hotel")
    res_code = res.reservation_code if res else ""
    check_in = res.check_in_date.strftime("%d %b %Y") if res else ""

    subject = f"Complete your online pre-check-in — {res_code}"
    body = (
        f"Dear guest,\n\n"
        f"Please complete your pre-check-in for reservation {res_code} (check-in: {check_in}) "
        f"using the link below. This will help speed up your arrival at {hotel_name}.\n\n"
        f"{link}\n\n"
        f"The link expires in 7 days. If you have any questions, reply to this message.\n\n"
        f"Best regards,\n{hotel_name}"
    )

    if recipient_email:
        payload = ComposePayload(
            reservation_id=str(res.id) if res else None,
            guest_id=str(guest.id) if guest else None,
            channel="email",
            subject=subject,
            body_text=body,
            recipient_address=recipient_email,
        )
        send_message(payload, actor_user_id=str(actor_user_id) if actor_user_id else None, commit=False)

    write_activity_log(
        actor_user_id=actor_user_id,
        event_type="pre_checkin.link_emailed",
        entity_table="pre_checkins",
        entity_id=str(pc.id),
        metadata={
            "reservation_id": str(pc.reservation_id),
            "recipient": recipient_email or "none",
        },
    )


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


# ---------------------------------------------------------------------------
# Pre-check-in reminder automation events
# ---------------------------------------------------------------------------

#: Statuses that indicate the guest has NOT completed pre-check-in.
_INCOMPLETE_STATUSES = frozenset({"not_sent", "sent", "opened", "in_progress"})


def fire_pre_checkin_not_completed_events(hours_before: int = 48) -> dict[str, int]:
    """Fire ``pre_checkin_not_completed`` automation events for upcoming arrivals.

    Targets reservations whose check-in date falls *hours_before* hours from now
    that have no pre-check-in or an incomplete one (status not yet
    ``submitted``/``verified``/``rejected``).

    Called by the CLI command ``flask fire-pre-checkin-reminders`` or by
    ``send_due_pre_arrival_reminders`` in *communication_service.py*.

    Returns a summary ``{"fired": N, "skipped": N}`` dict.
    """
    from datetime import date

    from .messaging_service import fire_automation_event  # local to avoid circular

    target_date = (utc_now() + timedelta(hours=hours_before)).date()
    reservations = (
        db.session.query(Reservation)
        .filter(
            Reservation.check_in_date == target_date,
            Reservation.current_status.in_(["confirmed", "tentative"]),
        )
        .all()
    )

    fired = 0
    skipped = 0
    for res in reservations:
        pc = get_pre_checkin_for_reservation(res.id)
        if pc is not None and pc.status not in _INCOMPLETE_STATUSES:
            skipped += 1
            continue

        guest = res.primary_guest
        try:
            fire_automation_event(
                "pre_checkin_not_completed",
                reservation_id=str(res.id),
                guest_id=str(guest.id) if guest else None,
                context={
                    "reservation_code": res.reservation_code,
                    "guest_name": guest.full_name if guest else "",
                    "check_in_date": str(res.check_in_date),
                    "pre_checkin_status": pc.status if pc else "not_sent",
                    "pre_checkin_link": build_pre_checkin_link(pc.token) if pc else "",
                },
            )
            fired += 1
        except Exception:  # noqa: BLE001
            skipped += 1

    return {"fired": fired, "skipped": skipped}


# ---------------------------------------------------------------------------
# OCR / ID extraction and structured scanner capture
# ---------------------------------------------------------------------------


def ingest_scanner_capture(
    reservation_id: uuid.UUID,
    payload: ScannerCapturePayload,
    *,
    actor_user_id: uuid.UUID | None,
    commit: bool = True,
) -> ReservationDocument:
    from ..constants import DOCUMENT_TYPES

    reservation = db.session.get(Reservation, reservation_id)
    if reservation is None:
        raise ValueError("Reservation not found.")
    if payload.document_type not in DOCUMENT_TYPES:
        raise ValueError(f"Invalid document type. Must be one of: {', '.join(DOCUMENT_TYPES)}")

    raw_text = _scanner_capture_text(payload)
    if not raw_text.strip():
        raise ValueError("Scanner payload is empty.")

    content_type = _scanner_capture_content_type(payload)
    encoded = raw_text.encode("utf-8")
    storage_key = get_storage_backend().save(
        FileStorage(
            stream=BytesIO(encoded),
            filename=_scanner_capture_filename(payload, content_type),
            content_type=content_type,
        ),
        reservation.id,
        _scanner_capture_extension(content_type),
    )

    document = ReservationDocument(
        reservation_id=reservation.id,
        guest_id=reservation.primary_guest_id,
        document_type=payload.document_type,
        storage_key=storage_key,
        original_filename=_scanner_capture_filename(payload, content_type),
        content_type=content_type,
        file_size_bytes=len(encoded),
        created_by_user_id=actor_user_id,
        updated_by_user_id=actor_user_id,
    )
    db.session.add(document)
    db.session.flush()

    extraction = suggest_ocr_extraction(document.id) or {}
    if extraction:
        document.ocr_extracted_data = {
            **extraction,
            "scanner_name": (payload.scanner_name or "").strip()[:120] or None,
            "source": (payload.source or "scanner_capture").strip()[:80],
        }

    pc = get_pre_checkin_for_reservation(reservation.id)
    if pc is not None:
        _recompute_readiness(pc)

    write_audit_log(
        actor_user_id=actor_user_id,
        entity_table="reservation_documents",
        entity_id=str(document.id),
        action="create",
        after_data={
            "reservation_id": str(reservation.id),
            "document_type": payload.document_type,
            "content_type": content_type,
            "scanner_name": payload.scanner_name,
            "source": payload.source or "scanner_capture",
        },
    )
    write_activity_log(
        actor_user_id=actor_user_id,
        event_type="pre_checkin.scanner_capture_ingested",
        entity_table="reservation_documents",
        entity_id=str(document.id),
        metadata={
            "reservation_id": str(reservation.id),
            "document_type": payload.document_type,
            "scanner_name": payload.scanner_name,
            "source": payload.source or "scanner_capture",
        },
    )
    if commit:
        db.session.commit()
    return document


def apply_document_ocr_to_guest(
    doc_id: uuid.UUID,
    *,
    actor_user_id: uuid.UUID,
    commit: bool = True,
) -> ReservationDocument:
    document = db.session.get(ReservationDocument, doc_id)
    if document is None:
        raise ValueError("Document not found.")
    reservation = db.session.get(Reservation, document.reservation_id)
    if reservation is None or reservation.primary_guest is None:
        raise ValueError("Primary guest not found for this reservation.")

    extracted = document.ocr_extracted_data or {}
    if extracted.get("status") != "parsed":
        raise ValueError("This document does not contain parsed scanner or OCR data yet.")

    guest = reservation.primary_guest
    before_data = {
        "first_name": guest.first_name,
        "last_name": guest.last_name,
        "nationality": guest.nationality,
        "id_document_type": guest.id_document_type,
        "id_document_number": guest.id_document_number,
        "date_of_birth": guest.date_of_birth.isoformat() if guest.date_of_birth else None,
    }

    first_name = (_clean_text(extracted.get("first_name")) or "").strip()
    last_name = (_clean_text(extracted.get("last_name")) or "").strip()
    if not first_name and not last_name:
        first_name, last_name = _split_full_name(extracted.get("full_name"))
    if first_name:
        guest.first_name = first_name[:120]
    if last_name:
        guest.last_name = last_name[:120]
    if first_name or last_name:
        guest.full_name = f"{guest.first_name} {guest.last_name}".strip()

    nationality = _clean_text(extracted.get("nationality"))
    document_number = _clean_text(extracted.get("document_number"))
    document_type = _clean_text(extracted.get("document_type")) or document.document_type
    date_of_birth = _parse_date_string(extracted.get("date_of_birth"))
    if nationality:
        guest.nationality = nationality[:80]
    if document_number:
        guest.id_document_number = document_number[:120]
    if document_type:
        guest.id_document_type = document_type[:80]
    if date_of_birth:
        guest.date_of_birth = date_of_birth

    guest.updated_by_user_id = actor_user_id
    document.guest_id = guest.id
    document.updated_by_user_id = actor_user_id
    db.session.flush()

    write_audit_log(
        actor_user_id=actor_user_id,
        entity_table="guests",
        entity_id=str(guest.id),
        action="update",
        before_data=before_data,
        after_data={
            "first_name": guest.first_name,
            "last_name": guest.last_name,
            "nationality": guest.nationality,
            "id_document_type": guest.id_document_type,
            "id_document_number": guest.id_document_number,
            "date_of_birth": guest.date_of_birth.isoformat() if guest.date_of_birth else None,
            "source_document_id": str(document.id),
        },
    )
    write_activity_log(
        actor_user_id=actor_user_id,
        event_type="guest.document_data_applied",
        entity_table="guests",
        entity_id=str(guest.id),
        metadata={
            "reservation_id": str(reservation.id),
            "document_id": str(document.id),
            "document_type": document.document_type,
        },
    )
    if commit:
        db.session.commit()
    return document


def suggest_ocr_extraction(doc_id: uuid.UUID) -> dict[str, Any] | None:
    doc = db.session.get(ReservationDocument, doc_id)
    if doc is None:
        raise ValueError("Document not found.")
    if _is_text_scanner_document(doc):
        extracted = _extract_document_fields(
            read_document_bytes(doc).decode("utf-8", errors="ignore"),
            document_type=doc.document_type,
        )
        if extracted:
            doc.ocr_extracted_data = extracted
            db.session.flush()
            return extracted
        result = {"status": "unavailable", "reason": "Structured scanner text could not be parsed."}
        doc.ocr_extracted_data = result
        db.session.flush()
        return result
    result = {"status": "unavailable", "reason": "OCR provider not configured for image-based documents."}
    doc.ocr_extracted_data = result
    db.session.flush()
    return result


def _is_text_scanner_document(doc: ReservationDocument) -> bool:
    content_type = (doc.content_type or "").lower()
    return (
        content_type.startswith("text/")
        or content_type == "application/json"
        or doc.original_filename.lower().endswith((".txt", ".json", ".mrz"))
    )


def _scanner_capture_text(payload: ScannerCapturePayload) -> str:
    if payload.raw_text and payload.raw_text.strip():
        return payload.raw_text
    if payload.raw_payload:
        return json.dumps(payload.raw_payload, ensure_ascii=False, indent=2)
    return ""


def _scanner_capture_content_type(payload: ScannerCapturePayload) -> str:
    if payload.content_type:
        return payload.content_type.strip().lower()
    return "application/json" if payload.raw_payload else "text/plain"


def _scanner_capture_filename(payload: ScannerCapturePayload, content_type: str) -> str:
    if payload.filename:
        return _sanitize_filename(payload.filename)
    return f"scanner-capture{_scanner_capture_extension(content_type)}"


def _scanner_capture_extension(content_type: str) -> str:
    normalized = (content_type or "").lower()
    if "json" in normalized:
        return ".json"
    if "pdf" in normalized:
        return ".pdf"
    if "png" in normalized:
        return ".png"
    if "jpeg" in normalized or "jpg" in normalized:
        return ".jpg"
    if "webp" in normalized:
        return ".webp"
    if normalized.startswith("text/"):
        return ".txt"
    return ".bin"


def _extract_document_fields(text: str, *, document_type: str | None) -> dict[str, Any] | None:
    for candidate in (
        _extract_from_json_text(text),
        _extract_from_key_value_text(text),
        _extract_from_mrz(text),
    ):
        normalized = _normalize_extracted_fields(candidate, document_type=document_type)
        if normalized:
            return normalized
    return None


def _extract_from_json_text(text: str) -> dict[str, Any] | None:
    stripped = text.strip()
    if not stripped.startswith("{"):
        return None
    try:
        payload = json.loads(stripped)
    except json.JSONDecodeError:
        return None
    return payload if isinstance(payload, dict) else None


def _extract_from_key_value_text(text: str) -> dict[str, Any] | None:
    data: dict[str, str] = {}
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        separator = ":" if ":" in line else "=" if "=" in line else None
        if not separator:
            continue
        key, value = line.split(separator, 1)
        normalized_key = re.sub(r"[^a-z0-9]+", "_", key.strip().lower()).strip("_")
        cleaned_value = value.strip()
        if normalized_key and cleaned_value:
            data[normalized_key] = cleaned_value
    return data or None


def _extract_from_mrz(text: str) -> dict[str, Any] | None:
    # Try the pluggable scanner adapter first (if configured).
    try:
        from .id_scanner_adapter import get_scanner_adapter

        adapter_result = get_scanner_adapter().parse_mrz(text)
        if adapter_result and adapter_result.get("status") == "parsed":
            # Map adapter output to the expected internal format.
            return {
                "document_type": "passport",
                "first_name": adapter_result.get("given_names", ""),
                "last_name": adapter_result.get("surname", ""),
                "full_name": f"{adapter_result.get('given_names', '')} {adapter_result.get('surname', '')}".strip(),
                "document_number": adapter_result.get("document_number", ""),
                "nationality": adapter_result.get("nationality", ""),
                "date_of_birth": _parse_mrz_date(adapter_result.get("date_of_birth_raw", ""), future_bias=False),
                "expiry_date": None,
                "source_format": "mrz",
            }
    except Exception:  # noqa: BLE001
        pass  # Fall through to built-in parser

    # Built-in MRZ parser (fallback).
    lines = [line.strip().replace(" ", "") for line in text.splitlines() if line.strip()]
    if len(lines) < 2:
        return None
    first_line, second_line = lines[0], lines[1]
    if "<" not in first_line or "<" not in second_line or len(first_line) < 40 or len(second_line) < 40:
        return None
    surname_raw, _, given_raw = first_line[5:].partition("<<")
    surname = surname_raw.replace("<", " ").strip()
    given_names = given_raw.replace("<", " ").strip()
    return {
        "document_type": "passport",
        "first_name": given_names,
        "last_name": surname,
        "full_name": f"{given_names} {surname}".strip(),
        "document_number": second_line[0:9].replace("<", "").strip(),
        "nationality": second_line[10:13].replace("<", "").strip(),
        "date_of_birth": _parse_mrz_date(second_line[13:19], future_bias=False),
        "expiry_date": _parse_mrz_date(second_line[21:27], future_bias=True),
        "source_format": "mrz",
    }


def _normalize_extracted_fields(candidate: dict[str, Any] | None, *, document_type: str | None) -> dict[str, Any] | None:
    if not candidate:
        return None

    def lookup(*keys: str) -> Any:
        for key in keys:
            value = candidate.get(key)
            if value not in {None, ""}:
                return value
        return None

    first_name = _clean_text(lookup("first_name", "firstname", "given_name", "given_names", "givenname"))
    last_name = _clean_text(lookup("last_name", "lastname", "surname", "family_name", "familyname"))
    full_name = _clean_text(lookup("full_name", "fullname", "name"))
    if not first_name and not last_name and full_name:
        first_name, last_name = _split_full_name(full_name)

    date_of_birth = _parse_date_string(lookup("date_of_birth", "dob", "birth_date", "birthdate"))
    expiry_date = _parse_date_string(lookup("expiry_date", "expiration_date", "date_of_expiry", "valid_until"))
    normalized = {
        "status": "parsed",
        "document_type": _clean_text(lookup("document_type", "doc_type")) or document_type,
        "first_name": first_name,
        "last_name": last_name,
        "full_name": full_name or f"{first_name or ''} {last_name or ''}".strip() or None,
        "document_number": _clean_text(
            lookup(
                "document_number",
                "passport_number",
                "id_document_number",
                "id_number",
                "license_number",
                "doc_no",
                "number",
            )
        ),
        "nationality": _clean_text(lookup("nationality", "country", "issuing_country")),
        "date_of_birth": date_of_birth.isoformat() if date_of_birth else None,
        "expiry_date": expiry_date.isoformat() if expiry_date else None,
        "source_format": _clean_text(candidate.get("source_format")) or "structured_text",
    }
    normalized["fields_detected"] = [key for key, value in normalized.items() if key not in {"status", "source_format"} and value]
    return normalized if normalized["fields_detected"] else None


def _parse_mrz_date(value: str | None, *, future_bias: bool) -> str | None:
    raw = (value or "").strip()
    if len(raw) != 6 or not raw.isdigit():
        return None
    year = int(raw[0:2])
    month = int(raw[2:4])
    day = int(raw[4:6])
    current_year = date.today().year
    century = (current_year // 100) * 100
    resolved_year = century + year
    if future_bias and resolved_year < current_year - 1:
        resolved_year += 100
    if not future_bias and resolved_year > current_year:
        resolved_year -= 100
    try:
        return date(resolved_year, month, day).isoformat()
    except ValueError:
        return None


def _parse_date_string(value: Any) -> date | None:
    if isinstance(value, date):
        return value
    raw = str(value).strip() if value not in {None, ""} else ""
    if not raw:
        return None
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%Y/%m/%d", "%Y%m%d"):
        try:
            return datetime.strptime(raw, fmt).date()
        except ValueError:
            continue
    return None


def _split_full_name(full_name: Any) -> tuple[str, str]:
    cleaned = _clean_text(full_name)
    if not cleaned:
        return "", ""
    parts = cleaned.split()
    if len(parts) == 1:
        return parts[0], ""
    return " ".join(parts[:-1]), parts[-1]


def _clean_text(value: Any) -> str | None:
    if value in {None, ""}:
        return None
    cleaned = re.sub(r"\s+", " ", str(value)).strip()
    return cleaned or None
