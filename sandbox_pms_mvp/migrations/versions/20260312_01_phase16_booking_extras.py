"""phase16 booking extras

Revision ID: 20260312_01
Revises: c7d8e9f0a1b2
Create Date: 2026-03-12 11:30:00.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260312_01"
down_revision = "c7d8e9f0a1b2"
branch_labels = None
depends_on = None


UUID = sa.Uuid(as_uuid=True)


def _now_default() -> sa.TextClause:
    return sa.text("CURRENT_TIMESTAMP")


def upgrade():
    op.create_table(
        "booking_extras",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=_now_default()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=_now_default()),
        sa.Column("created_by_user_id", UUID),
        sa.Column("updated_by_user_id", UUID),
        sa.Column("code", sa.String(length=40), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("description", sa.Text()),
        sa.Column("pricing_mode", sa.String(length=20), nullable=False, server_default="per_stay"),
        sa.Column("unit_price", sa.Numeric(10, 2), nullable=False, server_default="0"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("is_public", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="100"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["updated_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.CheckConstraint("pricing_mode IN ('per_stay', 'per_night')", name="ck_booking_extras_pricing_mode"),
        sa.CheckConstraint("unit_price >= 0", name="ck_booking_extras_unit_price"),
        sa.CheckConstraint("sort_order >= 0", name="ck_booking_extras_sort_order"),
        sa.UniqueConstraint("code", name="uq_booking_extras_code"),
    )
    op.create_index("ix_booking_extras_public_active", "booking_extras", ["is_public", "is_active", "sort_order"], unique=False)

    with op.batch_alter_table("reservations", recreate="auto") as batch_op:
        batch_op.add_column(sa.Column("quoted_extras_total", sa.Numeric(10, 2), nullable=False, server_default="0"))
        batch_op.create_check_constraint("ck_reservations_extras_total", "quoted_extras_total >= 0")

    with op.batch_alter_table("folio_charges", recreate="auto") as batch_op:
        batch_op.drop_constraint("ck_folio_charges_charge_code", type_="check")
        batch_op.create_check_constraint(
            "ck_folio_charges_charge_code",
            "charge_code IN ('RM', 'VAT', 'DEP', 'DEP_APPL', 'PMT-CASH', 'PMT-QR', 'PMT-CARD', 'PMT-BANK', 'EXG', 'EXB', 'ECI', 'LCO', 'LND', 'SNK', 'TEL', 'XTR', 'ADJ_POS', 'ADJ_NEG', 'CORR', 'REF')",
        )

    op.create_table(
        "reservation_extras",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=_now_default()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=_now_default()),
        sa.Column("created_by_user_id", UUID),
        sa.Column("updated_by_user_id", UUID),
        sa.Column("reservation_id", UUID, nullable=False),
        sa.Column("booking_extra_id", UUID),
        sa.Column("posted_folio_charge_id", UUID),
        sa.Column("extra_code", sa.String(length=40), nullable=False),
        sa.Column("extra_name", sa.String(length=120), nullable=False),
        sa.Column("description", sa.String(length=255)),
        sa.Column("pricing_mode", sa.String(length=20), nullable=False, server_default="per_stay"),
        sa.Column("quantity", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("unit_price", sa.Numeric(10, 2), nullable=False, server_default="0"),
        sa.Column("total_amount", sa.Numeric(10, 2), nullable=False, server_default="0"),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="100"),
        sa.Column("source", sa.String(length=40), nullable=False, server_default="public_booking"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["updated_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["reservation_id"], ["reservations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["booking_extra_id"], ["booking_extras.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["posted_folio_charge_id"], ["folio_charges.id"], ondelete="SET NULL"),
        sa.CheckConstraint("pricing_mode IN ('per_stay', 'per_night')", name="ck_reservation_extras_pricing_mode"),
        sa.CheckConstraint("quantity >= 1", name="ck_reservation_extras_quantity"),
        sa.CheckConstraint("unit_price >= 0", name="ck_reservation_extras_unit_price"),
        sa.CheckConstraint("total_amount >= 0", name="ck_reservation_extras_total_amount"),
        sa.CheckConstraint("sort_order >= 0", name="ck_reservation_extras_sort_order"),
    )
    op.create_index("ix_reservation_extras_reservation_id", "reservation_extras", ["reservation_id"], unique=False)
    op.create_index("ix_reservation_extras_booking_extra_id", "reservation_extras", ["booking_extra_id"], unique=False)


def downgrade():
    op.drop_index("ix_reservation_extras_booking_extra_id", table_name="reservation_extras")
    op.drop_index("ix_reservation_extras_reservation_id", table_name="reservation_extras")
    op.drop_table("reservation_extras")

    with op.batch_alter_table("folio_charges", recreate="auto") as batch_op:
        batch_op.drop_constraint("ck_folio_charges_charge_code", type_="check")
        batch_op.create_check_constraint(
            "ck_folio_charges_charge_code",
            "charge_code IN ('RM', 'VAT', 'DEP', 'DEP_APPL', 'PMT-CASH', 'PMT-QR', 'PMT-CARD', 'PMT-BANK', 'EXG', 'EXB', 'ECI', 'LCO', 'LND', 'SNK', 'TEL', 'ADJ_POS', 'ADJ_NEG', 'CORR', 'REF')",
        )

    with op.batch_alter_table("reservations", recreate="auto") as batch_op:
        batch_op.drop_constraint("ck_reservations_extras_total", type_="check")
        batch_op.drop_column("quoted_extras_total")

    op.drop_index("ix_booking_extras_public_active", table_name="booking_extras")
    op.drop_table("booking_extras")
