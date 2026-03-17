"""Add pending_automation_events table for deferred messaging rules

Revision ID: 20260317_01
Revises: 20260316_02
Create Date: 2026-03-17 09:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = "20260317_01"
down_revision = "20260316_02"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "pending_automation_events",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True),
        sa.Column(
            "rule_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("automation_rules.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "reservation_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("reservations.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column(
            "guest_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("guests.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("context_json", sa.JSON, nullable=True),
        sa.Column("fire_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("processed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("error", sa.String(500), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_by_user_id", sa.Uuid(as_uuid=True), nullable=True),
        sa.Column("updated_by_user_id", sa.Uuid(as_uuid=True), nullable=True),
    )
    op.create_index(
        "ix_pending_automation_events_fire_at", "pending_automation_events", ["fire_at"]
    )
    op.create_index(
        "ix_pending_automation_events_processed_at",
        "pending_automation_events",
        ["processed_at"],
    )


def downgrade():
    op.drop_index("ix_pending_automation_events_processed_at", table_name="pending_automation_events")
    op.drop_index("ix_pending_automation_events_fire_at", table_name="pending_automation_events")
    op.drop_table("pending_automation_events")
