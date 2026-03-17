"""Pre-check-in service — manages the guest digital pre-check-in lifecycle.

Handles token generation, guest form submission, document upload,
staff verification, readiness computation, and link delivery hooks.
"""

from __future__ import annotations

import re
import secrets
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
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
# OCR / ID extraction stub
# ---------------------------------------------------------------------------


def suggest_ocr_extraction(doc_id: uuid.UUID) -> dict[str, Any] | None:
    """Asynchronous stub: extract name/document-number from an uploaded ID image.

    This function is intentionally **not implemented** — it is the hook point
    for a future background worker that calls an OCR service (e.g. AWS Textract,
    Google Cloud Vision) and stores extracted fields in
    ``ReservationDocument.ocr_extracted_data``.

    Workflow (to be implemented):
    1. A background job calls this function after ``upload_document()`` succeeds.
    2. The function sends ``doc.storage_key`` to the OCR provider.
    3. Structured fields (name, document_number, date_of_birth, expiry_date)
       are stored in ``doc.ocr_extracted_data`` as a JSON dict.
    4. Staff review the suggestions on the pre-check-in detail page before
       applying — never auto-update the ``Guest`` record.

    Returns *None* until the worker is implemented.
    """
    doc = db.session.get(ReservationDocument, doc_id)
    if doc is None:
        raise ValueError("Document not found.")
    # TODO: integrate OCR provider here and populate doc.ocr_extracted_data
    return None
