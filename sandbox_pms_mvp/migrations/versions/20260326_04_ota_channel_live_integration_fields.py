"""Add live-integration readiness fields to ota_channels

Revision ID: 20260326_04
Revises: 20260326_03
Create Date: 2026-03-26 04:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "20260326_04"
down_revision = "20260326_03"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("ota_channels", schema=None) as batch_op:
        # Sync direction flags
        batch_op.add_column(sa.Column("sync_inventory_push", sa.Boolean, nullable=False, server_default=sa.text("false")))
        batch_op.add_column(sa.Column("sync_rate_push", sa.Boolean, nullable=False, server_default=sa.text("false")))
        batch_op.add_column(sa.Column("sync_restriction_push", sa.Boolean, nullable=False, server_default=sa.text("false")))
        batch_op.add_column(sa.Column("sync_reservation_pull", sa.Boolean, nullable=False, server_default=sa.text("false")))

        # Environment mode
        batch_op.add_column(sa.Column("environment_mode", sa.String(20), nullable=False, server_default=sa.text("'sandbox'")))
        batch_op.create_check_constraint("ck_ota_channels_environment_mode", "environment_mode IN ('sandbox', 'live')")

        # Onboarding progress timestamps
        batch_op.add_column(sa.Column("setup_completed_at", sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(sa.Column("activated_at", sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(sa.Column("last_successful_sync_at", sa.DateTime(timezone=True), nullable=True))


def downgrade():
    with op.batch_alter_table("ota_channels", schema=None) as batch_op:
        batch_op.drop_column("last_successful_sync_at")
        batch_op.drop_column("activated_at")
        batch_op.drop_column("setup_completed_at")
        batch_op.drop_constraint("ck_ota_channels_environment_mode", type_="check")
        batch_op.drop_column("environment_mode")
        batch_op.drop_column("sync_reservation_pull")
        batch_op.drop_column("sync_restriction_push")
        batch_op.drop_column("sync_rate_push")
        batch_op.drop_column("sync_inventory_push")
