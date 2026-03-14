"""Add housekeeping_tasks table and cleaning_in_progress status

Revision ID: 20260314_02
Revises: 20260314_01
Create Date: 2026-03-14 07:00:00.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260314_02"
down_revision = "20260314_01"
branch_labels = None
depends_on = None

UUID = sa.Uuid(as_uuid=True)

TASK_TYPES = ("checkout_clean", "daily_service", "rush_clean", "deep_clean", "inspection", "turndown")
TASK_PRIORITIES = ("low", "normal", "high", "urgent")
TASK_STATUSES = ("open", "assigned", "in_progress", "completed", "inspected", "cancelled")


def upgrade() -> None:
    op.create_table(
        "housekeeping_tasks",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("room_id", UUID, sa.ForeignKey("rooms.id", ondelete="CASCADE"), nullable=False),
        sa.Column("reservation_id", UUID, sa.ForeignKey("reservations.id", ondelete="SET NULL"), nullable=True),
        sa.Column("task_type", sa.String(40), nullable=False, server_default="checkout_clean"),
        sa.Column("priority", sa.String(20), nullable=False, server_default="normal"),
        sa.Column("status", sa.String(20), nullable=False, server_default="open"),
        sa.Column("assigned_to_user_id", UUID, sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("due_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("verified_by_user_id", UUID, sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("verified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("notes", sa.Text, nullable=True),
        sa.Column("business_date", sa.Date, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("created_by_user_id", UUID, sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("updated_by_user_id", UUID, sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.CheckConstraint(
            f"task_type IN ({', '.join(repr(v) for v in TASK_TYPES)})",
            name="ck_housekeeping_tasks_task_type",
        ),
        sa.CheckConstraint(
            f"priority IN ({', '.join(repr(v) for v in TASK_PRIORITIES)})",
            name="ck_housekeeping_tasks_priority",
        ),
        sa.CheckConstraint(
            f"status IN ({', '.join(repr(v) for v in TASK_STATUSES)})",
            name="ck_housekeeping_tasks_status",
        ),
        sa.Index("ix_housekeeping_tasks_room_date", "room_id", "business_date"),
        sa.Index("ix_housekeeping_tasks_status_date", "status", "business_date"),
        sa.Index("ix_housekeeping_tasks_assigned", "assigned_to_user_id", "status"),
    )

    # Add cleaning_in_progress to housekeeping_statuses check constraint on inventory_days
    # This is handled by seed data; the HousekeepingStatus table is a lookup table


def downgrade() -> None:
    op.drop_table("housekeeping_tasks")
