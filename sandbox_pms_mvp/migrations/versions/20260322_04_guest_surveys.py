"""Create guest_surveys table for post-stay satisfaction surveys

Revision ID: 20260322_04
Revises: 20260322_03
Create Date: 2026-03-22 16:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "20260322_04"
down_revision = "20260322_03"


def upgrade() -> None:
    op.create_table(
        "guest_surveys",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("updated_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("reservation_id", sa.Uuid(), nullable=False),
        sa.Column("guest_id", sa.Uuid(), nullable=False),
        sa.Column("token", sa.String(64), nullable=False),
        sa.Column("rating", sa.Integer(), nullable=True),
        sa.Column("feedback", sa.Text(), nullable=True),
        sa.Column("category_ratings", sa.JSON(), nullable=True),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["reservation_id"], ["reservations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["guest_id"], ["guests.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["updated_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.CheckConstraint("rating IS NULL OR (rating >= 1 AND rating <= 5)", name="ck_guest_surveys_rating"),
    )
    with op.batch_alter_table("guest_surveys") as batch_op:
        batch_op.create_index("ix_guest_surveys_token", ["token"], unique=True)
        batch_op.create_index("ix_guest_surveys_reservation_id", ["reservation_id"])
        batch_op.create_index("ix_guest_surveys_guest_id", ["guest_id"])
        batch_op.create_index("ix_guest_surveys_submitted_at", ["submitted_at"])


def downgrade() -> None:
    op.drop_table("guest_surveys")
