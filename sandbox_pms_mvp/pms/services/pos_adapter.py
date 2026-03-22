"""POS (Point of Sale) integration adapter — outbound charge push.

Provides a pluggable adapter for pushing folio charges and voids back to
an external POS system.  The inbound webhook (``/api/integrations/pos/charges``)
already exists in the cashier blueprint; this module handles the *outbound*
direction.

Configuration:
    ``POS_ADAPTER`` — ``"null"`` (default), ``"webhook"``
    ``POS_WEBHOOK_URL`` — target URL for the webhook adapter
"""
from __future__ import annotations

import json
import logging
import urllib.error
import urllib.request
import uuid
from decimal import Decimal
from typing import Any, Protocol, runtime_checkable

from flask import current_app

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Protocol
# ---------------------------------------------------------------------------


@runtime_checkable
class PosAdapter(Protocol):
    """Interface for outbound POS integrations."""

    def post_charge(
        self,
        reservation_id: str,
        amount: Decimal,
        outlet_name: str,
        *,
        description: str = "",
        external_check_id: str = "",
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Post a charge to the external POS.

        Returns ``{"ok": True, ...}`` on success or ``{"ok": False, "error": ...}`` on failure.
        """
        ...

    def void_charge(self, charge_id: str) -> dict[str, Any]:
        """Void a previously posted charge in the external POS."""
        ...

    def list_open_checks(self, outlet_id: str) -> dict[str, Any]:
        """List open checks/tabs for an outlet in the external POS."""
        ...


# ---------------------------------------------------------------------------
# Implementations
# ---------------------------------------------------------------------------


class NullPosAdapter:
    """No-op POS adapter — logs only, returns stubs."""

    def post_charge(
        self,
        reservation_id: str,
        amount: Decimal,
        outlet_name: str,
        *,
        description: str = "",
        external_check_id: str = "",
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        stub_id = f"null-pos-{uuid.uuid4().hex[:12]}"
        logger.info(
            "NullPosAdapter.post_charge: res=%s amount=%s outlet=%s (stub_id=%s)",
            reservation_id, amount, outlet_name, stub_id,
        )
        return {"ok": True, "charge_id": stub_id, "mock": True}

    def void_charge(self, charge_id: str) -> dict[str, Any]:
        logger.info("NullPosAdapter.void_charge: charge_id=%s (stub)", charge_id)
        return {"ok": True, "mock": True}

    def list_open_checks(self, outlet_id: str) -> dict[str, Any]:
        logger.info("NullPosAdapter.list_open_checks: outlet_id=%s (stub)", outlet_id)
        return {"ok": True, "checks": [], "mock": True}


class WebhookPosAdapter:
    """Forward POS operations to ``POS_WEBHOOK_URL``."""

    def _webhook_url(self) -> str:
        return str(current_app.config.get("POS_WEBHOOK_URL", "") or "").strip()

    def _post_json(self, action: str, payload: dict[str, Any]) -> dict[str, Any]:
        webhook_url = self._webhook_url()
        if not webhook_url:
            logger.warning("WebhookPosAdapter: POS_WEBHOOK_URL is not configured")
            return {"ok": False, "error": "POS_WEBHOOK_URL is not configured."}

        body = json.dumps({"action": action, **payload}).encode("utf-8")
        req = urllib.request.Request(
            webhook_url,
            data=body,
            method="POST",
            headers={"Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(req, timeout=15) as response:  # noqa: S310
                response_body = response.read().decode("utf-8", errors="ignore")
                try:
                    data = json.loads(response_body)
                except (json.JSONDecodeError, ValueError):
                    data = {"raw": response_body[:500]}
                return {"ok": True, **data}
        except urllib.error.HTTPError as exc:
            error_body = ""
            try:
                error_body = exc.read().decode("utf-8", errors="ignore")[:500]
            except Exception:
                pass
            return {"ok": False, "error": f"HTTP {exc.code}: {error_body}"}
        except urllib.error.URLError as exc:
            return {"ok": False, "error": str(exc)[:500]}

    def post_charge(
        self,
        reservation_id: str,
        amount: Decimal,
        outlet_name: str,
        *,
        description: str = "",
        external_check_id: str = "",
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        return self._post_json("post_charge", {
            "reservation_id": reservation_id,
            "amount": str(amount),
            "outlet_name": outlet_name,
            "description": description,
            "external_check_id": external_check_id,
            "metadata": metadata or {},
        })

    def void_charge(self, charge_id: str) -> dict[str, Any]:
        return self._post_json("void_charge", {"charge_id": charge_id})

    def list_open_checks(self, outlet_id: str) -> dict[str, Any]:
        return self._post_json("list_open_checks", {"outlet_id": outlet_id})


# ---------------------------------------------------------------------------
# Factory
# ---------------------------------------------------------------------------


def get_pos_adapter() -> PosAdapter:
    """Return the configured POS adapter instance.

    Reads ``POS_ADAPTER`` from Flask config.  Valid options:
    - ``"null"`` (default) — :class:`NullPosAdapter`
    - ``"webhook"`` — :class:`WebhookPosAdapter`
    """
    adapter_name = str(current_app.config.get("POS_ADAPTER", "null") or "null").strip().lower()

    if adapter_name == "webhook":
        return WebhookPosAdapter()

    return NullPosAdapter()
