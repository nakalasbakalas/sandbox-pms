from __future__ import annotations

from .models import User


def user_has_permission(user: User | None, permission_code: str) -> bool:
    return bool(user and user.has_permission(permission_code))


def can_manage_operational_overrides(user: User | None) -> bool:
    return user_has_permission(user, "operations.override")


def allowed_note_visibility_scopes(user: User | None) -> set[str]:
    if not user:
        return {"all_staff", "front_desk", "manager"}
    allowed: set[str] = set()
    allowed.add("all_staff")
    if user_has_permission(user, "reservation.view"):
        allowed.add("front_desk")
    if can_manage_operational_overrides(user):
        allowed.add("manager")
    return allowed


def default_dashboard_endpoint_for_user(user: User | None) -> str:
    if user and user.primary_role == "provider" and user.has_permission("provider.dashboard.view"):
        return "provider.provider_dashboard"
    if user_has_permission(user, "reservation.view"):
        return "front_desk.staff_dashboard"
    if user_has_permission(user, "housekeeping.view"):
        return "housekeeping.staff_housekeeping"
    if user_has_permission(user, "reports.view"):
        return "reports.staff_reports"
    return "auth.staff_security"
