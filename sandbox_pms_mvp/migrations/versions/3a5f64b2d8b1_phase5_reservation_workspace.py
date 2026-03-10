"""phase5 reservation workspace

Revision ID: 3a5f64b2d8b1
Revises: 22fbc1b3bf47
Create Date: 2026-03-08 12:00:00.000000

"""

from alembic import op
import sqlalchemy as sa


revision = "3a5f64b2d8b1"
down_revision = "22fbc1b3bf47"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "reservation_notes",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("reservation_id", sa.Uuid(), nullable=False),
        sa.Column("note_text", sa.Text(), nullable=False),
        sa.Column("note_type", sa.String(length=40), nullable=False),
        sa.Column("is_important", sa.Boolean(), nullable=False),
        sa.Column("visibility_scope", sa.String(length=40), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_by_user_id", sa.Uuid(), nullable=True),
        sa.CheckConstraint(
            "note_type IN ('general', 'vip', 'warning', 'billing', 'operations')",
            name="ck_reservation_notes_note_type",
        ),
        sa.CheckConstraint(
            "visibility_scope IN ('front_desk', 'manager', 'all_staff')",
            name="ck_reservation_notes_visibility_scope",
        ),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["reservation_id"], ["reservations.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_reservation_notes_reservation_created",
        "reservation_notes",
        ["reservation_id", "created_at"],
        unique=False,
    )


def downgrade():
    op.drop_index("ix_reservation_notes_reservation_created", table_name="reservation_notes")
    op.drop_table("reservation_notes")
