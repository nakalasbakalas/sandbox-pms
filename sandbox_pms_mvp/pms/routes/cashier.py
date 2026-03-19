"""Cashier blueprint — folio management, payments, refunds, and document issuance."""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from uuid import UUID

from flask import Blueprint, Response, abort, flash, redirect, render_template, request, url_for

from ..helpers import (
    can,
    parse_request_date_arg,
    require_permission,
    require_user,
    safe_back_path,
)
from ..security import public_error_message
from ..services.cashier_service import (
    DocumentIssuePayload,
    ManualAdjustmentPayload,
    PaymentPostingPayload,
    RefundPostingPayload,
    VoidChargePayload,
    cashier_print_context,
    ensure_room_charges_posted,
    get_cashier_detail,
    issue_cashier_document,
    post_manual_adjustment,
    record_payment,
    record_refund,
    void_folio_charge,
)
from ..services.payment_integration_service import (
    create_or_reuse_payment_request,
    payments_enabled,
    resend_payment_link,
    sync_payment_request_status,
)

cashier_bp = Blueprint("cashier", __name__)


@cashier_bp.route("/staff/cashier/<uuid:reservation_id>")
def staff_cashier_detail(reservation_id):
    require_permission("folio.view")
    auto_post_until = parse_request_date_arg("auto_post_until", default=None)
    detail = get_cashier_detail(
        reservation_id,
        auto_post_room_charges=request.args.get("auto_post") == "1",
        auto_post_through=auto_post_until,
    )
    return render_template(
        "cashier_folio.html",
        detail=detail,
        back_url=safe_back_path(
            request.args.get("back"),
            url_for("staff_reservations.staff_reservation_detail", reservation_id=reservation_id),
        ),
        can_adjust=can("folio.adjust"),
        can_charge=can("folio.charge_add"),
        can_payment=can("payment.create"),
        can_refund=can("payment.refund"),
        can_payment_request=can("payment_request.create"),
        payments_enabled=payments_enabled(),
    )


@cashier_bp.route("/staff/cashier/<uuid:reservation_id>/room-charges", methods=["POST"])
def staff_cashier_post_room_charges(reservation_id):
    user = require_permission("folio.charge_add")
    through_date = date.fromisoformat(request.form["through_date"])
    try:
        created = ensure_room_charges_posted(
            reservation_id,
            through_date=through_date,
            actor_user_id=user.id,
            commit=True,
        )
        flash(f"Posted {len(created)} room charge line(s).", "success")
    except Exception as exc:  # noqa: BLE001
        flash(public_error_message(exc), "error")
    return redirect(url_for("cashier.staff_cashier_detail", reservation_id=reservation_id, back=request.form.get("back_url")))


@cashier_bp.route("/staff/cashier/<uuid:reservation_id>/adjustments", methods=["POST"])
def staff_cashier_adjustment(reservation_id):
    user = require_user()
    charge_type = request.form.get("charge_type", "")
    required_permission = "folio.charge_add" if charge_type == "manual_charge" else "folio.adjust"
    if not user.has_permission(required_permission):
        abort(403)
    try:
        post_manual_adjustment(
            reservation_id,
            ManualAdjustmentPayload(
                charge_type=charge_type,
                amount=Decimal(request.form.get("amount") or "0.00"),
                description=request.form.get("description", ""),
                note=request.form.get("note", ""),
                service_date=date.fromisoformat(request.form["service_date"]) if request.form.get("service_date") else None,
                reference_charge_id=UUID(request.form["reference_charge_id"]) if request.form.get("reference_charge_id") else None,
            ),
            actor_user_id=user.id,
        )
        flash("Folio adjustment posted.", "success")
    except Exception as exc:  # noqa: BLE001
        flash(public_error_message(exc), "error")
    return redirect(url_for("cashier.staff_cashier_detail", reservation_id=reservation_id, back=request.form.get("back_url")))


@cashier_bp.route("/staff/cashier/<uuid:reservation_id>/payments", methods=["POST"])
def staff_cashier_payment(reservation_id):
    user = require_permission("payment.create")
    try:
        record_payment(
            reservation_id,
            PaymentPostingPayload(
                amount=Decimal(request.form.get("amount") or "0.00"),
                payment_method=request.form.get("payment_method", "cash"),
                note=request.form.get("note"),
                service_date=date.fromisoformat(request.form["service_date"]) if request.form.get("service_date") else None,
                request_type="cashier_payment",
                is_deposit=request.form.get("is_deposit") == "on",
                provider_reference=(request.form.get("transaction_reference") or "").strip() or None,
            ),
            actor_user_id=user.id,
        )
        flash("Payment recorded on folio.", "success")
    except Exception as exc:  # noqa: BLE001
        flash(public_error_message(exc), "error")
    return redirect(url_for("cashier.staff_cashier_detail", reservation_id=reservation_id, back=request.form.get("back_url")))


@cashier_bp.route("/staff/cashier/<uuid:reservation_id>/payment-requests", methods=["POST"])
def staff_cashier_payment_request(reservation_id):
    user = require_permission("payment_request.create")
    try:
        create_or_reuse_payment_request(
            reservation_id,
            actor_user_id=user.id,
            request_kind=request.form.get("request_kind", "deposit"),
            send_email=request.form.get("send_email") == "on",
            language=request.form.get("language") or None,
            force_new_link=request.form.get("force_new_link") == "on",
            source="staff_cashier",
        )
        flash("Payment request is ready.", "success")
    except Exception as exc:  # noqa: BLE001
        flash(public_error_message(exc), "error")
    return redirect(url_for("cashier.staff_cashier_detail", reservation_id=reservation_id, back=request.form.get("back_url")))


@cashier_bp.route("/staff/cashier/<uuid:reservation_id>/payment-requests/<uuid:payment_request_id>/resend", methods=["POST"])
def staff_cashier_resend_payment_request(reservation_id, payment_request_id):
    user = require_permission("payment_request.create")
    try:
        resend_payment_link(
            payment_request_id,
            actor_user_id=user.id,
            force_new=request.form.get("force_new_link") == "on",
        )
        flash("Payment link resent.", "success")
    except Exception as exc:  # noqa: BLE001
        flash(public_error_message(exc), "error")
    return redirect(url_for("cashier.staff_cashier_detail", reservation_id=reservation_id, back=request.form.get("back_url")))


@cashier_bp.route("/staff/cashier/<uuid:reservation_id>/payment-requests/<uuid:payment_request_id>/refresh", methods=["POST"])
def staff_cashier_refresh_payment_request(reservation_id, payment_request_id):
    user = require_permission("payment.read")
    try:
        sync_payment_request_status(payment_request_id, actor_user_id=user.id)
        flash("Payment status refreshed.", "success")
    except Exception as exc:  # noqa: BLE001
        flash(public_error_message(exc), "error")
    return redirect(url_for("cashier.staff_cashier_detail", reservation_id=reservation_id, back=request.form.get("back_url")))


@cashier_bp.route("/staff/cashier/<uuid:reservation_id>/refunds", methods=["POST"])
def staff_cashier_refund(reservation_id):
    user = require_permission("payment.refund")
    try:
        record_refund(
            reservation_id,
            RefundPostingPayload(
                amount=Decimal(request.form.get("amount") or "0.00"),
                reason=request.form.get("reason", ""),
                payment_method=request.form.get("payment_method", "cash"),
                service_date=date.fromisoformat(request.form["service_date"]) if request.form.get("service_date") else None,
                reference_charge_id=UUID(request.form["reference_charge_id"]) if request.form.get("reference_charge_id") else None,
                transaction_reference=(request.form.get("transaction_reference") or "").strip() or None,
                processed=request.form.get("processed", "1") == "1",
            ),
            actor_user_id=user.id,
        )
        flash("Refund workflow recorded.", "success")
    except Exception as exc:  # noqa: BLE001
        flash(public_error_message(exc), "error")
    return redirect(url_for("cashier.staff_cashier_detail", reservation_id=reservation_id, back=request.form.get("back_url")))


@cashier_bp.route("/staff/cashier/<uuid:reservation_id>/lines/<uuid:charge_id>/void", methods=["POST"])
def staff_cashier_void_charge(reservation_id, charge_id):
    user = require_permission("folio.adjust")
    try:
        void_folio_charge(
            reservation_id,
            charge_id,
            VoidChargePayload(reason=request.form.get("reason", "")),
            actor_user_id=user.id,
        )
        flash("Folio line voided with reversal.", "success")
    except Exception as exc:  # noqa: BLE001
        flash(public_error_message(exc), "error")
    return redirect(url_for("cashier.staff_cashier_detail", reservation_id=reservation_id, back=request.form.get("back_url")))


@cashier_bp.route("/staff/cashier/<uuid:reservation_id>/print")
def staff_cashier_print(reservation_id):
    require_permission("folio.view")
    document_type = request.args.get("document_type", "folio")
    context = cashier_print_context(
        reservation_id,
        document_type=document_type,
        actor_user_id=None,
        issue_document=False,
    )
    return render_template("cashier_print.html", **context)


@cashier_bp.route("/staff/cashier/<uuid:reservation_id>/documents", methods=["POST"])
def staff_cashier_issue_document(reservation_id):
    user = require_permission("folio.view")
    document_type = request.form.get("document_type", "folio")
    try:
        issue_cashier_document(
            reservation_id,
            DocumentIssuePayload(
                document_type=document_type,
                note=request.form.get("note"),
            ),
            actor_user_id=user.id,
        )
        flash(f"{document_type.replace('_', ' ').title()} issued.", "success")
        return redirect(url_for("cashier.staff_cashier_print", reservation_id=reservation_id, document_type=document_type))
    except Exception as exc:  # noqa: BLE001
        flash(public_error_message(exc), "error")
        return redirect(url_for("cashier.staff_cashier_detail", reservation_id=reservation_id, back=request.form.get("back_url")))
