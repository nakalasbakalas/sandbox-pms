"""Add auto_response_rules table

Revision ID: 20260322_07
Revises: 20260322_06
Create Date: 2026-03-22 20:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "20260322_07"
down_revision = "20260322_06"


def upgrade() -> None:
    op.create_table(
        "auto_response_rules",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_by_user_id", sa.Uuid(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("updated_by_user_id", sa.Uuid(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("trigger_keywords", sa.JSON, nullable=False),
        sa.Column("template_id", sa.Uuid(as_uuid=True), sa.ForeignKey("message_templates.id", ondelete="CASCADE"), nullable=False),
        sa.Column("channel", sa.String(50), nullable=False, server_default="email"),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.text("true")),
    )
    op.create_index("ix_auto_response_rules_is_active", "auto_response_rules", ["is_active"])


def downgrade() -> None:
    op.drop_index("ix_auto_response_rules_is_active", table_name="auto_response_rules")
    op.drop_table("auto_response_rules")
