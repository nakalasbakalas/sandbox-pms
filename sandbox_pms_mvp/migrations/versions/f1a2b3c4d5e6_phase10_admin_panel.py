"""phase10 admin panel

Revision ID: f1a2b3c4d5e6
Revises: e8f9a0b1c2d3
Create Date: 2026-03-09 23:30:00.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "f1a2b3c4d5e6"
down_revision = "e8f9a0b1c2d3"
branch_labels = None
depends_on = None


UUID = sa.Uuid(as_uuid=True)
JSON = sa.JSON()


def _now_default() -> sa.TextClause:
    return sa.text("CURRENT_TIMESTAMP")


def upgrade():
    op.create_table(
        "inventory_overrides",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("scope_type", sa.String(length=20), nullable=False, server_default="room"),
        sa.Column("override_action", sa.String(length=20), nullable=False, server_default="close"),
        sa.Column("room_id", UUID),
        sa.Column("room_type_id", UUID),
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.Column("end_date", sa.Date(), nullable=False),
        sa.Column("reason", sa.String(length=255), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("expires_at", sa.DateTime(timezone=True)),
        sa.Column("released_at", sa.DateTime(timezone=True)),
        sa.Column("released_by_user_id", UUID),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=_now_default()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=_now_default()),
        sa.Column("created_by_user_id", UUID),
        sa.Column("updated_by_user_id", UUID),
        sa.ForeignKeyConstraint(["room_id"], ["rooms.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["room_type_id"], ["room_types.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["released_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["updated_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.CheckConstraint("scope_type IN ('room', 'room_type')", name="ck_inventory_overrides_scope_type"),
        sa.CheckConstraint("override_action IN ('close', 'restore')", name="ck_inventory_overrides_action"),
        sa.CheckConstraint("start_date <= end_date", name="ck_inventory_overrides_dates"),
        sa.CheckConstraint(
            "((scope_type = 'room' AND room_id IS NOT NULL AND room_type_id IS NULL) OR "
            "(scope_type = 'room_type' AND room_type_id IS NOT NULL AND room_id IS NULL))",
            name="ck_inventory_overrides_scope_target",
        ),
    )
    op.create_index(
        "ix_inventory_overrides_active_dates",
        "inventory_overrides",
        ["is_active", "start_date", "end_date"],
        unique=False,
    )
    op.create_index(
        "ix_inventory_overrides_room_dates",
        "inventory_overrides",
        ["room_id", "start_date", "end_date"],
        unique=False,
    )
    op.create_index(
        "ix_inventory_overrides_room_type_dates",
        "inventory_overrides",
        ["room_type_id", "start_date", "end_date"],
        unique=False,
    )

    op.create_table(
        "blackout_periods",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("blackout_type", sa.String(length=30), nullable=False, server_default="closed_to_booking"),
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.Column("end_date", sa.Date(), nullable=False),
        sa.Column("reason", sa.String(length=255), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=_now_default()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=_now_default()),
        sa.Column("created_by_user_id", UUID),
        sa.Column("updated_by_user_id", UUID),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["updated_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.CheckConstraint(
            "blackout_type IN ('property_closed', 'closed_to_booking', 'no_arrival', 'no_departure')",
            name="ck_blackout_periods_type",
        ),
        sa.CheckConstraint("start_date <= end_date", name="ck_blackout_periods_dates"),
    )
    op.create_index(
        "ix_blackout_periods_active_dates",
        "blackout_periods",
        ["is_active", "start_date", "end_date"],
        unique=False,
    )

    op.create_table(
        "policy_documents",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("code", sa.String(length=80), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("content", JSON, nullable=False),
        sa.Column("version", sa.String(length=40), nullable=False, server_default="2026-03"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=_now_default()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=_now_default()),
        sa.Column("created_by_user_id", UUID),
        sa.Column("updated_by_user_id", UUID),
        sa.Column("deleted_at", sa.DateTime(timezone=True)),
        sa.Column("deleted_by_user_id", UUID),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["updated_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["deleted_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.CheckConstraint(
            "code IN ('cancellation_policy', 'no_show_policy', 'check_in_policy', 'check_out_policy', "
            "'child_extra_guest_policy', 'privacy_notice')",
            name="ck_policy_documents_code",
        ),
        sa.UniqueConstraint("code", name="uq_policy_documents_code"),
    )
    op.create_index("ix_policy_documents_active", "policy_documents", ["is_active"], unique=False)

    op.create_table(
        "notification_templates",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("template_key", sa.String(length=80), nullable=False),
        sa.Column("channel", sa.String(length=20), nullable=False, server_default="email"),
        sa.Column("language_code", sa.String(length=20), nullable=False, server_default="th"),
        sa.Column("description", sa.String(length=255)),
        sa.Column("subject_template", sa.Text(), nullable=False),
        sa.Column("body_template", sa.Text(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=_now_default()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=_now_default()),
        sa.Column("created_by_user_id", UUID),
        sa.Column("updated_by_user_id", UUID),
        sa.Column("deleted_at", sa.DateTime(timezone=True)),
        sa.Column("deleted_by_user_id", UUID),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["updated_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["deleted_by_user_id"], ["users.id"], ondelete="SET NULL"),
                sa.CheckConstraint(
                    "template_key IN ('guest_confirmation', 'deposit_payment_request', 'payment_success', "
                    "'payment_failed', 'cancellation_request_received', 'modification_request_received', "
                    "'internal_new_booking_alert')",
                    name="ck_notification_templates_key",
                ),
        sa.CheckConstraint("channel IN ('email')", name="ck_notification_templates_channel"),
                sa.CheckConstraint("language_code IN ('th', 'en', 'zh-Hans')", name="ck_notification_templates_language"),
        sa.UniqueConstraint("template_key", "channel", "language_code", name="uq_notification_template_variant"),
    )
    op.create_index(
        "ix_notification_templates_active_key",
        "notification_templates",
        ["template_key", "is_active"],
        unique=False,
    )


def downgrade():
    op.drop_index("ix_notification_templates_active_key", table_name="notification_templates")
    op.drop_table("notification_templates")

    op.drop_index("ix_policy_documents_active", table_name="policy_documents")
    op.drop_table("policy_documents")

    op.drop_index("ix_blackout_periods_active_dates", table_name="blackout_periods")
    op.drop_table("blackout_periods")

    op.drop_index("ix_inventory_overrides_room_type_dates", table_name="inventory_overrides")
    op.drop_index("ix_inventory_overrides_room_dates", table_name="inventory_overrides")
    op.drop_index("ix_inventory_overrides_active_dates", table_name="inventory_overrides")
    op.drop_table("inventory_overrides")
