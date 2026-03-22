"""Add photos and floor_plan_url columns to rooms table

Revision ID: 20260322_05
Revises: 20260322_04
Create Date: 2026-03-22 17:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "20260322_05"
down_revision = "20260322_04"


def upgrade() -> None:
    with op.batch_alter_table("rooms") as batch_op:
        batch_op.add_column(sa.Column("photos", sa.JSON(), nullable=True))
        batch_op.add_column(sa.Column("floor_plan_url", sa.String(500), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("rooms") as batch_op:
        batch_op.drop_column("floor_plan_url")
        batch_op.drop_column("photos")
