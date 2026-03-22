"""Add blacklist_reason, blacklisted_at, blacklisted_by_user_id to guests table

Revision ID: 20260322_01
Revises: 20260320_04
Create Date: 2026-03-22 12:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "20260322_01"
down_revision = "20260320_04"


def upgrade() -> None:
    with op.batch_alter_table("guests") as batch_op:
        batch_op.add_column(
            sa.Column("blacklist_reason", sa.Text(), nullable=True)
        )
        batch_op.add_column(
            sa.Column("blacklisted_at", sa.DateTime(), nullable=True)
        )
        batch_op.add_column(
            sa.Column("blacklisted_by_user_id", sa.Uuid(), nullable=True)
        )
        batch_op.create_foreign_key(
            "fk_guests_blacklisted_by_user_id",
            "users",
            ["blacklisted_by_user_id"],
            ["id"],
            ondelete="SET NULL",
        )


def downgrade() -> None:
    with op.batch_alter_table("guests") as batch_op:
        batch_op.drop_constraint("fk_guests_blacklisted_by_user_id", type_="foreignkey")
        batch_op.drop_column("blacklisted_by_user_id")
        batch_op.drop_column("blacklisted_at")
        batch_op.drop_column("blacklist_reason")
