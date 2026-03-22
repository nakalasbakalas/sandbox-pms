"""Add next_retry_at to notification_deliveries and 'retry' status for exponential backoff

Revision ID: 20260322_02
Revises: 20260322_01
Create Date: 2026-03-22 13:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "20260322_02"
down_revision = "20260322_01"

NEW_STATUSES = "status IN ('pending', 'queued', 'sent', 'delivered', 'failed', 'retry', 'skipped', 'cancelled')"
OLD_STATUSES = "status IN ('pending', 'queued', 'sent', 'delivered', 'failed', 'skipped', 'cancelled')"


def upgrade() -> None:
    with op.batch_alter_table("notification_deliveries") as batch_op:
        batch_op.add_column(
            sa.Column("next_retry_at", sa.DateTime(timezone=True), nullable=True)
        )
        batch_op.drop_constraint("ck_notification_deliveries_status", type_="check")
        batch_op.create_check_constraint("ck_notification_deliveries_status", NEW_STATUSES)


def downgrade() -> None:
    # Move any 'retry' rows back to 'failed' before removing the status
    op.execute("UPDATE notification_deliveries SET status = 'failed' WHERE status = 'retry'")
    with op.batch_alter_table("notification_deliveries") as batch_op:
        batch_op.drop_constraint("ck_notification_deliveries_status", type_="check")
        batch_op.create_check_constraint("ck_notification_deliveries_status", OLD_STATUSES)
        batch_op.drop_column("next_retry_at")
