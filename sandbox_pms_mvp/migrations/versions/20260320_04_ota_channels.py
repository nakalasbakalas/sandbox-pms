"""Add ota_channels table for OTA provider API key management

Revision ID: 20260320_04
Revises: 20260320_03
Create Date: 2026-03-20 20:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "20260320_04"
down_revision = "20260320_03"
branch_labels = None
depends_on = None

UUID = sa.Uuid(as_uuid=True)

OTA_PROVIDER_KEYS = "'booking_com','expedia','agoda'"


def upgrade():
    op.create_table(
        "ota_channels",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("created_by_user_id", UUID, sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("updated_by_user_id", UUID, sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by_user_id", UUID, sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("provider_key", sa.String(80), nullable=False),
        sa.Column("display_name", sa.String(120), nullable=False),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.text("false")),
        sa.Column("hotel_id", sa.String(120), nullable=True),
        sa.Column("endpoint_url", sa.String(500), nullable=True),
        sa.Column("api_key_encrypted", sa.Text, nullable=True),
        sa.Column("api_key_hint", sa.String(8), nullable=True),
        sa.Column("api_secret_encrypted", sa.Text, nullable=True),
        sa.Column("api_secret_hint", sa.String(8), nullable=True),
        sa.Column("last_tested_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_test_ok", sa.Boolean, nullable=True),
        sa.Column("last_test_error", sa.String(500), nullable=True),
        sa.CheckConstraint(
            f"provider_key IN ({OTA_PROVIDER_KEYS})",
            name="ck_ota_channels_provider_key",
        ),
        sa.UniqueConstraint("provider_key", name="uq_ota_channels_provider_key"),
    )
    op.create_index("ix_ota_channels_provider_active", "ota_channels", ["provider_key", "is_active"])


def downgrade():
    op.drop_index("ix_ota_channels_provider_active", table_name="ota_channels")
    op.drop_table("ota_channels")
