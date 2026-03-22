"""Add shift column to housekeeping_tasks table

Revision ID: 20260322_06
Revises: 20260322_05
Create Date: 2026-03-22 18:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "20260322_06"
down_revision = "20260322_05"


def upgrade() -> None:
    with op.batch_alter_table("housekeeping_tasks") as batch_op:
        batch_op.add_column(sa.Column("shift", sa.String(20), nullable=True))
        batch_op.create_index("ix_housekeeping_tasks_shift", ["shift"])


def downgrade() -> None:
    with op.batch_alter_table("housekeeping_tasks") as batch_op:
        batch_op.drop_index("ix_housekeeping_tasks_shift")
        batch_op.drop_column("shift")
