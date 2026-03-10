"""phase7 housekeeping operations

Revision ID: b6c3d9a42f10
Revises: 9f4a6b2d1e31
Create Date: 2026-03-09 10:30:00.000000

"""

from alembic import op
import sqlalchemy as sa


revision = "b6c3d9a42f10"
down_revision = "9f4a6b2d1e31"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("inventory_days", recreate="always") as batch_op:
        batch_op.add_column(sa.Column("is_blocked", sa.Boolean(), nullable=False, server_default=sa.false()))
        batch_op.add_column(sa.Column("blocked_reason", sa.String(length=255), nullable=True))
        batch_op.add_column(sa.Column("blocked_at", sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(sa.Column("blocked_until", sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(sa.Column("blocked_by_user_id", sa.Uuid(), nullable=True))
        batch_op.add_column(sa.Column("maintenance_flag", sa.Boolean(), nullable=False, server_default=sa.false()))
        batch_op.add_column(sa.Column("maintenance_note", sa.String(length=255), nullable=True))
        batch_op.add_column(sa.Column("maintenance_flagged_at", sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(sa.Column("maintenance_flagged_by_user_id", sa.Uuid(), nullable=True))
        batch_op.add_column(sa.Column("cleaned_at", sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(sa.Column("inspected_at", sa.DateTime(timezone=True), nullable=True))
        batch_op.create_foreign_key(
            "fk_inventory_days_blocked_by_user_id_users",
            "users",
            ["blocked_by_user_id"],
            ["id"],
            ondelete="SET NULL",
        )
        batch_op.create_foreign_key(
            "fk_inventory_days_maintenance_flagged_by_user_id_users",
            "users",
            ["maintenance_flagged_by_user_id"],
            ["id"],
            ondelete="SET NULL",
        )
        batch_op.create_index("ix_inventory_days_blocked_date", ["is_blocked", "business_date"], unique=False)
        batch_op.create_index("ix_inventory_days_maintenance_date", ["maintenance_flag", "business_date"], unique=False)

    op.create_table(
        "room_notes",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("room_id", sa.Uuid(), nullable=False),
        sa.Column("business_date", sa.Date(), nullable=True),
        sa.Column("note_text", sa.Text(), nullable=False),
        sa.Column("note_type", sa.String(length=40), nullable=False),
        sa.Column("is_important", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("visibility_scope", sa.String(length=40), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_by_user_id", sa.Uuid(), nullable=True),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["room_id"], ["rooms.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint(
            "note_type IN ('housekeeping', 'maintenance', 'supervisor', 'lost_and_found', 'warning')",
            name="ck_room_notes_note_type",
        ),
        sa.CheckConstraint(
            "visibility_scope IN ('front_desk', 'manager', 'all_staff')",
            name="ck_room_notes_visibility_scope",
        ),
    )
    op.create_index("ix_room_notes_room_business_date", "room_notes", ["room_id", "business_date"], unique=False)
    op.create_index("ix_room_notes_room_created", "room_notes", ["room_id", "created_at"], unique=False)

    op.create_table(
        "room_status_history",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("room_id", sa.Uuid(), nullable=False),
        sa.Column("inventory_day_id", sa.Uuid(), nullable=True),
        sa.Column("business_date", sa.Date(), nullable=False),
        sa.Column("previous_housekeeping_status_id", sa.Uuid(), nullable=True),
        sa.Column("new_housekeeping_status_id", sa.Uuid(), nullable=True),
        sa.Column("previous_availability_status", sa.String(length=30), nullable=True),
        sa.Column("new_availability_status", sa.String(length=30), nullable=True),
        sa.Column("previous_is_sellable", sa.Boolean(), nullable=True),
        sa.Column("new_is_sellable", sa.Boolean(), nullable=True),
        sa.Column("previous_is_blocked", sa.Boolean(), nullable=True),
        sa.Column("new_is_blocked", sa.Boolean(), nullable=True),
        sa.Column("previous_maintenance_flag", sa.Boolean(), nullable=True),
        sa.Column("new_maintenance_flag", sa.Boolean(), nullable=True),
        sa.Column("event_type", sa.String(length=60), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("changed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("changed_by_user_id", sa.Uuid(), nullable=True),
        sa.ForeignKeyConstraint(["changed_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["inventory_day_id"], ["inventory_days.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["new_housekeeping_status_id"], ["housekeeping_statuses.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["previous_housekeeping_status_id"], ["housekeeping_statuses.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["room_id"], ["rooms.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_room_status_history_business_date", "room_status_history", ["business_date"], unique=False)
    op.create_index("ix_room_status_history_room_changed", "room_status_history", ["room_id", "changed_at"], unique=False)


def downgrade():
    op.drop_index("ix_room_status_history_room_changed", table_name="room_status_history")
    op.drop_index("ix_room_status_history_business_date", table_name="room_status_history")
    op.drop_table("room_status_history")

    op.drop_index("ix_room_notes_room_created", table_name="room_notes")
    op.drop_index("ix_room_notes_room_business_date", table_name="room_notes")
    op.drop_table("room_notes")

    with op.batch_alter_table("inventory_days", recreate="always") as batch_op:
        batch_op.drop_index("ix_inventory_days_maintenance_date")
        batch_op.drop_index("ix_inventory_days_blocked_date")
        batch_op.drop_constraint("fk_inventory_days_maintenance_flagged_by_user_id_users", type_="foreignkey")
        batch_op.drop_constraint("fk_inventory_days_blocked_by_user_id_users", type_="foreignkey")
        batch_op.drop_column("inspected_at")
        batch_op.drop_column("cleaned_at")
        batch_op.drop_column("maintenance_flagged_by_user_id")
        batch_op.drop_column("maintenance_flagged_at")
        batch_op.drop_column("maintenance_note")
        batch_op.drop_column("maintenance_flag")
        batch_op.drop_column("blocked_by_user_id")
        batch_op.drop_column("blocked_until")
        batch_op.drop_column("blocked_at")
        batch_op.drop_column("blocked_reason")
        batch_op.drop_column("is_blocked")
