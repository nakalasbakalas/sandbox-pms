"""Allow housekeeping maintenance tasks in the task_type constraint.

Revision ID: 20260328_01
Revises: 20260326_04
Create Date: 2026-03-28 13:20:00.000000
"""

from __future__ import annotations

from alembic import op


revision = "20260328_01"
down_revision = "20260326_04"
branch_labels = None
depends_on = None

TASK_TYPES = (
    "checkout_clean",
    "daily_service",
    "rush_clean",
    "deep_clean",
    "inspection",
    "turndown",
    "maintenance",
)
LEGACY_TASK_TYPES = tuple(task_type for task_type in TASK_TYPES if task_type != "maintenance")


def _task_type_constraint(task_types: tuple[str, ...]) -> str:
    return f"task_type IN ({', '.join(repr(value) for value in task_types)})"


def upgrade() -> None:
    with op.batch_alter_table("housekeeping_tasks", recreate="always") as batch_op:
        batch_op.drop_constraint("ck_housekeeping_tasks_task_type", type_="check")
        batch_op.create_check_constraint(
            "ck_housekeeping_tasks_task_type",
            _task_type_constraint(TASK_TYPES),
        )


def downgrade() -> None:
    with op.batch_alter_table("housekeeping_tasks", recreate="always") as batch_op:
        batch_op.drop_constraint("ck_housekeeping_tasks_task_type", type_="check")
        batch_op.create_check_constraint(
            "ck_housekeeping_tasks_task_type",
            _task_type_constraint(LEGACY_TASK_TYPES),
        )
