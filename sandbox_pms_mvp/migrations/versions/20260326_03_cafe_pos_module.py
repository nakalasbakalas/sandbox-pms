"""Create café POS module tables

Revision ID: 20260326_03
Revises: 20260326_02
Create Date: 2026-03-26 15:30:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "20260326_03"
down_revision = "20260326_02"


def upgrade() -> None:
    # --- cafe_categories ---
    op.create_table(
        "cafe_categories",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("updated_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("description", sa.String(500), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["updated_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )

    # --- cafe_modifier_groups ---
    op.create_table(
        "cafe_modifier_groups",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("updated_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_required", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("max_selections", sa.Integer(), nullable=False, server_default="1"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["updated_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )

    # --- cafe_shifts ---
    op.create_table(
        "cafe_shifts",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("updated_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("status", sa.String(40), nullable=False, server_default="open"),
        sa.Column("opened_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("opening_cash", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("expected_cash", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("actual_cash", sa.Integer(), nullable=True),
        sa.Column("variance", sa.Integer(), nullable=True),
        sa.Column("closed_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("notes", sa.String(500), nullable=True),
        sa.CheckConstraint("status IN ('open', 'closed')", name="ck_cafe_shifts_status"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["updated_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["closed_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_cafe_shifts_status", "cafe_shifts", ["status"])

    # --- cafe_items ---
    op.create_table(
        "cafe_items",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("updated_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("category_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("description", sa.String(500), nullable=True),
        sa.Column("price", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_available", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("prep_station", sa.String(40), nullable=False, server_default="counter"),
        sa.Column("stock_quantity", sa.Integer(), nullable=True),
        sa.Column("low_stock_threshold", sa.Integer(), nullable=True),
        sa.CheckConstraint("prep_station IN ('bar', 'kitchen', 'counter')", name="ck_cafe_items_prep_station"),
        sa.ForeignKeyConstraint(["category_id"], ["cafe_categories.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["updated_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_cafe_items_category_id", "cafe_items", ["category_id"])

    # --- cafe_item_modifier_groups ---
    op.create_table(
        "cafe_item_modifier_groups",
        sa.Column("item_id", sa.Uuid(), nullable=False),
        sa.Column("modifier_group_id", sa.Uuid(), nullable=False),
        sa.ForeignKeyConstraint(["item_id"], ["cafe_items.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["modifier_group_id"], ["cafe_modifier_groups.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("item_id", "modifier_group_id"),
    )

    # --- cafe_modifiers ---
    op.create_table(
        "cafe_modifiers",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("updated_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("group_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("price_delta", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.ForeignKeyConstraint(["group_id"], ["cafe_modifier_groups.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["updated_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_cafe_modifiers_group_id", "cafe_modifiers", ["group_id"])

    # --- cafe_orders ---
    op.create_table(
        "cafe_orders",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("updated_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("order_number", sa.String(40), nullable=False, unique=True),
        sa.Column("status", sa.String(40), nullable=False, server_default="draft"),
        sa.Column("order_type", sa.String(40), nullable=False, server_default="dine_in"),
        sa.Column("customer_name", sa.String(200), nullable=True),
        sa.Column("table_label", sa.String(40), nullable=True),
        sa.Column("subtotal", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("discount_total", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("discount_note", sa.String(255), nullable=True),
        sa.Column("grand_total", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("payment_status", sa.String(40), nullable=False, server_default="unpaid"),
        sa.Column("payment_method", sa.String(40), nullable=True),
        sa.Column("shift_id", sa.Uuid(), nullable=True),
        sa.Column("notes", sa.String(500), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("cancelled_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("cancel_reason", sa.String(255), nullable=True),
        sa.CheckConstraint(
            "status IN ('draft', 'open', 'sent', 'paid', 'cancelled', 'completed', 'refunded')",
            name="ck_cafe_orders_status",
        ),
        sa.CheckConstraint(
            "order_type IN ('dine_in', 'takeaway', 'delivery')",
            name="ck_cafe_orders_order_type",
        ),
        sa.ForeignKeyConstraint(["shift_id"], ["cafe_shifts.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["cancelled_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["updated_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_cafe_orders_status", "cafe_orders", ["status"])
    op.create_index("ix_cafe_orders_created_at", "cafe_orders", ["created_at"])
    op.create_index("ix_cafe_orders_shift_id", "cafe_orders", ["shift_id"])

    # --- cafe_order_items ---
    op.create_table(
        "cafe_order_items",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("updated_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("order_id", sa.Uuid(), nullable=False),
        sa.Column("item_id", sa.Uuid(), nullable=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("unit_price", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("quantity", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("line_total", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("notes", sa.String(255), nullable=True),
        sa.Column("prep_station", sa.String(40), nullable=False, server_default="counter"),
        sa.Column("prep_status", sa.String(40), nullable=False, server_default="pending"),
        sa.CheckConstraint(
            "prep_status IN ('pending', 'in_progress', 'ready', 'completed')",
            name="ck_cafe_order_items_prep_status",
        ),
        sa.ForeignKeyConstraint(["order_id"], ["cafe_orders.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["item_id"], ["cafe_items.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["updated_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_cafe_order_items_order_id", "cafe_order_items", ["order_id"])
    op.create_index("ix_cafe_order_items_prep_status", "cafe_order_items", ["prep_status"])

    # --- cafe_order_item_modifiers ---
    op.create_table(
        "cafe_order_item_modifiers",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("order_item_id", sa.Uuid(), nullable=False),
        sa.Column("modifier_id", sa.Uuid(), nullable=True),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("price_delta", sa.Integer(), nullable=False, server_default="0"),
        sa.ForeignKeyConstraint(["order_item_id"], ["cafe_order_items.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["modifier_id"], ["cafe_modifiers.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_cafe_order_item_modifiers_order_item_id", "cafe_order_item_modifiers", ["order_item_id"])

    # --- cafe_payments ---
    op.create_table(
        "cafe_payments",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("updated_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("order_id", sa.Uuid(), nullable=False),
        sa.Column("method", sa.String(40), nullable=False),
        sa.Column("amount", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("amount_received", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("change_given", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("reference", sa.String(255), nullable=True),
        sa.Column("is_refund", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("refund_reason", sa.String(255), nullable=True),
        sa.CheckConstraint("method IN ('cash', 'card', 'qr_transfer')", name="ck_cafe_payments_method"),
        sa.ForeignKeyConstraint(["order_id"], ["cafe_orders.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["updated_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_cafe_payments_order_id", "cafe_payments", ["order_id"])

    # --- cafe_audit_logs ---
    op.create_table(
        "cafe_audit_logs",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("actor_user_id", sa.Uuid(), nullable=True),
        sa.Column("action", sa.String(80), nullable=False),
        sa.Column("entity_type", sa.String(80), nullable=False),
        sa.Column("entity_id", sa.String(80), nullable=False),
        sa.Column("details", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["actor_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_cafe_audit_logs_created_at", "cafe_audit_logs", ["created_at"])
    op.create_index("ix_cafe_audit_logs_entity_type", "cafe_audit_logs", ["entity_type"])


def downgrade() -> None:
    op.drop_table("cafe_audit_logs")
    op.drop_table("cafe_payments")
    op.drop_table("cafe_order_item_modifiers")
    op.drop_table("cafe_order_items")
    op.drop_table("cafe_orders")
    op.drop_table("cafe_modifiers")
    op.drop_table("cafe_item_modifier_groups")
    op.drop_table("cafe_items")
    op.drop_table("cafe_shifts")
    op.drop_table("cafe_modifier_groups")
    op.drop_table("cafe_categories")
