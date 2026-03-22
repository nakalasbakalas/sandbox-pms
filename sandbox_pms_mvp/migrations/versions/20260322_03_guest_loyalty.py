"""Create guest_loyalties table for loyalty/membership tier tracking

Revision ID: 20260322_03
Revises: 20260322_02
Create Date: 2026-03-22 15:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "20260322_03"
down_revision = "20260322_02"

def upgrade() -> None:
    op.create_table(
        "guest_loyalties",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("created_by_user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("updated_by_user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("guest_id", sa.Uuid(), sa.ForeignKey("guests.id", ondelete="CASCADE"), unique=True, nullable=False),
        sa.Column("tier", sa.String(20), nullable=False, server_default="bronze"),
        sa.Column("points", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("enrolled_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("tier_updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("tier IN ('bronze', 'silver', 'gold', 'platinum')", name="ck_guest_loyalties_tier"),
        sa.CheckConstraint("points >= 0", name="ck_guest_loyalties_points"),
    )
    op.create_index("ix_guest_loyalties_guest_id", "guest_loyalties", ["guest_id"], unique=True)
    op.create_index("ix_guest_loyalties_tier", "guest_loyalties", ["tier"])


def downgrade() -> None:
    op.drop_table("guest_loyalties")
