"""Twilio SMS adapter — sends SMS via the Twilio REST API.

Uses only ``urllib.request`` (stdlib) so no external dependency is required.
The Twilio Messages API is a simple HTTP POST with HTTP Basic Auth.
"""
from __future__ import annotations

import base64
import json
import logging
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

from flask import current_app

logger = logging.getLogger(__name__)


class TwilioSmsAdapter:
    """Send SMS messages through the Twilio REST API."""

    def send_sms(self, to: str, body: str) -> dict[str, Any]:
        """Send an SMS to *to* with the given *body*.

        Returns ``{"ok": True, "sid": "<message_sid>"}`` on success or
        ``{"ok": False, "error": "<description>"}`` on failure.
        """
        account_sid = str(current_app.config.get("TWILIO_ACCOUNT_SID", "") or "").strip()
        auth_token = str(current_app.config.get("TWILIO_AUTH_TOKEN", "") or "").strip()
        from_number = str(current_app.config.get("TWILIO_FROM_NUMBER", "") or "").strip()

        if not account_sid or not auth_token or not from_number:
            return {"ok": False, "error": "Twilio credentials are not configured (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER)."}

        to = (to or "").strip()
        if not to:
            return {"ok": False, "error": "SMS recipient number is required."}

        url = f"https://api.twilio.com/2010-04-01/Accounts/{account_sid}/Messages.json"

        form_data = urllib.parse.urlencode({
            "To": to,
            "From": from_number,
            "Body": body,
        }).encode("utf-8")

        credentials = base64.b64encode(f"{account_sid}:{auth_token}".encode()).decode("ascii")
        headers = {
            "Authorization": f"Basic {credentials}",
            "Content-Type": "application/x-www-form-urlencoded",
        }

        req = urllib.request.Request(url, data=form_data, method="POST", headers=headers)

        try:
            with urllib.request.urlopen(req, timeout=15) as response:  # noqa: S310
                response_body = response.read().decode("utf-8", errors="ignore")
                data = json.loads(response_body)
                message_sid = data.get("sid", "")
                logger.info("TwilioSmsAdapter: message sent sid=%s to=%s", message_sid, to)
                return {"ok": True, "sid": message_sid}
        except urllib.error.HTTPError as exc:
            error_body = ""
            try:
                error_body = exc.read().decode("utf-8", errors="ignore")
                error_data = json.loads(error_body)
                error_msg = error_data.get("message", str(exc))
            except Exception:
                error_msg = error_body[:500] or str(exc)
            logger.warning("TwilioSmsAdapter: HTTP %s — %s", exc.code, error_msg)
            return {"ok": False, "error": f"Twilio API error ({exc.code}): {error_msg}"}
        except urllib.error.URLError as exc:
            logger.warning("TwilioSmsAdapter: network error — %s", exc)
            return {"ok": False, "error": f"Network error: {exc}"}
        except Exception as exc:
            logger.exception("TwilioSmsAdapter: unexpected error")
            return {"ok": False, "error": str(exc)[:500]}
