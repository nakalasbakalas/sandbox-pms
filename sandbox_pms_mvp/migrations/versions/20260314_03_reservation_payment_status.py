"""Add payment_status column to reservations

Revision ID: 20260314_03
Revises: 20260314_02
Create Date: 2026-03-14 08:00:00.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260314_03"
down_revision = "20260314_02"
branch_labels = None
depends_on = None

PAYMENT_STATUSES = (
    "unpaid", "partially_paid", "paid", "deposit_required",
    "deposit_received", "overpaid", "refunded", "failed",
    "pending", "voided",
)


def upgrade() -> None:
    with op.batch_alter_table("reservations", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("payment_status", sa.String(30), nullable=False, server_default="unpaid"),
        )
        batch_op.create_check_constraint(
            "ck_reservations_payment_status",
            f"payment_status IN ({', '.join(repr(v) for v in PAYMENT_STATUSES)})",
        )
        batch_op.create_index("ix_reservations_payment_status", ["payment_status"])


def downgrade() -> None:
    with op.batch_alter_table("reservations", schema=None) as batch_op:
        batch_op.drop_index("ix_reservations_payment_status")
        batch_op.drop_constraint("ck_reservations_payment_status", type_="check")
        batch_op.drop_column("payment_status")
