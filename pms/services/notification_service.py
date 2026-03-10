from __future__ import annotations

import smtplib
import ssl
from email.message import EmailMessage

from flask import current_app

from ..extensions import db
from ..models import EmailOutbox
from ..models import utc_now


def deliver_email_outbox_entry(email_outbox_id, *, commit: bool = True) -> EmailOutbox | None:
    entry = db.session.get(EmailOutbox, email_outbox_id)
    if not entry or entry.status == "sent":
        return entry

    entry.attempts += 1
    smtp_host = current_app.config.get("SMTP_HOST")
    if not smtp_host:
        entry.status = "failed"
        entry.last_error = "SMTP is not configured."
        if commit:
            db.session.commit()
        return entry

    message = EmailMessage()
    message["Subject"] = entry.subject
    message["From"] = current_app.config["MAIL_FROM"]
    message["To"] = entry.recipient_email
    message.set_content(entry.body_text)

    try:
        with smtplib.SMTP(smtp_host, current_app.config["SMTP_PORT"], timeout=15) as client:
            if current_app.config["SMTP_USE_TLS"]:
                client.starttls(context=ssl.create_default_context())
            if current_app.config["SMTP_USERNAME"]:
                client.login(
                    current_app.config["SMTP_USERNAME"],
                    current_app.config["SMTP_PASSWORD"],
                )
            client.send_message(message)
        entry.status = "sent"
        entry.sent_at = utc_now()
        entry.last_error = None
    except Exception as exc:  # noqa: BLE001
        entry.status = "failed"
        entry.last_error = str(exc)[:255]
    if commit:
        db.session.commit()
    return entry
