"""Add external_booking_id to reservations and channel_sync_logs table.

Revision ID: 20260328_02
Revises: 20260328_01
Create Date: 2026-03-28 16:00:00.000000
"""

from __future__ import annotations

import uuid

import sqlalchemy as sa
from alembic import op


revision = "20260328_02"
down_revision = "20260328_01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # -- Reservation: add external booking tracking columns --
    op.add_column("reservations", sa.Column("external_booking_id", sa.String(255), nullable=True))
    op.add_column("reservations", sa.Column("external_source", sa.String(80), nullable=True))
    op.create_index(
        "ix_reservations_external_booking",
        "reservations",
        ["external_booking_id", "external_source"],
        unique=True,
        postgresql_where=sa.text("external_booking_id IS NOT NULL"),
    )

    # -- Channel sync log table --
    op.create_table(
        "channel_sync_logs",
        sa.Column("id", sa.Uuid(), primary_key=True, default=uuid.uuid4),
        sa.Column("provider_key", sa.String(80), nullable=False),
        sa.Column("direction", sa.String(20), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("records_processed", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("records_failed", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("status", sa.String(20), nullable=False, server_default="success"),
        sa.Column("error_summary", sa.Text(), nullable=True),
        sa.Column("details", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("created_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("updated_by_user_id", sa.Uuid(), nullable=True),
        sa.CheckConstraint(
            "direction IN ('inbound', 'outbound')",
            name="ck_channel_sync_logs_direction",
        ),
        sa.CheckConstraint(
            "status IN ('success', 'partial', 'failed')",
            name="ck_channel_sync_logs_status",
        ),
        sa.CheckConstraint("records_processed >= 0", name="ck_channel_sync_logs_processed"),
        sa.CheckConstraint("records_failed >= 0", name="ck_channel_sync_logs_failed"),
    )
    op.create_index("ix_channel_sync_logs_provider_started", "channel_sync_logs", ["provider_key", "started_at"])


def downgrade() -> None:
    op.drop_table("channel_sync_logs")
    op.drop_index("ix_reservations_external_booking", table_name="reservations")
    op.drop_column("reservations", "external_source")
    op.drop_column("reservations", "external_booking_id")
