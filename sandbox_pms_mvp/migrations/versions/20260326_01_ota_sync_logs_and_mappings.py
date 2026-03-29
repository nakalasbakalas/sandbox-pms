"""Add ota_sync_logs and ota_room_type_mappings tables

Revision ID: 20260326_01
Revises: 20260322_08
Create Date: 2026-03-26 03:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "20260326_01"
down_revision = "20260328_02"
branch_labels = None
depends_on = None

UUID = sa.Uuid(as_uuid=True)


def upgrade():
    # OTA sync log table
    op.create_table(
        "ota_sync_logs",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("created_by_user_id", UUID, sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("updated_by_user_id", UUID, sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("provider_key", sa.String(80), nullable=False),
        sa.Column("direction", sa.String(20), nullable=False),
        sa.Column("action", sa.String(40), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("records_processed", sa.Integer, nullable=False, server_default=sa.text("0")),
        sa.Column("error_summary", sa.Text, nullable=True),
        sa.Column("details_json", sa.JSON, nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("duration_ms", sa.Integer, nullable=True),
    )
    op.create_index("ix_ota_sync_logs_provider_status", "ota_sync_logs", ["provider_key", "status"])
    op.create_index("ix_ota_sync_logs_created", "ota_sync_logs", ["created_at"])

    # OTA room type mapping table
    op.create_table(
        "ota_room_type_mappings",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("created_by_user_id", UUID, sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("updated_by_user_id", UUID, sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by_user_id", UUID, sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("provider_key", sa.String(80), nullable=False),
        sa.Column("room_type_id", UUID, sa.ForeignKey("room_types.id", ondelete="CASCADE"), nullable=False),
        sa.Column("external_room_type_code", sa.String(120), nullable=False),
        sa.Column("external_room_type_name", sa.String(200), nullable=True),
        sa.Column("external_rate_plan_code", sa.String(120), nullable=True),
        sa.Column("external_rate_plan_name", sa.String(200), nullable=True),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.text("true")),
        sa.Column("occupancy_default", sa.Integer, nullable=True),
        sa.Column("notes", sa.Text, nullable=True),
        sa.UniqueConstraint("provider_key", "room_type_id", "external_room_type_code", name="uq_ota_mapping_provider_room_ext"),
    )
    op.create_index("ix_ota_mapping_provider_active", "ota_room_type_mappings", ["provider_key", "is_active"])


def downgrade():
    op.drop_index("ix_ota_mapping_provider_active", table_name="ota_room_type_mappings")
    op.drop_table("ota_room_type_mappings")
    op.drop_index("ix_ota_sync_logs_created", table_name="ota_sync_logs")
    op.drop_index("ix_ota_sync_logs_provider_status", table_name="ota_sync_logs")
    op.drop_table("ota_sync_logs")
