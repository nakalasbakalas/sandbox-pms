"""seed employee accounts

Revision ID: 20260316_01
Revises: 20260314_03
Create Date: 2026-03-16 02:10:00.000000

"""

from __future__ import annotations

from datetime import datetime, timezone
import uuid

import sqlalchemy as sa
from alembic import op
from argon2 import PasswordHasher

from pms.config import Config

# revision identifiers, used by Alembic.
revision = "20260316_01"
down_revision = "20260314_03"
branch_labels = None
depends_on = None

_EMPLOYEE_ACCOUNTS = (
    {"username": "hui.admin", "password": "6astxSjtq9RF", "full_name": "Hui", "role_code": "admin"},
    {"username": "manager", "password": "jyVCLAzMXL6U", "full_name": "Manager", "role_code": "manager"},
    {"username": "housekeeping", "password": "X3Hp9bnTdKTn", "full_name": "Housekeeping", "role_code": "housekeeping"},
    {"username": "frontdesk", "password": "3Y5vyMujqXwU", "full_name": "Front Desk", "role_code": "front_desk"},
)

users = sa.table(
    "users",
    sa.column("id", sa.Uuid()),
    sa.column("created_at", sa.DateTime(timezone=True)),
    sa.column("updated_at", sa.DateTime(timezone=True)),
    sa.column("created_by_user_id", sa.Uuid()),
    sa.column("updated_by_user_id", sa.Uuid()),
    sa.column("deleted_at", sa.DateTime(timezone=True)),
    sa.column("deleted_by_user_id", sa.Uuid()),
    sa.column("username", sa.String(length=80)),
    sa.column("email", sa.String(length=255)),
    sa.column("full_name", sa.String(length=255)),
    sa.column("password_hash", sa.String(length=255)),
    sa.column("is_active", sa.Boolean()),
    sa.column("account_state", sa.String(length=40)),
    sa.column("last_login_at", sa.DateTime(timezone=True)),
    sa.column("failed_login_count", sa.Integer()),
    sa.column("last_failed_login_at", sa.DateTime(timezone=True)),
    sa.column("locked_until", sa.DateTime(timezone=True)),
    sa.column("force_password_reset", sa.Boolean()),
    sa.column("password_changed_at", sa.DateTime(timezone=True)),
    sa.column("mfa_required", sa.Boolean()),
)
roles = sa.table(
    "roles",
    sa.column("id", sa.Uuid()),
    sa.column("code", sa.String(length=80)),
)
user_roles = sa.table(
    "user_roles",
    sa.column("user_id", sa.Uuid()),
    sa.column("role_id", sa.Uuid()),
)


def _password_hasher() -> PasswordHasher:
    return PasswordHasher(
        time_cost=Config.ARGON2_TIME_COST,
        memory_cost=Config.ARGON2_MEMORY_COST,
        parallelism=Config.ARGON2_PARALLELISM,
        hash_len=Config.ARGON2_HASH_LEN,
    )


def _hash_password(password: str) -> str:
    return _password_hasher().hash(password)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _placeholder_email(username: str) -> str:
    return f"{username}@internal.sandbox.local"


def _unique_placeholder_email(existing_emails: set[str], username: str) -> str:
    local, domain = _placeholder_email(username).split("@", 1)
    candidate = f"{local}@{domain}"
    suffix = 1
    while candidate.lower() in existing_emails:
        candidate = f"{local}+{suffix}@{domain}"
        suffix += 1
    existing_emails.add(candidate.lower())
    return candidate


def upgrade():
    connection = op.get_bind()
    role_rows = connection.execute(sa.select(roles.c.id, roles.c.code)).mappings().all()
    role_ids = {row["code"]: row["id"] for row in role_rows}
    if not role_ids:
        return

    usernames = [item["username"] for item in _EMPLOYEE_ACCOUNTS]
    placeholder_emails = [_placeholder_email(item["username"]) for item in _EMPLOYEE_ACCOUNTS]
    existing_rows = connection.execute(
        sa.select(
            users.c.id,
            users.c.username,
            users.c.email,
        ).where(
            sa.or_(
                sa.func.lower(users.c.username).in_([value.lower() for value in usernames]),
                sa.func.lower(users.c.email).in_([value.lower() for value in placeholder_emails]),
            )
        )
    ).mappings().all()
    users_by_username = {
        str(row["username"]).lower(): row
        for row in existing_rows
        if row["username"]
    }
    users_by_email = {
        str(row["email"]).lower(): row
        for row in existing_rows
        if row["email"]
    }
    existing_emails = {
        str(row[0]).lower()
        for row in connection.execute(sa.select(users.c.email)).all()
        if row[0]
    }
    existing_pairs = {
        (row[0], row[1])
        for row in connection.execute(sa.select(user_roles.c.user_id, user_roles.c.role_id)).all()
    }
    now = _utc_now()

    for account in _EMPLOYEE_ACCOUNTS:
        role_id = role_ids.get(account["role_code"])
        if role_id is None:
            continue

        account_row = users_by_username.get(account["username"])
        if account_row is None:
            account_row = users_by_email.get(_placeholder_email(account["username"]).lower())

        if account_row is None:
            user_id = uuid.uuid4()
            connection.execute(
                users.insert().values(
                    id=user_id,
                    created_at=now,
                    updated_at=now,
                    created_by_user_id=None,
                    updated_by_user_id=None,
                    deleted_at=None,
                    deleted_by_user_id=None,
                    username=account["username"],
                    email=_unique_placeholder_email(existing_emails, account["username"]),
                    full_name=account["full_name"],
                    password_hash=_hash_password(account["password"]),
                    is_active=True,
                    account_state="active",
                    last_login_at=None,
                    failed_login_count=0,
                    last_failed_login_at=None,
                    locked_until=None,
                    force_password_reset=False,
                    password_changed_at=now,
                    mfa_required=False,
                )
            )
        else:
            user_id = account_row["id"]
            connection.execute(
                users.update()
                .where(users.c.id == user_id)
                .values(
                    username=account["username"],
                    full_name=account["full_name"],
                    is_active=True,
                    account_state="active",
                    failed_login_count=0,
                    last_failed_login_at=None,
                    locked_until=None,
                    force_password_reset=False,
                    mfa_required=False,
                    updated_at=now,
                )
            )

        if (user_id, role_id) not in existing_pairs:
            connection.execute(user_roles.insert().values(user_id=user_id, role_id=role_id))
            existing_pairs.add((user_id, role_id))


def downgrade():
    pass
