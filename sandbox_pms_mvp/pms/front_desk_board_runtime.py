from __future__ import annotations

import json
from time import perf_counter
from typing import Any

from flask import current_app

from .pricing import get_setting_value
from .security import sanitize_log_data


FRONT_DESK_BOARD_V2_SETTING_KEY = "feature.front_desk_board_v2"


def front_desk_board_v2_enabled() -> bool:
    configured_default = bool(current_app.config.get("FEATURE_BOARD_V2", False))
    try:
        stored_value = get_setting_value(FRONT_DESK_BOARD_V2_SETTING_KEY, configured_default)
    except Exception:  # noqa: BLE001
        return configured_default
    if isinstance(stored_value, dict):
        stored_value = stored_value.get("enabled", configured_default)
    return _truthy_flag(stored_value)


def log_front_desk_board_metric(
    *,
    event: str,
    started_at: float,
    board: dict[str, Any] | None = None,
    **fields: Any,
) -> None:
    payload: dict[str, Any] = {
        "event": event,
        "duration_ms": round((perf_counter() - started_at) * 1000, 2),
        **sanitize_log_data(fields),
    }
    payload.setdefault("board_v2_enabled", front_desk_board_v2_enabled())
    if board is not None:
        payload.update(_board_summary(board))
    current_app.logger.info(json.dumps(payload, ensure_ascii=False, default=str))


def _board_summary(board: dict[str, Any]) -> dict[str, int]:
    groups = board.get("groups", [])
    rows = [row for group in groups for row in group.get("rows", [])]
    return {
        "group_count": len(groups),
        "row_count": len(rows),
        "visible_block_count": sum(len(row.get("visible_blocks", [])) for row in rows),
    }


def _truthy_flag(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    return str(value or "").strip().lower() in {"1", "true", "on", "yes"}


def is_v2_endpoint(endpoint: str | None) -> bool:
    """Check if a Flask endpoint is a v2-only endpoint.

    Args:
        endpoint: Flask request.endpoint value

    Returns:
        True if the endpoint is a v2-only feature
    """
    if not endpoint:
        return False

    v2_endpoints = {
        "staff_front_desk_board_events",
        "staff_front_desk_board_check_in",
        "staff_front_desk_board_check_out",
        "staff_front_desk_board_mark_room_ready",
        "staff_front_desk_board_reservation_panel",
    }
    return endpoint in v2_endpoints


def check_board_v2_feature_gate() -> None:
    """Raise 404 if v2 endpoint is accessed but feature is disabled.

    This should be registered as a before_request hook.
    """
    from flask import request, abort

    if request.endpoint and is_v2_endpoint(request.endpoint):
        if not front_desk_board_v2_enabled():
            abort(404)
