from __future__ import annotations

import json
from time import perf_counter
from typing import Any

from flask import current_app
from .security import sanitize_log_data

def front_desk_board_v2_enabled() -> bool:
    """Legacy compatibility helper for the board action surface.

    The separate v2 rollout has been fully absorbed into the current planning
    board implementation, so the action endpoints now stay enabled.
    """
    return True


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
        "staff_front_desk_board_check_in",
        "staff_front_desk_board_check_out",
        "staff_front_desk_board_mark_room_ready",
        "staff_front_desk_board_reservation_panel",
    }
    return endpoint in v2_endpoints


def check_board_v2_feature_gate() -> None:
    """Legacy no-op retained so create_app() wiring does not need to branch."""
    return None
