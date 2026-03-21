"""Messaging blueprint — staff messaging hub routes."""

from __future__ import annotations

from uuid import UUID

import sqlalchemy as sa
from flask import Blueprint, abort, flash, jsonify, redirect, render_template, request, url_for
from markupsafe import escape

from ..extensions import db
from ..helpers import parse_request_int_arg, require_permission
from ..models import Guest, Reservation, User
from ..services.messaging_service import (
    ComposePayload as MessagingComposePayload,
    InboxFilters as MessagingInboxFilters,
    assign_thread,
    close_thread,
    get_thread_detail,
    list_inbox,
    list_message_templates as list_msg_templates,
    mark_thread_read,
    record_inbound_message,
    reopen_thread,
    send_message as messaging_send_message,
    toggle_followup,
)

messaging_bp = Blueprint("messaging", __name__)


@messaging_bp.route("/staff/messaging")
def staff_messaging_inbox():
    actor = require_permission("messaging.view")
    filters = MessagingInboxFilters(
        channel=request.args.get("channel", ""),
        status=request.args.get("status", ""),
        unread_only=request.args.get("unread") == "1",
        needs_followup=request.args.get("followup") == "1",
        reservation_status=request.args.get("res_status", ""),
        search=(request.args.get("q") or "").strip(),
        assigned_user_id=request.args.get("assigned", ""),
        page=parse_request_int_arg("page", default=1, minimum=1),
    )
    entries, total = list_inbox(filters)
    total_pages = max(1, (total + filters.per_page - 1) // filters.per_page)
    templates = list_msg_templates()
    staff_users = (
        db.session.execute(
            sa.select(User)
            .where(User.deleted_at.is_(None), User.account_state == "active")
            .order_by(User.full_name)
        )
        .unique()
        .scalars()
        .all()
    )
    return render_template(
        "staff_messaging_inbox.html",
        entries=entries,
        filters=filters,
        total=total,
        total_pages=total_pages,
        templates=templates,
        staff_users=staff_users,
    )


@messaging_bp.route("/staff/messaging/thread/<uuid:thread_id>")
def staff_messaging_thread(thread_id):
    require_permission("messaging.view")
    detail = get_thread_detail(str(thread_id))
    if not detail or not detail.thread:
        abort(404)
    mark_thread_read(str(thread_id))
    templates = list_msg_templates(channel=detail.thread.channel)
    staff_users = (
        db.session.execute(
            sa.select(User)
            .where(User.deleted_at.is_(None), User.account_state == "active")
            .order_by(User.full_name)
        )
        .unique()
        .scalars()
        .all()
    )
    return render_template(
        "staff_messaging_thread.html",
        detail=detail,
        templates=templates,
        staff_users=staff_users,
    )


@messaging_bp.route("/staff/messaging/send", methods=["POST"])
def staff_messaging_send():
    actor = require_permission("messaging.send")
    payload = MessagingComposePayload(
        thread_id=request.form.get("thread_id") or None,
        guest_id=request.form.get("guest_id") or None,
        reservation_id=request.form.get("reservation_id") or None,
        channel=request.form.get("channel", "email"),
        subject=request.form.get("subject", "").strip(),
        body_text=request.form.get("body_text", "").strip(),
        is_internal_note=request.form.get("is_internal_note") == "1",
        template_key=request.form.get("template_key") or None,
        recipient_address=request.form.get("recipient_address") or None,
    )
    if not payload.body_text:
        flash("Message body cannot be empty.", "danger")
        back = request.form.get("back_url") or url_for("messaging.staff_messaging_inbox")
        return redirect(back)
    try:
        msg = messaging_send_message(payload, actor_user_id=str(actor.id))
        if msg.status == "sent":
            flash("Message sent successfully.", "success")
        elif msg.status == "failed":
            flash(f"Message delivery failed: {msg.provider_error or 'unknown error'}", "danger")
        else:
            flash("Message queued.", "info")
    except Exception as exc:
        db.session.rollback()
        flash(f"Error sending message: {escape(str(exc))}", "danger")

    back = request.form.get("back_url")
    if back:
        return redirect(back)
    if payload.thread_id:
        return redirect(url_for("messaging.staff_messaging_thread", thread_id=payload.thread_id))
    return redirect(url_for("messaging.staff_messaging_inbox"))


@messaging_bp.route("/staff/messaging/note", methods=["POST"])
def staff_messaging_add_note():
    actor = require_permission("messaging.send")
    payload = MessagingComposePayload(
        thread_id=request.form.get("thread_id") or None,
        guest_id=request.form.get("guest_id") or None,
        reservation_id=request.form.get("reservation_id") or None,
        channel="internal_note",
        body_text=request.form.get("body_text", "").strip(),
        is_internal_note=True,
    )
    if not payload.body_text:
        flash("Note text cannot be empty.", "danger")
        back = request.form.get("back_url") or url_for("messaging.staff_messaging_inbox")
        return redirect(back)
    messaging_send_message(payload, actor_user_id=str(actor.id))
    flash("Internal note added.", "success")
    back = request.form.get("back_url")
    if back:
        return redirect(back)
    if payload.thread_id:
        return redirect(url_for("messaging.staff_messaging_thread", thread_id=payload.thread_id))
    return redirect(url_for("messaging.staff_messaging_inbox"))


@messaging_bp.route("/staff/messaging/call-log", methods=["POST"])
def staff_messaging_call_log():
    actor = require_permission("messaging.send")
    payload = MessagingComposePayload(
        thread_id=request.form.get("thread_id") or None,
        guest_id=request.form.get("guest_id") or None,
        reservation_id=request.form.get("reservation_id") or None,
        channel="manual_call_log",
        subject="Phone call",
        body_text=request.form.get("body_text", "").strip(),
        is_internal_note=True,
    )
    if not payload.body_text:
        flash("Call log notes cannot be empty.", "danger")
        back = request.form.get("back_url") or url_for("messaging.staff_messaging_inbox")
        return redirect(back)
    messaging_send_message(payload, actor_user_id=str(actor.id))
    flash("Phone call logged.", "success")
    back = request.form.get("back_url")
    if back:
        return redirect(back)
    if payload.thread_id:
        return redirect(url_for("messaging.staff_messaging_thread", thread_id=payload.thread_id))
    return redirect(url_for("messaging.staff_messaging_inbox"))


@messaging_bp.route("/staff/messaging/thread/<uuid:thread_id>/close", methods=["POST"])
def staff_messaging_close_thread(thread_id):
    actor = require_permission("messaging.send")
    close_thread(str(thread_id), actor_user_id=str(actor.id))
    flash("Conversation closed.", "success")
    return redirect(url_for("messaging.staff_messaging_inbox"))


@messaging_bp.route("/staff/messaging/thread/<uuid:thread_id>/reopen", methods=["POST"])
def staff_messaging_reopen_thread(thread_id):
    actor = require_permission("messaging.send")
    reopen_thread(str(thread_id), actor_user_id=str(actor.id))
    flash("Conversation reopened.", "success")
    return redirect(url_for("messaging.staff_messaging_thread", thread_id=thread_id))


@messaging_bp.route("/staff/messaging/thread/<uuid:thread_id>/followup", methods=["POST"])
def staff_messaging_toggle_followup(thread_id):
    actor = require_permission("messaging.send")
    is_followup = toggle_followup(str(thread_id), actor_user_id=str(actor.id))
    flash("Follow-up " + ("marked" if is_followup else "cleared") + ".", "success")
    return redirect(url_for("messaging.staff_messaging_thread", thread_id=thread_id))


@messaging_bp.route("/staff/messaging/thread/<uuid:thread_id>/assign", methods=["POST"])
def staff_messaging_assign_thread(thread_id):
    actor = require_permission("messaging.send")
    user_id = request.form.get("user_id") or None
    assign_thread(str(thread_id), user_id, actor_user_id=str(actor.id))
    flash("Thread assignment updated.", "success")
    return redirect(url_for("messaging.staff_messaging_thread", thread_id=thread_id))


@messaging_bp.route("/staff/messaging/compose")
def staff_messaging_compose():
    require_permission("messaging.send")
    reservation_id = request.args.get("reservation_id", "")
    guest_id = request.args.get("guest_id", "")
    reservation = None
    guest = None
    if reservation_id:
        reservation = db.session.get(Reservation, UUID(reservation_id))
        if reservation and reservation.primary_guest:
            guest = reservation.primary_guest
    elif guest_id:
        guest = db.session.get(Guest, UUID(guest_id))
    templates = list_msg_templates()
    return render_template(
        "staff_messaging_compose.html",
        reservation=reservation,
        guest=guest,
        templates=templates,
    )


@messaging_bp.route("/staff/messaging/inbound", methods=["POST"])
def staff_messaging_inbound_webhook():
    """Webhook endpoint for inbound messages from providers."""
    data = request.get_json(silent=True) or {}
    channel = data.get("channel", "email")
    sender = data.get("sender_address", "")
    body = data.get("body_text", "")
    subject = data.get("subject")
    provider_id = data.get("provider_message_id")
    if not sender or not body:
        return jsonify({"error": "sender_address and body_text required"}), 400
    try:
        msg = record_inbound_message(
            channel=channel,
            sender_address=sender,
            body_text=body,
            subject=subject,
            provider_message_id=provider_id,
        )
        return jsonify({"status": "ok", "message_id": str(msg.id)})
    except Exception as exc:
        db.session.rollback()
        return jsonify({"error": str(exc)}), 500
