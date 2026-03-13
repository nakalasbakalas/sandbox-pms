"""Add user_preferences table for storing user-specific UI preferences

Revision ID: 20260313_01
Revises: 20260312_03
Create Date: 2026-03-13 00:00:00.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260313_01"
down_revision = "20260312_03"
branch_labels = None
depends_on = None


UUID = sa.Uuid(as_uuid=True)
JSON = sa.JSON()


def _now_default() -> sa.TextClause:
    return sa.text("CURRENT_TIMESTAMP")


def upgrade():
    op.create_table(
        "user_preferences",
        sa.Column("user_id", UUID, nullable=False, primary_key=True),
        sa.Column("preferences", JSON, nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=_now_default()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=_now_default()),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            ondelete="CASCADE",
        ),
    )
    op.create_index(
        "ix_user_preferences_updated_at",
        "user_preferences",
        ["updated_at"],
        unique=False,
    )


def downgrade():
    op.drop_index("ix_user_preferences_updated_at", table_name="user_preferences")
    op.drop_table("user_preferences")
