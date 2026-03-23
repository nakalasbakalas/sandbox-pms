"""Multi-property scaffolding: properties table + property_id FK on reservations, rooms, room_types

Revision ID: 20260322_08
Revises: 20260322_07
Create Date: 2026-03-22 22:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "20260322_08"
down_revision = "20260322_07"


def upgrade() -> None:
    # -- Create properties table --
    op.create_table(
        "properties",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_by_user_id", sa.Uuid(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("updated_by_user_id", sa.Uuid(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("code", sa.String(20), unique=True, nullable=False),
        sa.Column("timezone", sa.String(50), nullable=False, server_default="Asia/Bangkok"),
        sa.Column("currency", sa.String(10), nullable=False, server_default="THB"),
        sa.Column("address", sa.Text, nullable=True),
        sa.Column("settings_json", sa.JSON, nullable=True),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.text("true")),
    )
    op.create_index("ix_properties_is_active", "properties", ["is_active"])

    # -- Add property_id FK to room_types --
    with op.batch_alter_table("room_types") as batch_op:
        batch_op.add_column(sa.Column("property_id", sa.Uuid(as_uuid=True), nullable=True))
        batch_op.create_foreign_key(
            "fk_room_types_property_id",
            "properties",
            ["property_id"],
            ["id"],
            ondelete="SET NULL",
        )
        batch_op.create_index("ix_room_types_property_id", ["property_id"])

    # -- Add property_id FK to rooms --
    with op.batch_alter_table("rooms") as batch_op:
        batch_op.add_column(sa.Column("property_id", sa.Uuid(as_uuid=True), nullable=True))
        batch_op.create_foreign_key(
            "fk_rooms_property_id",
            "properties",
            ["property_id"],
            ["id"],
            ondelete="SET NULL",
        )
        batch_op.create_index("ix_rooms_property_id", ["property_id"])

    # -- Add property_id FK to reservations --
    with op.batch_alter_table("reservations") as batch_op:
        batch_op.add_column(sa.Column("property_id", sa.Uuid(as_uuid=True), nullable=True))
        batch_op.create_foreign_key(
            "fk_reservations_property_id",
            "properties",
            ["property_id"],
            ["id"],
            ondelete="SET NULL",
        )
        batch_op.create_index("ix_reservations_property_id", ["property_id"])


def downgrade() -> None:
    with op.batch_alter_table("reservations") as batch_op:
        batch_op.drop_index("ix_reservations_property_id")
        batch_op.drop_constraint("fk_reservations_property_id", type_="foreignkey")
        batch_op.drop_column("property_id")

    with op.batch_alter_table("rooms") as batch_op:
        batch_op.drop_index("ix_rooms_property_id")
        batch_op.drop_constraint("fk_rooms_property_id", type_="foreignkey")
        batch_op.drop_column("property_id")

    with op.batch_alter_table("room_types") as batch_op:
        batch_op.drop_index("ix_room_types_property_id")
        batch_op.drop_constraint("fk_room_types_property_id", type_="foreignkey")
        batch_op.drop_column("property_id")

    op.drop_index("ix_properties_is_active", table_name="properties")
    op.drop_table("properties")
