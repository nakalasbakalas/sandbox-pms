from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import sqlalchemy as sa
from sqlalchemy.orm import joinedload

from ..activity import write_activity_log
from ..audit import write_audit_log
from ..extensions import db
from ..models import (
    CashierActivityLog,
    CashierDocument,
    CashierDocumentSequence,
    FolioCharge,
    PaymentEvent,
    PaymentRequest,
    Reservation,
    RoomType,
)
from ..pricing import get_setting_value, quote_reservation


DOCUMENT_PREFIXES = {"folio": "FOL", "invoice": "INV", "receipt": "RCT"}
PAYMENT_METHOD_CODES = {
    "cash": "PMT-CASH",
    "qr": "PMT-QR",
    "card": "PMT-CARD",
    "bank": "PMT-BANK",
    "front_desk": "PMT-CASH",
}


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def money(value) -> Decimal:
    return Decimal(str(value or "0.00")).quantize(Decimal("0.01"))


@dataclass
class ManualAdjustmentPayload:
    charge_type: str
    amount: Decimal
    description: str
    note: str
    service_date: date | None = None
    reference_charge_id: uuid.UUID | None = None


@dataclass
class PaymentPostingPayload:
    amount: Decimal
    payment_method: str
    note: str | None = None
    service_date: date | None = None
    request_type: str = "cashier_payment"
    related_payment_request_id: uuid.UUID | None = None
    is_deposit: bool = False
    posting_key: str | None = None
    provider_reference: str | None = None
    provider_payment_reference: str | None = None
    metadata: dict | None = None


@dataclass
class RefundPostingPayload:
    amount: Decimal
    reason: str
    payment_method: str = "front_desk"
    service_date: date | None = None
    reference_charge_id: uuid.UUID | None = None
    processed: bool = True


@dataclass
class VoidChargePayload:
    reason: str


@dataclass
class DocumentIssuePayload:
    document_type: str
    note: str | None = None


def post_fee_charge(
    reservation_id: uuid.UUID,
    *,
    charge_code: str,
    description: str,
    amount: Decimal,
    service_date: date,
    actor_user_id: uuid.UUID,
    metadata: dict | None = None,
    commit: bool = True,
) -> FolioCharge:
    reservation = _load_reservation_for_update(reservation_id)
    if not reservation:
        raise ValueError("Reservation not found.")
    line = _create_folio_line(
        reservation=reservation,
        charge_code=charge_code,
        charge_type="fee",
        description=description,
        gross_amount=money(amount),
        service_date=service_date,
        actor_user_id=actor_user_id,
        metadata=metadata,
    )
    _log_cashier_event(
        reservation_id=reservation.id,
        actor_user_id=actor_user_id,
        event_type="cashier.fee_posted",
        amount=money(line.total_amount),
        note=description,
        line_id=line.id,
        metadata={"charge_code": charge_code},
    )
    if commit:
        db.session.commit()
    return line


def ensure_room_charges_posted(
    reservation_id: uuid.UUID,
    *,
    through_date: date | None = None,
    actor_user_id: uuid.UUID | None = None,
    commit: bool = True,
) -> list[FolioCharge]:
    reservation = _load_reservation_for_update(reservation_id)
    if not reservation:
        raise ValueError("Reservation not found.")
    if reservation.current_status in {"cancelled", "no_show"}:
        return []
    max_service_date = reservation.check_out_date - timedelta(days=1)
    target_date = min(through_date or max_service_date, max_service_date)
    if target_date < reservation.check_in_date:
        return []

    created: list[FolioCharge] = []
    for business_date, gross_amount in _quoted_room_postings(reservation):
        if business_date > target_date:
            continue
        posting_key = f"room:{reservation.id}:{business_date.isoformat()}"
        existing = FolioCharge.query.filter_by(posting_key=posting_key).first()
        if existing:
            continue
        created.append(
            _create_folio_line(
                reservation=reservation,
                charge_code="RM",
                charge_type="room",
                description=f"Room charge for {business_date.isoformat()}",
                gross_amount=gross_amount,
                service_date=business_date,
                actor_user_id=actor_user_id,
                posting_key=posting_key,
                metadata={"source": "auto_room_charge"},
            )
        )
    if created:
        _sync_reservation_payment_fields(reservation)
        _log_cashier_event(
            reservation_id=reservation.id,
            actor_user_id=actor_user_id,
            event_type="cashier.room_charge_posted",
            amount=sum((money(item.total_amount) for item in created), Decimal("0.00")),
            note=f"Auto-posted {len(created)} room charge line(s).",
            line_id=created[-1].id,
            metadata={"through_date": target_date.isoformat()},
        )
    if commit:
        db.session.commit()
    return created


def folio_summary(reservation: Reservation | uuid.UUID) -> dict:
    reservation = reservation if isinstance(reservation, Reservation) else db.session.get(Reservation, reservation)
    if not reservation:
        raise ValueError("Reservation not found.")
    lines = _folio_lines(reservation.id)
    charges_subtotal = sum(
        (
            money(line.line_amount)
            for line in lines
            if line.charge_type in {"room", "manual_charge", "fee", "correction", "refund"}
        ),
        Decimal("0.00"),
    )
    discounts_subtotal = sum(
        (
            abs(money(line.total_amount))
            for line in lines
            if line.charge_type == "manual_discount"
        ),
        Decimal("0.00"),
    )
    tax_subtotal = sum(
        (
            money(line.tax_amount)
            for line in lines
            if line.charge_type in {"room", "manual_charge", "manual_discount", "fee", "correction"}
        ),
        Decimal("0.00"),
    )
    credits_total = sum(
        (
            abs(money(line.total_amount))
            for line in lines
            if line.charge_type in {"deposit", "payment"} and money(line.total_amount) < Decimal("0.00")
        ),
        Decimal("0.00"),
    )
    deposit_received_total = sum(
        (
            abs(money(line.total_amount))
            for line in lines
            if line.charge_type == "deposit" and money(line.total_amount) < Decimal("0.00")
        ),
        Decimal("0.00"),
    )
    payment_received_total = sum(
        (
            abs(money(line.total_amount))
            for line in lines
            if line.charge_type == "payment" and money(line.total_amount) < Decimal("0.00")
        ),
        Decimal("0.00"),
    )
    refund_posted_total = sum(
        (
            money(line.total_amount)
            for line in lines
            if line.charge_type == "refund"
        ),
        Decimal("0.00"),
    )
    net_total = sum((money(line.total_amount) for line in lines), Decimal("0.00"))
    balance_due = max(net_total, Decimal("0.00"))
    refund_due = max(-net_total, Decimal("0.00"))
    debit_total = sum((max(money(line.total_amount), Decimal("0.00")) for line in lines), Decimal("0.00"))
    deposit_applied_total = min(deposit_received_total, max(debit_total - payment_received_total, Decimal("0.00")))
    unused_deposit_total = max(deposit_received_total - deposit_applied_total, Decimal("0.00"))
    latest_payment_request = (
        PaymentRequest.query.filter_by(reservation_id=reservation.id)
        .order_by(PaymentRequest.created_at.desc())
        .first()
    )
    pending_refund_exists = (
        PaymentEvent.query.filter_by(reservation_id=reservation.id, event_type="refund_pending")
        .order_by(PaymentEvent.created_at.desc())
        .first()
    )
    if balance_due == Decimal("0.00") and refund_due == Decimal("0.00"):
        settlement_state = "settled"
    elif refund_due > Decimal("0.00"):
        settlement_state = "overpaid"
    elif credits_total == Decimal("0.00"):
        settlement_state = "unpaid"
    else:
        settlement_state = "partially_paid"
    if reservation.deposit_required_amount == Decimal("0.00"):
        deposit_state = "not_required"
    elif deposit_received_total == Decimal("0.00"):
        deposit_state = "missing"
    elif deposit_received_total < money(reservation.deposit_required_amount):
        deposit_state = "partial"
    else:
        deposit_state = "paid"
    return {
        "charges_subtotal": charges_subtotal.quantize(Decimal("0.01")),
        "discounts_subtotal": discounts_subtotal.quantize(Decimal("0.01")),
        "tax_subtotal": tax_subtotal.quantize(Decimal("0.01")),
        "credits_total": credits_total.quantize(Decimal("0.01")),
        "deposit_required_amount": money(reservation.deposit_required_amount),
        "deposit_received_amount": deposit_received_total.quantize(Decimal("0.01")),
        "deposit_applied_amount": deposit_applied_total.quantize(Decimal("0.01")),
        "unused_deposit_amount": unused_deposit_total.quantize(Decimal("0.01")),
        "payment_total": payment_received_total.quantize(Decimal("0.01")),
        "refund_posted_total": refund_posted_total.quantize(Decimal("0.01")),
        "balance_due": balance_due.quantize(Decimal("0.01")),
        "refund_due": refund_due.quantize(Decimal("0.01")),
        "net_balance": net_total.quantize(Decimal("0.01")),
        "settlement_state": settlement_state,
        "payment_state": settlement_state,
        "deposit_state": deposit_state,
        "latest_payment_request_status": latest_payment_request.status if latest_payment_request else None,
        "pending_refund": pending_refund_exists is not None,
    }


def get_cashier_detail(
    reservation_id: uuid.UUID,
    *,
    auto_post_room_charges: bool = False,
    auto_post_through: date | None = None,
) -> dict:
    from .communication_service import query_notification_history

    if auto_post_room_charges:
        ensure_room_charges_posted(
            reservation_id,
            through_date=auto_post_through,
            actor_user_id=None,
            commit=True,
        )
    reservation = _load_reservation(reservation_id)
    if not reservation:
        raise ValueError("Reservation not found.")
    return {
        "reservation": reservation,
        "summary": folio_summary(reservation),
        "lines": _folio_lines(reservation.id),
        "activity": (
            CashierActivityLog.query.options(joinedload(CashierActivityLog.actor_user))
            .filter_by(reservation_id=reservation.id)
            .order_by(CashierActivityLog.created_at.desc())
            .all()
        ),
        "documents": (
            CashierDocument.query.options(
                joinedload(CashierDocument.issued_by_user),
                joinedload(CashierDocument.voided_by_user),
            )
            .filter_by(reservation_id=reservation.id)
            .order_by(CashierDocument.issued_at.desc())
            .all()
        ),
        "payment_requests": (
            PaymentRequest.query.filter_by(reservation_id=reservation.id)
            .order_by(PaymentRequest.created_at.desc())
            .all()
        ),
        "payment_events": (
            PaymentEvent.query.filter_by(reservation_id=reservation.id)
            .order_by(PaymentEvent.created_at.desc())
            .all()
        ),
        "notification_history": query_notification_history(reservation_id=reservation.id, limit=30),
    }


def post_manual_adjustment(
    reservation_id: uuid.UUID,
    payload: ManualAdjustmentPayload,
    *,
    actor_user_id: uuid.UUID,
) -> FolioCharge:
    reservation = _load_reservation_for_update(reservation_id)
    if not reservation:
        raise ValueError("Reservation not found.")
    amount = money(payload.amount)
    if amount == Decimal("0.00"):
        raise ValueError("Adjustment amount must be non-zero.")
    description = (payload.description or "").strip()
    note = (payload.note or "").strip()
    if not description or not note:
        raise ValueError("Adjustment description and note are required.")
    if payload.charge_type not in {"manual_charge", "manual_discount", "correction"}:
        raise ValueError("Unsupported adjustment type.")

    gross_amount = amount
    charge_code = "ADJ_POS"
    if payload.charge_type == "manual_discount":
        gross_amount = -amount
        charge_code = "ADJ_NEG"
    elif payload.charge_type == "correction":
        charge_code = "CORR"
        reference = db.session.get(FolioCharge, payload.reference_charge_id) if payload.reference_charge_id else None
        if reference and reference.reservation_id != reservation.id:
            raise ValueError("Correction reference must belong to the same folio.")
        if reference and amount > Decimal("0.00"):
            gross_amount = -money(reference.total_amount)

    line = _create_folio_line(
        reservation=reservation,
        charge_code=charge_code,
        charge_type=payload.charge_type,
        description=description,
        gross_amount=gross_amount,
        service_date=payload.service_date or date.today(),
        actor_user_id=actor_user_id,
        metadata={"note": note, "reference_charge_id": str(payload.reference_charge_id) if payload.reference_charge_id else None},
        reversed_charge_id=payload.reference_charge_id if payload.charge_type == "correction" else None,
    )
    _sync_reservation_payment_fields(reservation)
    _log_cashier_event(
        reservation_id=reservation.id,
        actor_user_id=actor_user_id,
        event_type=f"cashier.{payload.charge_type}",
        amount=money(line.total_amount),
        note=note,
        line_id=line.id,
        metadata={"description": description},
    )
    db.session.commit()
    return line


def record_payment(
    reservation_id: uuid.UUID,
    payload: PaymentPostingPayload,
    *,
    actor_user_id: uuid.UUID,
    commit: bool = True,
) -> FolioCharge:
    reservation = _load_reservation_for_update(reservation_id)
    if not reservation:
        raise ValueError("Reservation not found.")
    amount = money(payload.amount)
    if amount <= Decimal("0.00"):
        raise ValueError("Payment amount must be greater than zero.")
    method = (payload.payment_method or "front_desk").lower()
    charge_code = "DEP" if payload.is_deposit else PAYMENT_METHOD_CODES.get(method, "PMT-CASH")
    description = (
        payload.note.strip()
        if payload.note
        else ("Deposit received" if payload.is_deposit else f"Payment received via {method.replace('_', ' ')}")
    )
    service_date = payload.service_date or date.today()
    if payload.posting_key:
        existing = FolioCharge.query.filter_by(posting_key=payload.posting_key).first()
        if existing:
            return existing
    payment_request = None
    if payload.related_payment_request_id:
        payment_request = db.session.get(PaymentRequest, payload.related_payment_request_id)
    if not payment_request:
        payment_request = PaymentRequest(
            reservation_id=reservation.id,
            request_type=payload.request_type,
            amount=amount,
            currency_code="THB",
            status="paid",
            provider=method,
            due_at=utc_now(),
            created_by_user_id=actor_user_id,
            updated_by_user_id=actor_user_id,
        )
        db.session.add(payment_request)
        db.session.flush()
    else:
        payment_request.status = "paid"
        payment_request.provider = method
        payment_request.provider_reference = payload.provider_reference or payment_request.provider_reference
        payment_request.provider_payment_reference = payload.provider_payment_reference or payment_request.provider_payment_reference
        payment_request.provider_status = "paid"
        payment_request.paid_at = payment_request.paid_at or utc_now()
        payment_request.updated_by_user_id = actor_user_id

    line = _create_folio_line(
        reservation=reservation,
        charge_code=charge_code,
        charge_type="deposit" if payload.is_deposit else "payment",
        description=description,
        gross_amount=-amount,
        service_date=service_date,
        actor_user_id=actor_user_id,
        metadata={
            "payment_request_id": str(payment_request.id),
            "note": payload.note,
            "provider_reference": payload.provider_reference,
            "provider_payment_reference": payload.provider_payment_reference,
            **(payload.metadata or {}),
        },
        posting_key=payload.posting_key,
    )
    db.session.add(
        PaymentEvent(
            payment_request_id=payment_request.id,
            reservation_id=reservation.id,
            event_type="deposit_received" if payload.is_deposit else "payment_collected",
            amount=amount,
            currency_code="THB",
            provider=method,
            processed_at=utc_now(),
            raw_payload={"folio_charge_id": str(line.id), "note": payload.note},
            created_by_user_id=actor_user_id,
        )
    )
    _sync_reservation_payment_fields(reservation)
    _log_cashier_event(
        reservation_id=reservation.id,
        actor_user_id=actor_user_id,
        event_type="cashier.deposit_received" if payload.is_deposit else "cashier.payment_recorded",
        amount=amount,
        note=payload.note,
        line_id=line.id,
        metadata={"method": method},
    )
    if commit:
        db.session.commit()
    return line


def record_refund(
    reservation_id: uuid.UUID,
    payload: RefundPostingPayload,
    *,
    actor_user_id: uuid.UUID,
    commit: bool = True,
) -> FolioCharge | None:
    reservation = _load_reservation_for_update(reservation_id)
    if not reservation:
        raise ValueError("Reservation not found.")
    amount = money(payload.amount)
    if amount <= Decimal("0.00"):
        raise ValueError("Refund amount must be greater than zero.")
    summary = folio_summary(reservation)
    if payload.processed and amount > summary["refund_due"]:
        raise ValueError("Refund exceeds the current refund due.")
    event_type = "refund_processed" if payload.processed else "refund_pending"
    if not payload.processed:
        db.session.add(
            PaymentEvent(
                reservation_id=reservation.id,
                event_type=event_type,
                amount=amount,
                currency_code="THB",
                provider=payload.payment_method,
                processed_at=utc_now(),
                raw_payload={"reason": payload.reason},
                created_by_user_id=actor_user_id,
            )
        )
        _log_cashier_event(
            reservation_id=reservation.id,
            actor_user_id=actor_user_id,
            event_type="cashier.refund_pending",
            amount=amount,
            note=payload.reason,
            metadata={"method": payload.payment_method},
        )
        if commit:
            db.session.commit()
        return None

    line = _create_folio_line(
        reservation=reservation,
        charge_code="REF",
        charge_type="refund",
        description=f"Refund issued via {payload.payment_method}",
        gross_amount=amount,
        service_date=payload.service_date or date.today(),
        actor_user_id=actor_user_id,
        metadata={"reason": payload.reason},
        reversed_charge_id=payload.reference_charge_id,
    )
    db.session.add(
        PaymentEvent(
            reservation_id=reservation.id,
            event_type=event_type,
            amount=amount,
            currency_code="THB",
            provider=payload.payment_method,
            processed_at=utc_now(),
            raw_payload={"folio_charge_id": str(line.id), "reason": payload.reason},
            created_by_user_id=actor_user_id,
        )
    )
    _sync_reservation_payment_fields(reservation)
    _log_cashier_event(
        reservation_id=reservation.id,
        actor_user_id=actor_user_id,
        event_type="cashier.refund_posted",
        amount=amount,
        note=payload.reason,
        line_id=line.id,
        metadata={"method": payload.payment_method},
    )
    if commit:
        db.session.commit()
    return line


def void_folio_charge(
    reservation_id: uuid.UUID,
    charge_id: uuid.UUID,
    payload: VoidChargePayload,
    *,
    actor_user_id: uuid.UUID,
) -> FolioCharge:
    reservation = _load_reservation_for_update(reservation_id)
    if not reservation:
        raise ValueError("Reservation not found.")
    original = (
        db.session.execute(
            sa.select(FolioCharge)
            .where(FolioCharge.id == charge_id, FolioCharge.reservation_id == reservation.id)
            .with_for_update()
        )
        .scalars()
        .first()
    )
    if not original:
        raise ValueError("Folio line not found.")
    if original.voided_at is not None:
        raise ValueError("Folio line has already been voided.")
    reason = (payload.reason or "").strip()
    if not reason:
        raise ValueError("Void reason is required.")

    before_data = _folio_line_snapshot(original)
    reversal = FolioCharge(
        reservation_id=reservation.id,
        charge_code="CORR",
        charge_type="correction",
        description=f"Void reversal for {original.charge_code}: {original.description}",
        quantity=original.quantity,
        unit_amount=money(original.unit_amount),
        line_amount=-money(original.line_amount),
        tax_amount=-money(original.tax_amount),
        total_amount=-money(original.total_amount),
        service_date=original.service_date,
        posted_at=utc_now(),
        posted_by_user_id=actor_user_id,
        is_reversal=True,
        reversed_charge_id=original.id,
        posting_key=f"void:{original.id}",
        metadata_json={"reason": reason},
        created_by_user_id=actor_user_id,
    )
    original.voided_at = utc_now()
    original.voided_by_user_id = actor_user_id
    original.void_reason = reason
    db.session.add(reversal)
    _sync_reservation_payment_fields(reservation)
    _log_cashier_event(
        reservation_id=reservation.id,
        actor_user_id=actor_user_id,
        event_type="cashier.line_voided",
        amount=money(original.total_amount),
        note=reason,
        line_id=original.id,
        metadata={"reversal_line_id": str(reversal.id)},
    )
    write_audit_log(
        actor_user_id=actor_user_id,
        entity_table="folio_charges",
        entity_id=str(original.id),
        action="cashier_void",
        before_data=before_data,
        after_data={**_folio_line_snapshot(original), "voided_at": original.voided_at.isoformat(), "void_reason": reason},
    )
    db.session.commit()
    return reversal


def issue_cashier_document(
    reservation_id: uuid.UUID,
    payload: DocumentIssuePayload,
    *,
    actor_user_id: uuid.UUID,
) -> CashierDocument:
    if payload.document_type not in DOCUMENT_PREFIXES:
        raise ValueError("Unsupported document type.")
    reservation = _load_reservation_for_update(reservation_id)
    if not reservation:
        raise ValueError("Reservation not found.")
    existing = (
        CashierDocument.query.filter_by(reservation_id=reservation.id, document_type=payload.document_type, status="issued")
        .order_by(CashierDocument.issued_at.asc())
        .first()
    )
    if existing:
        return existing

    summary = folio_summary(reservation)
    document_number = _next_document_number(payload.document_type, issue_date=date.today())
    amount = summary["charges_subtotal"] + summary["tax_subtotal"]
    if payload.document_type == "receipt":
        amount = summary["credits_total"]
    document = CashierDocument(
        reservation_id=reservation.id,
        document_type=payload.document_type,
        document_number=document_number,
        status="issued",
        total_amount=amount,
        currency_code="THB",
        issued_at=utc_now(),
        issued_by_user_id=actor_user_id,
        printed_at=utc_now(),
        metadata_json={"note": payload.note, "settlement_state": summary["settlement_state"]},
    )
    db.session.add(document)
    db.session.flush()
    _log_cashier_event(
        reservation_id=reservation.id,
        actor_user_id=actor_user_id,
        event_type=f"cashier.{payload.document_type}_issued",
        amount=amount,
        note=payload.note,
        document_id=document.id,
        metadata={"document_number": document_number},
    )
    db.session.commit()
    return document


def cashier_print_context(
    reservation_id: uuid.UUID,
    *,
    document_type: str,
    actor_user_id: uuid.UUID | None = None,
    issue_document: bool = False,
) -> dict:
    reservation = _load_reservation(reservation_id)
    if not reservation:
        raise ValueError("Reservation not found.")
    max_service_date = reservation.check_out_date - timedelta(days=1)
    auto_post_through = min(date.today(), max_service_date)
    if reservation.current_status == "checked_out":
        auto_post_through = max_service_date
    detail = get_cashier_detail(
        reservation_id,
        auto_post_room_charges=True,
        auto_post_through=auto_post_through,
    )
    document = None
    if issue_document:
        if actor_user_id is None:
            raise ValueError("Actor is required to issue a cashier document.")
        document = issue_cashier_document(
            reservation_id,
            DocumentIssuePayload(document_type=document_type),
            actor_user_id=actor_user_id,
        )
    else:
        document = (
            CashierDocument.query.filter_by(reservation_id=reservation_id, document_type=document_type, status="issued")
            .order_by(CashierDocument.issued_at.asc())
            .first()
        )
    return {"detail": detail, "document": document, "printed_at": utc_now(), "document_type": document_type}


def _load_reservation(reservation_id: uuid.UUID) -> Reservation | None:
    return (
        Reservation.query.options(
            joinedload(Reservation.primary_guest),
            joinedload(Reservation.room_type),
            joinedload(Reservation.assigned_room),
        )
        .filter(Reservation.id == reservation_id)
        .first()
    )


def _load_reservation_for_update(reservation_id: uuid.UUID) -> Reservation | None:
    return (
        db.session.execute(
            sa.select(Reservation)
            .options(
                joinedload(Reservation.primary_guest),
                joinedload(Reservation.room_type),
                joinedload(Reservation.assigned_room),
            )
            .where(Reservation.id == reservation_id)
            .with_for_update()
        )
        .unique()
        .scalars()
        .first()
    )


def _folio_lines(reservation_id: uuid.UUID) -> list[FolioCharge]:
    return (
        FolioCharge.query.options(
            joinedload(FolioCharge.posted_by_user),
            joinedload(FolioCharge.voided_by_user),
            joinedload(FolioCharge.reversed_charge),
        )
        .filter_by(reservation_id=reservation_id)
        .order_by(FolioCharge.service_date.asc(), FolioCharge.posted_at.asc(), FolioCharge.created_at.asc())
        .all()
    )


def _quoted_room_postings(reservation: Reservation) -> list[tuple[date, Decimal]]:
    room_type = reservation.room_type or db.session.get(RoomType, reservation.room_type_id)
    quote = quote_reservation(
        room_type=room_type,
        check_in_date=reservation.check_in_date,
        check_out_date=reservation.check_out_date,
        adults=reservation.adults + reservation.extra_guests,
        children=reservation.children,
    )
    extra_guest_fee = money(get_setting_value("hotel.extra_guest_fee", "200.00"))
    child_fee = money(get_setting_value("hotel.child_fee_6_11", "100.00"))
    extra_guest_count = max((reservation.adults + reservation.extra_guests) - room_type.standard_occupancy, 0)
    nightly_extra = (extra_guest_fee * Decimal(str(extra_guest_count))) + (child_fee * Decimal(str(reservation.children)))
    return [(business_date, money(nightly_rate) + nightly_extra) for business_date, nightly_rate in quote.nightly_rates]


def _split_tax_from_gross(gross_amount: Decimal) -> tuple[Decimal, Decimal]:
    vat_rate = money(get_setting_value("hotel.vat_rate", "0.07"))
    if vat_rate <= Decimal("0.00"):
        return gross_amount, Decimal("0.00")
    divisor = Decimal("1.00") + vat_rate
    sign = Decimal("-1.00") if gross_amount < Decimal("0.00") else Decimal("1.00")
    line_amount = ((abs(gross_amount) / divisor).quantize(Decimal("0.01")) * sign).quantize(Decimal("0.01"))
    tax_amount = ((abs(gross_amount) - abs(line_amount)).quantize(Decimal("0.01")) * sign).quantize(Decimal("0.01"))
    return line_amount, tax_amount


def _create_folio_line(
    *,
    reservation: Reservation,
    charge_code: str,
    charge_type: str,
    description: str,
    gross_amount: Decimal,
    service_date: date,
    actor_user_id: uuid.UUID | None,
    metadata: dict | None = None,
    posting_key: str | None = None,
    reversed_charge_id: uuid.UUID | None = None,
) -> FolioCharge:
    gross_amount = money(gross_amount)
    if charge_type in {"deposit", "payment", "refund"}:
        line_amount = gross_amount
        tax_amount = Decimal("0.00")
        unit_amount = abs(gross_amount)
    else:
        line_amount, tax_amount = _split_tax_from_gross(gross_amount)
        unit_amount = abs(line_amount)
    charge = FolioCharge(
        reservation_id=reservation.id,
        charge_code=charge_code,
        charge_type=charge_type,
        description=description[:255],
        quantity=Decimal("1.00"),
        unit_amount=unit_amount,
        line_amount=line_amount,
        tax_amount=tax_amount,
        total_amount=gross_amount,
        service_date=service_date,
        posted_at=utc_now(),
        posted_by_user_id=actor_user_id,
        is_reversal=reversed_charge_id is not None,
        reversed_charge_id=reversed_charge_id,
        posting_key=posting_key,
        metadata_json=metadata,
        created_by_user_id=actor_user_id,
    )
    db.session.add(charge)
    db.session.flush()
    write_audit_log(
        actor_user_id=actor_user_id,
        entity_table="folio_charges",
        entity_id=str(charge.id),
        action="cashier_line_posted",
        after_data=_folio_line_snapshot(charge),
    )
    return charge


def _sync_reservation_payment_fields(reservation: Reservation) -> None:
    deposit_received = sum(
        (
            abs(money(line.total_amount))
            for line in _folio_lines(reservation.id)
            if line.charge_type == "deposit" and money(line.total_amount) < Decimal("0.00")
        ),
        Decimal("0.00"),
    )
    reservation.deposit_received_amount = deposit_received.quantize(Decimal("0.01"))


def _log_cashier_event(
    *,
    reservation_id: uuid.UUID,
    actor_user_id: uuid.UUID | None,
    event_type: str,
    amount: Decimal | None = None,
    note: str | None = None,
    line_id: uuid.UUID | None = None,
    document_id: uuid.UUID | None = None,
    metadata: dict | None = None,
) -> None:
    db.session.add(
        CashierActivityLog(
            reservation_id=reservation_id,
            folio_charge_id=line_id,
            cashier_document_id=document_id,
            actor_user_id=actor_user_id,
            event_type=event_type,
            amount=money(amount) if amount is not None else None,
            note=(note or "")[:255] or None,
            metadata_json=metadata,
        )
    )
    activity_metadata = dict(metadata or {})
    if note:
        activity_metadata["note"] = note
    write_activity_log(
        actor_user_id=actor_user_id,
        event_type=event_type,
        entity_table="reservations",
        entity_id=str(reservation_id),
        metadata=activity_metadata or None,
    )


def _folio_line_snapshot(charge: FolioCharge) -> dict:
    return {
        "reservation_id": str(charge.reservation_id),
        "charge_code": charge.charge_code,
        "charge_type": charge.charge_type,
        "description": charge.description,
        "service_date": charge.service_date.isoformat(),
        "total_amount": str(charge.total_amount),
        "posting_key": charge.posting_key,
        "voided_at": charge.voided_at.isoformat() if charge.voided_at else None,
        "void_reason": charge.void_reason,
        "reversed_charge_id": str(charge.reversed_charge_id) if charge.reversed_charge_id else None,
    }


def _next_document_number(document_type: str, *, issue_date: date) -> str:
    prefix = DOCUMENT_PREFIXES[document_type]
    sequence_name = f"{prefix}:{issue_date.strftime('%Y%m%d')}"
    sequence = (
        db.session.execute(
            sa.select(CashierDocumentSequence)
            .where(CashierDocumentSequence.sequence_name == sequence_name)
            .with_for_update()
        )
        .scalars()
        .first()
    )
    if not sequence:
        sequence = CashierDocumentSequence(sequence_name=sequence_name, next_value=1)
        db.session.add(sequence)
        db.session.flush()
    next_value = sequence.next_value
    sequence.next_value += 1
    return f"{prefix}-{issue_date.strftime('%Y%m%d')}-{int(next_value):04d}"
