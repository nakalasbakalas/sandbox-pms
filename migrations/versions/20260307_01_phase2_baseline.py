"""phase 2 postgresql baseline

Revision ID: 20260307_01
Revises:
Create Date: 2026-03-07 21:10:00.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260307_01"
down_revision = None
branch_labels = None
depends_on = None


UUID = sa.Uuid(as_uuid=True)
JSON = sa.JSON()


def _now_default() -> sa.TextClause:
    return sa.text("CURRENT_TIMESTAMP")


def _create_reference_tables() -> None:
    op.create_table(
        "reservation_code_sequence",
        sa.Column("sequence_name", sa.String(length=80), primary_key=True),
        sa.Column("next_value", sa.BigInteger(), nullable=False),
    )

    op.create_table(
        "users",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("full_name", sa.String(length=255), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("last_login_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=_now_default()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=_now_default()),
        sa.Column("created_by_user_id", UUID),
        sa.Column("updated_by_user_id", UUID),
        sa.Column("deleted_at", sa.DateTime(timezone=True)),
        sa.Column("deleted_by_user_id", UUID),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["updated_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["deleted_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.UniqueConstraint("email", name="uq_users_email"),
    )

    op.create_table(
        "roles",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("code", sa.String(length=80), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("description", sa.String(length=255)),
        sa.Column("is_system_role", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=_now_default()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=_now_default()),
        sa.Column("created_by_user_id", UUID),
        sa.Column("updated_by_user_id", UUID),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["updated_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.UniqueConstraint("code", name="uq_roles_code"),
    )

    op.create_table(
        "permissions",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("code", sa.String(length=120), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("description", sa.String(length=255)),
        sa.Column("module", sa.String(length=80), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=_now_default()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=_now_default()),
        sa.Column("created_by_user_id", UUID),
        sa.Column("updated_by_user_id", UUID),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["updated_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.UniqueConstraint("code", name="uq_permissions_code"),
    )

    op.create_table(
        "user_roles",
        sa.Column("user_id", UUID, nullable=False),
        sa.Column("role_id", UUID, nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["role_id"], ["roles.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id", "role_id", name="pk_user_roles"),
    )

    op.create_table(
        "role_permissions",
        sa.Column("role_id", UUID, nullable=False),
        sa.Column("permission_id", UUID, nullable=False),
        sa.ForeignKeyConstraint(["role_id"], ["roles.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["permission_id"], ["permissions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("role_id", "permission_id", name="pk_role_permissions"),
    )

    op.create_table(
        "room_types",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("code", sa.String(length=20), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("description", sa.Text()),
        sa.Column("standard_occupancy", sa.Integer(), nullable=False),
        sa.Column("max_occupancy", sa.Integer(), nullable=False),
        sa.Column("extra_bed_allowed", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=_now_default()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=_now_default()),
        sa.Column("created_by_user_id", UUID),
        sa.Column("updated_by_user_id", UUID),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["updated_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.CheckConstraint("standard_occupancy >= 1", name="ck_room_type_standard_occupancy"),
        sa.CheckConstraint("max_occupancy >= standard_occupancy", name="ck_room_type_max_occupancy"),
        sa.UniqueConstraint("code", name="uq_room_types_code"),
    )

    op.create_table(
        "housekeeping_statuses",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("code", sa.String(length=40), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("description", sa.String(length=255)),
        sa.Column("is_sellable_state", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=_now_default()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=_now_default()),
        sa.Column("created_by_user_id", UUID),
        sa.Column("updated_by_user_id", UUID),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["updated_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.UniqueConstraint("code", name="uq_housekeeping_statuses_code"),
    )

    op.create_table(
        "guests",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("first_name", sa.String(length=120), nullable=False),
        sa.Column("last_name", sa.String(length=120), nullable=False),
        sa.Column("full_name", sa.String(length=255), nullable=False),
        sa.Column("phone", sa.String(length=60), nullable=False),
        sa.Column("email", sa.String(length=255)),
        sa.Column("nationality", sa.String(length=80)),
        sa.Column("id_document_type", sa.String(length=80)),
        sa.Column("id_document_number", sa.String(length=120)),
        sa.Column("date_of_birth", sa.Date()),
        sa.Column("preferred_language", sa.String(length=30)),
        sa.Column("marketing_opt_in", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("blacklist_flag", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("notes_summary", sa.String(length=255)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=_now_default()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=_now_default()),
        sa.Column("created_by_user_id", UUID),
        sa.Column("updated_by_user_id", UUID),
        sa.Column("deleted_at", sa.DateTime(timezone=True)),
        sa.Column("deleted_by_user_id", UUID),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["updated_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["deleted_by_user_id"], ["users.id"], ondelete="SET NULL"),
    )

    op.create_table(
        "guest_notes",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("guest_id", UUID, nullable=False),
        sa.Column("note_text", sa.Text(), nullable=False),
        sa.Column("note_type", sa.String(length=40), nullable=False),
        sa.Column("is_important", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("visibility_scope", sa.String(length=40), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=_now_default()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=_now_default()),
        sa.Column("created_by_user_id", UUID),
        sa.Column("updated_by_user_id", UUID),
        sa.Column("deleted_at", sa.DateTime(timezone=True)),
        sa.Column("deleted_by_user_id", UUID),
        sa.ForeignKeyConstraint(["guest_id"], ["guests.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["updated_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["deleted_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.CheckConstraint("note_type IN ('general', 'vip', 'warning', 'billing', 'operations')", name="ck_guest_note_type"),
        sa.CheckConstraint("visibility_scope IN ('front_desk', 'manager', 'all_staff')", name="ck_guest_note_visibility_scope"),
    )

    op.create_table(
        "rooms",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("room_number", sa.String(length=20), nullable=False),
        sa.Column("room_type_id", UUID, nullable=False),
        sa.Column("floor_number", sa.Integer(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("is_sellable", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("default_operational_status", sa.String(length=40), nullable=False),
        sa.Column("notes", sa.String(length=255)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=_now_default()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=_now_default()),
        sa.Column("created_by_user_id", UUID),
        sa.Column("updated_by_user_id", UUID),
        sa.ForeignKeyConstraint(["room_type_id"], ["room_types.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["updated_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.CheckConstraint(
            "default_operational_status IN ('available', 'out_of_service', 'out_of_order', 'maintenance')",
            name="ck_rooms_default_operational_status",
        ),
        sa.UniqueConstraint("room_number", name="uq_rooms_room_number"),
    )

    op.create_table(
        "rate_rules",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("room_type_id", UUID),
        sa.Column("priority", sa.Integer(), nullable=False, server_default="100"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("rule_type", sa.String(length=40), nullable=False),
        sa.Column("adjustment_type", sa.String(length=40), nullable=False),
        sa.Column("adjustment_value", sa.Numeric(10, 2), nullable=False),
        sa.Column("start_date", sa.Date()),
        sa.Column("end_date", sa.Date()),
        sa.Column("days_of_week", sa.String(length=50)),
        sa.Column("min_nights", sa.Integer()),
        sa.Column("max_nights", sa.Integer()),
        sa.Column("extra_guest_fee_override", sa.Numeric(10, 2)),
        sa.Column("child_fee_override", sa.Numeric(10, 2)),
        sa.Column("metadata", JSON),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=_now_default()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=_now_default()),
        sa.Column("created_by_user_id", UUID),
        sa.Column("updated_by_user_id", UUID),
        sa.Column("deleted_at", sa.DateTime(timezone=True)),
        sa.Column("deleted_by_user_id", UUID),
        sa.ForeignKeyConstraint(["room_type_id"], ["room_types.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["updated_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["deleted_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.CheckConstraint(
            "rule_type IN ('base_rate', 'seasonal_override', 'holiday_override', 'weekday_override', 'weekend_override', 'long_stay_discount')",
            name="ck_rate_rules_rule_type",
        ),
        sa.CheckConstraint(
            "adjustment_type IN ('fixed', 'amount_delta', 'percent_delta')",
            name="ck_rate_rules_adjustment_type",
        ),
        sa.CheckConstraint("adjustment_value >= 0 OR adjustment_type != 'fixed'", name="ck_rate_rules_adjustment_value"),
    )

    op.create_table(
        "app_settings",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("key", sa.String(length=120), nullable=False),
        sa.Column("value_json", JSON, nullable=False),
        sa.Column("value_type", sa.String(length=40), nullable=False),
        sa.Column("description", sa.String(length=255)),
        sa.Column("is_public", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=_now_default()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=_now_default()),
        sa.Column("created_by_user_id", UUID),
        sa.Column("updated_by_user_id", UUID),
        sa.Column("deleted_at", sa.DateTime(timezone=True)),
        sa.Column("deleted_by_user_id", UUID),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["updated_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["deleted_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.UniqueConstraint("key", name="uq_app_settings_key"),
    )


def _create_transaction_tables() -> None:
    op.create_table(
        "reservations",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("reservation_code", sa.String(length=20), nullable=False),
        sa.Column("primary_guest_id", UUID, nullable=False),
        sa.Column("room_type_id", UUID, nullable=False),
        sa.Column("assigned_room_id", UUID, nullable=False),
        sa.Column("current_status", sa.String(length=30), nullable=False),
        sa.Column("source_channel", sa.String(length=80), nullable=False, server_default="direct"),
        sa.Column("check_in_date", sa.Date(), nullable=False),
        sa.Column("check_out_date", sa.Date(), nullable=False),
        sa.Column("adults", sa.Integer(), nullable=False),
        sa.Column("children", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("extra_guests", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("special_requests", sa.Text()),
        sa.Column("internal_notes", sa.Text()),
        sa.Column("quoted_room_total", sa.Numeric(10, 2), nullable=False, server_default="0.00"),
        sa.Column("quoted_tax_total", sa.Numeric(10, 2), nullable=False, server_default="0.00"),
        sa.Column("quoted_grand_total", sa.Numeric(10, 2), nullable=False, server_default="0.00"),
        sa.Column("deposit_required_amount", sa.Numeric(10, 2), nullable=False, server_default="0.00"),
        sa.Column("deposit_received_amount", sa.Numeric(10, 2), nullable=False, server_default="0.00"),
        sa.Column("booked_at", sa.DateTime(timezone=True), nullable=False, server_default=_now_default()),
        sa.Column("cancelled_at", sa.DateTime(timezone=True)),
        sa.Column("cancellation_reason", sa.String(length=255)),
        sa.Column("no_show_at", sa.DateTime(timezone=True)),
        sa.Column("checked_in_at", sa.DateTime(timezone=True)),
        sa.Column("checked_out_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=_now_default()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=_now_default()),
        sa.Column("created_by_user_id", UUID),
        sa.Column("updated_by_user_id", UUID),
        sa.ForeignKeyConstraint(["primary_guest_id"], ["guests.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["room_type_id"], ["room_types.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["assigned_room_id"], ["rooms.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["updated_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.CheckConstraint("check_in_date < check_out_date", name="ck_reservation_dates"),
        sa.CheckConstraint("adults >= 1", name="ck_reservations_adults"),
        sa.CheckConstraint("children >= 0", name="ck_reservations_children"),
        sa.CheckConstraint("extra_guests >= 0", name="ck_reservations_extra_guests"),
        sa.CheckConstraint("quoted_room_total >= 0", name="ck_reservations_room_total"),
        sa.CheckConstraint("quoted_tax_total >= 0", name="ck_reservations_tax_total"),
        sa.CheckConstraint("quoted_grand_total >= 0", name="ck_reservations_grand_total"),
        sa.CheckConstraint("deposit_required_amount >= 0", name="ck_reservations_deposit_required"),
        sa.CheckConstraint("deposit_received_amount >= 0", name="ck_reservations_deposit_received"),
        sa.CheckConstraint(
            "current_status IN ('inquiry', 'tentative', 'confirmed', 'checked_in', 'checked_out', 'cancelled', 'no_show', 'waitlist', 'house_use')",
            name="ck_reservations_current_status",
        ),
        sa.CheckConstraint("reservation_code LIKE 'SBX-%'", name="ck_reservations_reservation_code_format"),
        sa.UniqueConstraint("reservation_code", name="uq_reservations_reservation_code"),
    )

    op.create_table(
        "reservation_status_history",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("reservation_id", UUID, nullable=False),
        sa.Column("old_status", sa.String(length=30)),
        sa.Column("new_status", sa.String(length=30), nullable=False),
        sa.Column("reason", sa.String(length=255)),
        sa.Column("note", sa.Text()),
        sa.Column("changed_at", sa.DateTime(timezone=True), nullable=False, server_default=_now_default()),
        sa.Column("changed_by_user_id", UUID),
        sa.ForeignKeyConstraint(["reservation_id"], ["reservations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["changed_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.CheckConstraint(
            "new_status IN ('inquiry', 'tentative', 'confirmed', 'checked_in', 'checked_out', 'cancelled', 'no_show', 'waitlist', 'house_use')",
            name="ck_reservation_status_history_new_status",
        ),
    )

    op.create_table(
        "inventory_days",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("room_id", UUID, nullable=False),
        sa.Column("room_type_id", UUID, nullable=False),
        sa.Column("business_date", sa.Date(), nullable=False),
        sa.Column("availability_status", sa.String(length=30), nullable=False, server_default="available"),
        sa.Column("housekeeping_status_id", UUID),
        sa.Column("reservation_id", UUID),
        sa.Column("nightly_rate", sa.Numeric(10, 2)),
        sa.Column("is_sellable", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("notes", sa.String(length=255)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=_now_default()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=_now_default()),
        sa.Column("created_by_user_id", UUID),
        sa.Column("updated_by_user_id", UUID),
        sa.ForeignKeyConstraint(["room_id"], ["rooms.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["room_type_id"], ["room_types.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["housekeeping_status_id"], ["housekeeping_statuses.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["reservation_id"], ["reservations.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["updated_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.UniqueConstraint("room_id", "business_date", name="uq_inventory_days_room_date"),
        sa.CheckConstraint(
            "availability_status IN ('available', 'held', 'reserved', 'occupied', 'house_use', 'out_of_service', 'out_of_order')",
            name="ck_inventory_days_availability_status",
        ),
        sa.CheckConstraint(
            "(reservation_id IS NULL) OR (availability_status IN ('held', 'reserved', 'occupied', 'house_use'))",
            name="ck_inventory_days_reservation_requires_consuming_status",
        ),
        sa.CheckConstraint(
            "(availability_status NOT IN ('out_of_service', 'out_of_order')) OR reservation_id IS NULL",
            name="ck_inventory_days_closure_without_reservation",
        ),
    )

    op.create_table(
        "folio_charges",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("reservation_id", UUID, nullable=False),
        sa.Column("charge_code", sa.String(length=40), nullable=False),
        sa.Column("charge_type", sa.String(length=40), nullable=False),
        sa.Column("description", sa.String(length=255), nullable=False),
        sa.Column("quantity", sa.Numeric(10, 2), nullable=False, server_default="1.00"),
        sa.Column("unit_amount", sa.Numeric(10, 2), nullable=False),
        sa.Column("line_amount", sa.Numeric(10, 2), nullable=False),
        sa.Column("tax_amount", sa.Numeric(10, 2), nullable=False, server_default="0.00"),
        sa.Column("total_amount", sa.Numeric(10, 2), nullable=False),
        sa.Column("service_date", sa.Date(), nullable=False),
        sa.Column("posted_at", sa.DateTime(timezone=True), nullable=False, server_default=_now_default()),
        sa.Column("posted_by_user_id", UUID),
        sa.Column("is_reversal", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("reversed_charge_id", UUID),
        sa.Column("metadata", JSON),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=_now_default()),
        sa.Column("created_by_user_id", UUID),
        sa.ForeignKeyConstraint(["reservation_id"], ["reservations.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["posted_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["reversed_charge_id"], ["folio_charges.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.CheckConstraint(
            "charge_code IN ('RM', 'VAT', 'DEP', 'DEP_APPL', 'EXG', 'EXB', 'ECI', 'LCO', 'LND', 'SNK', 'TEL', 'ADJ_POS', 'ADJ_NEG', 'REF')",
            name="ck_folio_charges_charge_code",
        ),
        sa.CheckConstraint("quantity >= 0", name="ck_folio_charges_quantity"),
        sa.CheckConstraint("unit_amount >= 0", name="ck_folio_charges_unit_amount"),
        sa.CheckConstraint("tax_amount >= 0", name="ck_folio_charges_tax_amount"),
    )

    op.create_table(
        "payment_requests",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("reservation_id", UUID, nullable=False),
        sa.Column("request_type", sa.String(length=40), nullable=False),
        sa.Column("amount", sa.Numeric(10, 2), nullable=False),
        sa.Column("currency_code", sa.String(length=3), nullable=False, server_default="THB"),
        sa.Column("due_at", sa.DateTime(timezone=True)),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="pending"),
        sa.Column("provider", sa.String(length=80), nullable=False),
        sa.Column("provider_reference", sa.String(length=255)),
        sa.Column("payment_url", sa.String(length=1024)),
        sa.Column("expires_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=_now_default()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=_now_default()),
        sa.Column("created_by_user_id", UUID),
        sa.Column("updated_by_user_id", UUID),
        sa.ForeignKeyConstraint(["reservation_id"], ["reservations.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["updated_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.CheckConstraint("amount >= 0", name="ck_payment_requests_amount"),
        sa.CheckConstraint("status IN ('pending', 'paid', 'expired', 'cancelled', 'failed')", name="ck_payment_requests_status"),
    )

    op.create_table(
        "payment_events",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("payment_request_id", UUID),
        sa.Column("reservation_id", UUID),
        sa.Column("event_type", sa.String(length=80), nullable=False),
        sa.Column("amount", sa.Numeric(10, 2)),
        sa.Column("currency_code", sa.String(length=3)),
        sa.Column("provider", sa.String(length=80)),
        sa.Column("provider_event_id", sa.String(length=255)),
        sa.Column("raw_payload", JSON),
        sa.Column("processed_at", sa.DateTime(timezone=True), nullable=False, server_default=_now_default()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=_now_default()),
        sa.Column("created_by_user_id", UUID),
        sa.ForeignKeyConstraint(["payment_request_id"], ["payment_requests.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["reservation_id"], ["reservations.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
    )

    op.create_table(
        "audit_log",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("actor_user_id", UUID),
        sa.Column("entity_table", sa.String(length=120), nullable=False),
        sa.Column("entity_id", sa.String(length=64), nullable=False),
        sa.Column("action", sa.String(length=80), nullable=False),
        sa.Column("before_data", JSON),
        sa.Column("after_data", JSON),
        sa.Column("request_id", sa.String(length=120)),
        sa.Column("ip_address", sa.String(length=64)),
        sa.Column("user_agent", sa.String(length=512)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=_now_default()),
        sa.ForeignKeyConstraint(["actor_user_id"], ["users.id"], ondelete="SET NULL"),
    )


def _create_indexes() -> None:
    op.create_index("ix_users_active_email", "users", ["email"], unique=False)
    op.create_index("ix_user_roles_role_id", "user_roles", ["role_id"], unique=False)
    op.create_index("ix_role_permissions_permission_id", "role_permissions", ["permission_id"], unique=False)
    op.create_index("ix_guests_phone", "guests", ["phone"], unique=False)
    op.create_index("ix_guests_email", "guests", ["email"], unique=False)
    op.create_index("ix_guests_full_name", "guests", ["full_name"], unique=False)
    op.create_index("ix_guest_notes_guest_id", "guest_notes", ["guest_id"], unique=False)
    op.create_index("ix_rooms_room_type_id", "rooms", ["room_type_id"], unique=False)
    op.create_index("ix_rate_rules_room_type_active", "rate_rules", ["room_type_id", "is_active"], unique=False)
    op.create_index("ix_rate_rules_date_window", "rate_rules", ["start_date", "end_date"], unique=False)
    op.create_index("ix_reservations_status_dates", "reservations", ["current_status", "check_in_date", "check_out_date"], unique=False)
    op.create_index("ix_reservations_primary_guest_id", "reservations", ["primary_guest_id"], unique=False)
    op.create_index("ix_reservations_assigned_room_id", "reservations", ["assigned_room_id"], unique=False)
    op.create_index("ix_reservations_source_channel", "reservations", ["source_channel"], unique=False)
    op.create_index("ix_reservations_arrivals", "reservations", ["check_in_date", "current_status"], unique=False)
    op.create_index("ix_reservations_departures", "reservations", ["check_out_date", "current_status"], unique=False)
    op.create_index("ix_reservation_status_history_reservation_changed", "reservation_status_history", ["reservation_id", "changed_at"], unique=False)
    op.create_index("ix_inventory_days_business_date", "inventory_days", ["business_date"], unique=False)
    op.create_index("ix_inventory_days_room_type_date", "inventory_days", ["room_type_id", "business_date"], unique=False)
    op.create_index("ix_inventory_days_reservation_id", "inventory_days", ["reservation_id"], unique=False)
    op.create_index("ix_inventory_days_status_date", "inventory_days", ["availability_status", "business_date"], unique=False)
    op.create_index("ix_folio_charges_reservation_id", "folio_charges", ["reservation_id"], unique=False)
    op.create_index("ix_folio_charges_posted_at", "folio_charges", ["posted_at"], unique=False)
    op.create_index("ix_payment_requests_reservation_id", "payment_requests", ["reservation_id"], unique=False)
    op.create_index("ix_payment_requests_status", "payment_requests", ["status"], unique=False)
    op.create_index("ix_payment_events_payment_request_id", "payment_events", ["payment_request_id"], unique=False)
    op.create_index("ix_payment_events_reservation_id", "payment_events", ["reservation_id"], unique=False)
    op.create_index("ix_audit_log_entity", "audit_log", ["entity_table", "entity_id"], unique=False)
    op.create_index("ix_audit_log_actor_created", "audit_log", ["actor_user_id", "created_at"], unique=False)


def _create_postgresql_helpers() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return

    op.execute("CREATE SEQUENCE IF NOT EXISTS reservation_code_seq START WITH 1 INCREMENT BY 1")
    op.execute(
        """
        CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
        BEGIN
            NEW.updated_at = NOW();
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        """
    )
    op.execute(
        """
        CREATE OR REPLACE FUNCTION prevent_append_only_mutation() RETURNS TRIGGER AS $$
        BEGIN
            RAISE EXCEPTION 'append-only table cannot be updated or deleted';
        END;
        $$ LANGUAGE plpgsql;
        """
    )
    for table_name in (
        "users",
        "roles",
        "permissions",
        "guests",
        "guest_notes",
        "room_types",
        "rooms",
        "housekeeping_statuses",
        "reservations",
        "inventory_days",
        "rate_rules",
        "payment_requests",
        "app_settings",
    ):
        op.execute(
            f"""
            DROP TRIGGER IF EXISTS trg_{table_name}_updated_at ON {table_name};
            CREATE TRIGGER trg_{table_name}_updated_at
            BEFORE UPDATE ON {table_name}
            FOR EACH ROW EXECUTE FUNCTION set_updated_at();
            """
        )
    for table_name in ("reservation_status_history", "folio_charges", "payment_events", "audit_log"):
        op.execute(
            f"""
            DROP TRIGGER IF EXISTS trg_{table_name}_append_only_update ON {table_name};
            CREATE TRIGGER trg_{table_name}_append_only_update
            BEFORE UPDATE OR DELETE ON {table_name}
            FOR EACH ROW EXECUTE FUNCTION prevent_append_only_mutation();
            """
        )
    op.execute("CREATE INDEX IF NOT EXISTS ix_users_active_email_live ON users (email) WHERE deleted_at IS NULL")
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_rate_rules_active_live ON rate_rules (priority, room_type_id) WHERE deleted_at IS NULL AND is_active = TRUE"
    )


def upgrade() -> None:
    _create_reference_tables()
    _create_transaction_tables()
    _create_indexes()
    _create_postgresql_helpers()


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        for table_name in ("reservation_status_history", "folio_charges", "payment_events", "audit_log"):
            op.execute(f"DROP TRIGGER IF EXISTS trg_{table_name}_append_only_update ON {table_name}")
        for table_name in (
            "users",
            "roles",
            "permissions",
            "guests",
            "guest_notes",
            "room_types",
            "rooms",
            "housekeeping_statuses",
            "reservations",
            "inventory_days",
            "rate_rules",
            "payment_requests",
            "app_settings",
        ):
            op.execute(f"DROP TRIGGER IF EXISTS trg_{table_name}_updated_at ON {table_name}")
        op.execute("DROP FUNCTION IF EXISTS prevent_append_only_mutation()")
        op.execute("DROP FUNCTION IF EXISTS set_updated_at()")
        op.execute("DROP SEQUENCE IF EXISTS reservation_code_seq")

    op.drop_index("ix_audit_log_actor_created", table_name="audit_log")
    op.drop_index("ix_audit_log_entity", table_name="audit_log")
    op.drop_index("ix_payment_events_reservation_id", table_name="payment_events")
    op.drop_index("ix_payment_events_payment_request_id", table_name="payment_events")
    op.drop_index("ix_payment_requests_status", table_name="payment_requests")
    op.drop_index("ix_payment_requests_reservation_id", table_name="payment_requests")
    op.drop_index("ix_folio_charges_posted_at", table_name="folio_charges")
    op.drop_index("ix_folio_charges_reservation_id", table_name="folio_charges")
    op.drop_index("ix_inventory_days_status_date", table_name="inventory_days")
    op.drop_index("ix_inventory_days_reservation_id", table_name="inventory_days")
    op.drop_index("ix_inventory_days_room_type_date", table_name="inventory_days")
    op.drop_index("ix_inventory_days_business_date", table_name="inventory_days")
    op.drop_index("ix_reservation_status_history_reservation_changed", table_name="reservation_status_history")
    op.drop_index("ix_reservations_departures", table_name="reservations")
    op.drop_index("ix_reservations_arrivals", table_name="reservations")
    op.drop_index("ix_reservations_source_channel", table_name="reservations")
    op.drop_index("ix_reservations_assigned_room_id", table_name="reservations")
    op.drop_index("ix_reservations_primary_guest_id", table_name="reservations")
    op.drop_index("ix_reservations_status_dates", table_name="reservations")
    op.drop_index("ix_rate_rules_date_window", table_name="rate_rules")
    op.drop_index("ix_rate_rules_room_type_active", table_name="rate_rules")
    op.drop_index("ix_rooms_room_type_id", table_name="rooms")
    op.drop_index("ix_guest_notes_guest_id", table_name="guest_notes")
    op.drop_index("ix_guests_full_name", table_name="guests")
    op.drop_index("ix_guests_email", table_name="guests")
    op.drop_index("ix_guests_phone", table_name="guests")
    op.drop_index("ix_role_permissions_permission_id", table_name="role_permissions")
    op.drop_index("ix_user_roles_role_id", table_name="user_roles")
    op.drop_index("ix_users_active_email", table_name="users")

    op.drop_table("audit_log")
    op.drop_table("payment_events")
    op.drop_table("payment_requests")
    op.drop_table("folio_charges")
    op.drop_table("inventory_days")
    op.drop_table("reservation_status_history")
    op.drop_table("reservations")
    op.drop_table("app_settings")
    op.drop_table("rate_rules")
    op.drop_table("rooms")
    op.drop_table("guest_notes")
    op.drop_table("guests")
    op.drop_table("housekeeping_statuses")
    op.drop_table("room_types")
    op.drop_table("role_permissions")
    op.drop_table("user_roles")
    op.drop_table("permissions")
    op.drop_table("roles")
    op.drop_table("users")
    op.drop_table("reservation_code_sequence")
