"""rbac least privilege rebalance

Revision ID: 20260316_02
Revises: 20260316_01
Create Date: 2026-03-16 06:20:00.000000
"""

from __future__ import annotations

from datetime import datetime, timezone
import uuid

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "20260316_02"
down_revision = "20260316_01"
branch_labels = None
depends_on = None

_NEW_PERMISSION = (
    "operations.override",
    "Manage operational overrides",
    "Manage manager-level room closures and operational override controls",
    "operations",
)

_OLD_ROLE_PERMISSION_SEEDS = {
    "admin": [
        "reservation.view",
        "reservation.create",
        "reservation.edit",
        "reservation.cancel",
        "reservation.check_in",
        "reservation.check_out",
        "rate_rule.view",
        "rate_rule.edit",
        "folio.view",
        "folio.charge_add",
        "folio.adjust",
        "payment.read",
        "payment.create",
        "payment.refund",
        "payment_request.create",
        "provider.dashboard.view",
        "provider.booking.view",
        "provider.booking.cancel",
        "provider.payment_request.create",
        "provider.calendar.view",
        "provider.calendar.manage",
        "housekeeping.view",
        "housekeeping.status_change",
        "housekeeping.task_manage",
        "reports.view",
        "settings.view",
        "settings.edit",
        "user.view",
        "user.create",
        "user.edit",
        "user.disable",
        "audit.view",
        "auth.manage_mfa",
        "auth.reset_password_admin",
        "messaging.view",
        "messaging.send",
        "messaging.manage",
    ],
    "manager": [
        "reservation.view",
        "reservation.create",
        "reservation.edit",
        "reservation.cancel",
        "reservation.check_in",
        "reservation.check_out",
        "rate_rule.view",
        "rate_rule.edit",
        "folio.view",
        "folio.charge_add",
        "folio.adjust",
        "payment.read",
        "payment.create",
        "payment.refund",
        "payment_request.create",
        "provider.dashboard.view",
        "provider.booking.view",
        "provider.booking.cancel",
        "provider.payment_request.create",
        "provider.calendar.view",
        "provider.calendar.manage",
        "housekeeping.view",
        "housekeeping.status_change",
        "housekeeping.task_manage",
        "reports.view",
        "settings.view",
        "settings.edit",
        "user.view",
        "user.create",
        "user.edit",
        "user.disable",
        "audit.view",
        "auth.manage_mfa",
        "auth.reset_password_admin",
    ],
    "front_desk": [
        "reservation.view",
        "reservation.create",
        "reservation.edit",
        "reservation.check_in",
        "reservation.check_out",
        "folio.view",
        "folio.charge_add",
        "payment.read",
        "payment.create",
        "payment_request.create",
        "housekeeping.view",
        "housekeeping.status_change",
        "messaging.view",
        "messaging.send",
        "housekeeping.task_manage",
    ],
    "housekeeping": [
        "reservation.view",
        "housekeeping.view",
        "housekeeping.status_change",
        "housekeeping.task_manage",
    ],
    "provider": [
        "provider.dashboard.view",
        "provider.booking.view",
        "provider.booking.cancel",
        "provider.payment_request.create",
        "provider.calendar.view",
        "provider.calendar.manage",
    ],
}

_NEW_ROLE_PERMISSION_SEEDS = {
    "admin": [*_OLD_ROLE_PERMISSION_SEEDS["admin"], "operations.override"],
    "manager": [
        "reservation.view",
        "reservation.create",
        "reservation.edit",
        "reservation.cancel",
        "reservation.check_in",
        "reservation.check_out",
        "folio.view",
        "folio.charge_add",
        "folio.adjust",
        "payment.read",
        "payment.create",
        "payment.refund",
        "payment_request.create",
        "housekeeping.view",
        "housekeeping.status_change",
        "housekeeping.task_manage",
        "operations.override",
        "reports.view",
        "messaging.view",
        "messaging.send",
    ],
    "front_desk": [
        "reservation.view",
        "reservation.create",
        "reservation.edit",
        "reservation.check_in",
        "reservation.check_out",
        "folio.view",
        "folio.charge_add",
        "payment.read",
        "payment.create",
        "payment_request.create",
        "housekeeping.view",
        "messaging.view",
        "messaging.send",
    ],
    "housekeeping": [
        "housekeeping.view",
        "housekeeping.status_change",
        "housekeeping.task_manage",
    ],
    "provider": _OLD_ROLE_PERMISSION_SEEDS["provider"],
}

permissions = sa.table(
    "permissions",
    sa.column("id", sa.Uuid()),
    sa.column("code", sa.String(length=120)),
    sa.column("name", sa.String(length=120)),
    sa.column("description", sa.String(length=255)),
    sa.column("module", sa.String(length=80)),
    sa.column("created_at", sa.DateTime(timezone=True)),
    sa.column("updated_at", sa.DateTime(timezone=True)),
    sa.column("created_by_user_id", sa.Uuid()),
    sa.column("updated_by_user_id", sa.Uuid()),
)
roles = sa.table(
    "roles",
    sa.column("id", sa.Uuid()),
    sa.column("code", sa.String(length=80)),
)
role_permissions = sa.table(
    "role_permissions",
    sa.column("role_id", sa.Uuid()),
    sa.column("permission_id", sa.Uuid()),
)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _ensure_permission(connection) -> dict[str, uuid.UUID]:
    existing = connection.execute(sa.select(permissions.c.id, permissions.c.code)).all()
    by_code = {row[1]: row[0] for row in existing}
    code, name, description, module = _NEW_PERMISSION
    if code not in by_code:
        permission_id = uuid.uuid4()
        now = _utc_now()
        connection.execute(
            permissions.insert().values(
                id=permission_id,
                code=code,
                name=name,
                description=description,
                module=module,
                created_at=now,
                updated_at=now,
                created_by_user_id=None,
                updated_by_user_id=None,
            )
        )
        by_code[code] = permission_id
    return by_code


def _sync_role_permissions(connection, desired_mapping: dict[str, list[str]]) -> None:
    permission_ids = _ensure_permission(connection)
    role_ids = {row[1]: row[0] for row in connection.execute(sa.select(roles.c.id, roles.c.code)).all()}
    for role_code, permission_codes in desired_mapping.items():
        role_id = role_ids.get(role_code)
        if role_id is None:
            continue
        desired_ids = {permission_ids[code] for code in permission_codes if code in permission_ids}
        connection.execute(role_permissions.delete().where(role_permissions.c.role_id == role_id))
        for permission_id in desired_ids:
            connection.execute(role_permissions.insert().values(role_id=role_id, permission_id=permission_id))


def upgrade():
    _sync_role_permissions(op.get_bind(), _NEW_ROLE_PERMISSION_SEEDS)


def downgrade():
    connection = op.get_bind()
    _sync_role_permissions(connection, _OLD_ROLE_PERMISSION_SEEDS)
    permission_id = connection.execute(
        sa.select(permissions.c.id).where(permissions.c.code == _NEW_PERMISSION[0])
    ).scalar_one_or_none()
    if permission_id is not None:
        connection.execute(role_permissions.delete().where(role_permissions.c.permission_id == permission_id))
        connection.execute(permissions.delete().where(permissions.c.id == permission_id))
