from __future__ import annotations

from copy import deepcopy
from typing import Any

BOARD_DENSITY_OPTIONS = ("comfortable", "compact", "spacious", "ultra")
BOARD_FILTER_OPTIONS = (
    "arrival",
    "departure",
    "in-house",
    "stayover",
    "dirty",
    "vacant",
    "unallocated",
    "balance-due",
    "conflict",
    "maintenance",
    "inspected",
    "ready-arrival",
    "blocked-arrival",
    "special-request",
)
BOARD_ROLE_VIEW_OPTIONS = ("front-desk", "housekeeping", "allocation", "night-shift", "arrivals")

BOARD_STATE_VERSION = 2


def default_front_desk_board_state() -> dict[str, Any]:
    return {
        "version": BOARD_STATE_VERSION,
        "density": "compact",
        "activeRoleView": "",
        "activeFilters": [],
        "defaultQuickFilters": [],
        "hkOverlay": False,
        "collapsedGroups": [],
        "toolbarCollapsed": False,
        "savedViews": [],
    }


def normalize_front_desk_board_state(payload: dict[str, Any] | None, *, base: dict[str, Any] | None = None) -> dict[str, Any]:
    state = deepcopy(base or default_front_desk_board_state())
    candidate = payload or {}

    density = candidate.get("density", state["density"])
    if density not in BOARD_DENSITY_OPTIONS:
        raise ValueError("Invalid density value")
    state["density"] = density

    active_role_view = str(candidate.get("activeRoleView", state["activeRoleView"]) or "").strip()
    if active_role_view and active_role_view not in BOARD_ROLE_VIEW_OPTIONS:
        raise ValueError("Invalid activeRoleView value")
    state["activeRoleView"] = active_role_view

    state["activeFilters"] = _normalize_string_list(
        candidate.get("activeFilters", state["activeFilters"]),
        allowed_values=set(BOARD_FILTER_OPTIONS),
        error_message="Invalid activeFilters value",
    )
    state["defaultQuickFilters"] = _normalize_string_list(
        candidate.get("defaultQuickFilters", state["defaultQuickFilters"]),
        allowed_values=set(BOARD_FILTER_OPTIONS),
        error_message="Invalid defaultQuickFilters value",
    )
    state["collapsedGroups"] = _normalize_string_list(
        candidate.get("collapsedGroups", state["collapsedGroups"]),
        max_length=40,
        error_message="Invalid collapsedGroups value",
    )

    hk_overlay = candidate.get("hkOverlay", state["hkOverlay"])
    toolbar_collapsed = candidate.get("toolbarCollapsed", state["toolbarCollapsed"])
    state["hkOverlay"] = bool(hk_overlay)
    state["toolbarCollapsed"] = bool(toolbar_collapsed)

    saved_views = candidate.get("savedViews", state.get("savedViews", []))
    if saved_views is None:
        saved_views = []
    if not isinstance(saved_views, list):
        raise ValueError("Invalid savedViews value")
    normalized_views: list[dict[str, Any]] = []
    for raw_view in saved_views[:8]:
        if not isinstance(raw_view, dict):
            raise ValueError("Invalid savedViews value")
        view_name = str(raw_view.get("name", "")).strip()
        if not view_name:
            continue
        normalized_views.append(
            {
                "name": view_name[:40],
                "filters": _normalize_string_list(
                    raw_view.get("filters", []),
                    allowed_values=set(BOARD_FILTER_OPTIONS),
                    error_message="Invalid savedViews value",
                ),
                "hkOverlay": bool(raw_view.get("hkOverlay", False)),
                "activeRoleView": (
                    str(raw_view.get("activeRoleView", "") or "").strip()
                    if str(raw_view.get("activeRoleView", "") or "").strip() in BOARD_ROLE_VIEW_OPTIONS
                    else ""
                ),
            }
        )
    state["savedViews"] = normalized_views
    state["version"] = BOARD_STATE_VERSION
    return state


def extract_front_desk_board_state(preferences: dict[str, Any] | None) -> dict[str, Any]:
    board_state = (preferences or {}).get("frontDeskBoard")
    if isinstance(board_state, dict):
        return normalize_front_desk_board_state(board_state)
    return default_front_desk_board_state()


def merge_front_desk_board_state(
    existing_preferences: dict[str, Any] | None,
    payload: dict[str, Any] | None,
) -> dict[str, Any]:
    existing_state = extract_front_desk_board_state(existing_preferences)
    candidate = payload or {}
    if "state" in candidate and isinstance(candidate["state"], dict):
        candidate = {**candidate, **candidate["state"]}
    return normalize_front_desk_board_state(candidate, base=existing_state)


def _normalize_string_list(
    value: Any,
    *,
    allowed_values: set[str] | None = None,
    max_length: int = 20,
    error_message: str,
) -> list[str]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise ValueError(error_message)
    normalized: list[str] = []
    seen: set[str] = set()
    for raw_item in value[:max_length]:
        item = str(raw_item or "").strip()
        if not item:
            continue
        if allowed_values is not None and item not in allowed_values:
            raise ValueError(error_message)
        if item in seen:
            continue
        seen.add(item)
        normalized.append(item)
    return normalized
