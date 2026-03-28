"""add arrival_time and manual_discount to reservations

Revision ID: a1b2c3d4e5f6
Revises: f1a2b3c4d5e6
Create Date: 2026-03-28 06:00:00.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "a1b2c3d4e5f6"
down_revision = "f1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("reservations", sa.Column("arrival_time", sa.String(length=10), nullable=True))
    op.add_column(
        "reservations",
        sa.Column("manual_discount_pct", sa.Numeric(precision=5, scale=2), nullable=False, server_default="0"),
    )
    op.add_column("reservations", sa.Column("manual_discount_note", sa.String(length=255), nullable=True))


def downgrade():
    op.drop_column("reservations", "manual_discount_note")
    op.drop_column("reservations", "manual_discount_pct")
    op.drop_column("reservations", "arrival_time")
