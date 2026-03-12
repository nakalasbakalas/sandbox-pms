"""allow reservations without an assigned room

Revision ID: 20260312_03
Revises: 20260312_02
Create Date: 2026-03-12 18:10:00.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260312_03"
down_revision = "20260312_02"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("reservations") as batch_op:
        batch_op.alter_column(
            "assigned_room_id",
            existing_type=sa.Uuid(),
            nullable=True,
        )


def downgrade():
    op.execute(
        sa.text(
            """
            UPDATE reservations
            SET assigned_room_id = (
                SELECT rooms.id
                FROM rooms
                WHERE rooms.room_type_id = reservations.room_type_id
                ORDER BY rooms.room_number ASC
                LIMIT 1
            )
            WHERE assigned_room_id IS NULL
            """
        )
    )
    with op.batch_alter_table("reservations") as batch_op:
        batch_op.alter_column(
            "assigned_room_id",
            existing_type=sa.Uuid(),
            nullable=False,
        )
