"""SMS provider abstraction — factory + dispatch.

Reads ``SMS_PROVIDER`` from Flask config and returns the matching adapter.
Supported values: ``"log"`` (default), ``"webhook"``, ``"twilio"``.
"""
from __future__ import annotations

import json
import logging
import urllib.error
import urllib.request
import uuid
from typing import Any

from flask import current_app

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Provider implementations
# ---------------------------------------------------------------------------


class LogOnlySmsAdapter:
    """Log-only adapter — no actual SMS delivery. Default for development."""

    def send_sms(self, to: str, body: str) -> dict[str, Any]:
        mock_sid = f"log-sms-{uuid.uuid4().hex[:12]}"
        logger.info("LogOnlySmsAdapter: mock SMS to=%s body=%s", to, body[:120])
        return {"ok": True, "sid": mock_sid, "mock": True}


class WebhookSmsAdapter:
    """Forward SMS to ``SMS_OUTBOUND_WEBHOOK_URL``."""

    def send_sms(self, to: str, body: str) -> dict[str, Any]:
        webhook_url = str(current_app.config.get("SMS_OUTBOUND_WEBHOOK_URL", "") or "").strip()
        if not webhook_url:
            logger.info("WebhookSmsAdapter: no SMS_OUTBOUND_WEBHOOK_URL configured, falling back to log-only")
            return LogOnlySmsAdapter().send_sms(to, body)

        to = (to or "").strip()
        if not to:
            return {"ok": False, "error": "SMS recipient number is required."}

        payload = json.dumps({"channel": "sms", "to": to, "body_text": body}).encode("utf-8")
        req = urllib.request.Request(
            webhook_url,
            data=payload,
            method="POST",
            headers={"Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(req, timeout=15) as response:  # noqa: S310
                sid = response.headers.get("X-Request-Id") or f"webhook-{response.status}"
                return {"ok": True, "sid": sid}
        except urllib.error.URLError as exc:
            return {"ok": False, "error": str(exc)[:500]}


# ---------------------------------------------------------------------------
# Factory
# ---------------------------------------------------------------------------


def get_sms_provider():
    """Return the configured SMS provider adapter instance.

    Reads ``SMS_PROVIDER`` from Flask config.  Valid options:
    - ``"log"`` (default) — :class:`LogOnlySmsAdapter`
    - ``"webhook"`` — :class:`WebhookSmsAdapter`
    - ``"twilio"`` — :class:`TwilioSmsAdapter` (lazy import)
    """
    provider = str(current_app.config.get("SMS_PROVIDER", "log") or "log").strip().lower()

    if provider == "twilio":
        from .sms_twilio_adapter import TwilioSmsAdapter
        return TwilioSmsAdapter()

    if provider == "webhook":
        return WebhookSmsAdapter()

    # Default: log-only
    return LogOnlySmsAdapter()


def send_sms(to: str, body: str) -> dict[str, Any]:
    """Dispatch an SMS through the active provider."""
    provider = get_sms_provider()
    return provider.send_sms(to, body)
