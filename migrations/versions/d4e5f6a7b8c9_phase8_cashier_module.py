"""phase8 cashier module

Revision ID: d4e5f6a7b8c9
Revises: b6c3d9a42f10
Create Date: 2026-03-09 16:00:00.000000

"""

from alembic import op
import sqlalchemy as sa


revision = "d4e5f6a7b8c9"
down_revision = "b6c3d9a42f10"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("folio_charges", recreate="always") as batch_op:
        batch_op.drop_constraint("ck_folio_charges_charge_code", type_="check")
        batch_op.drop_constraint("ck_folio_charges_tax_amount", type_="check")
        batch_op.add_column(sa.Column("posting_key", sa.String(length=160), nullable=True))
        batch_op.add_column(sa.Column("voided_at", sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(sa.Column("voided_by_user_id", sa.Uuid(), nullable=True))
        batch_op.add_column(sa.Column("void_reason", sa.String(length=255), nullable=True))
        batch_op.create_foreign_key(
            "fk_folio_charges_voided_by_user_id_users",
            "users",
            ["voided_by_user_id"],
            ["id"],
            ondelete="SET NULL",
        )
        batch_op.create_check_constraint(
            "ck_folio_charges_charge_code",
            "charge_code IN ('RM', 'VAT', 'DEP', 'DEP_APPL', 'PMT-CASH', 'PMT-QR', 'PMT-CARD', 'PMT-BANK', 'EXG', 'EXB', 'ECI', 'LCO', 'LND', 'SNK', 'TEL', 'ADJ_POS', 'ADJ_NEG', 'CORR', 'REF')",
        )
        batch_op.create_check_constraint(
            "ck_folio_charges_charge_type",
            "charge_type IN ('room', 'tax', 'deposit', 'deposit_application', 'payment', 'manual_charge', 'manual_discount', 'fee', 'refund', 'correction')",
        )
        batch_op.create_check_constraint(
            "ck_folio_charges_tax_amount",
            "((total_amount >= 0 AND tax_amount >= 0) OR (total_amount < 0 AND tax_amount <= 0))",
        )
        batch_op.create_unique_constraint("uq_folio_charges_posting_key", ["posting_key"])
        batch_op.create_index("ix_folio_charges_service_date", ["service_date"], unique=False)

    op.create_table(
        "cashier_document_sequences",
        sa.Column("sequence_name", sa.String(length=80), primary_key=True),
        sa.Column("next_value", sa.BigInteger(), nullable=False),
    )

    op.create_table(
        "cashier_documents",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("reservation_id", sa.Uuid(), nullable=False),
        sa.Column("document_type", sa.String(length=20), nullable=False),
        sa.Column("document_number", sa.String(length=40), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="issued"),
        sa.Column("total_amount", sa.Numeric(10, 2), nullable=False, server_default="0"),
        sa.Column("currency_code", sa.String(length=3), nullable=False, server_default="THB"),
        sa.Column("issued_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("issued_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("printed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("voided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("voided_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("void_reason", sa.String(length=255), nullable=True),
        sa.Column("metadata", sa.JSON(), nullable=True),
        sa.CheckConstraint("document_type IN ('folio', 'invoice', 'receipt')", name="ck_cashier_documents_document_type"),
        sa.CheckConstraint("status IN ('issued', 'voided')", name="ck_cashier_documents_status"),
        sa.CheckConstraint("total_amount >= 0", name="ck_cashier_documents_total_amount"),
        sa.ForeignKeyConstraint(["reservation_id"], ["reservations.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["issued_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["voided_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("document_number", name="uq_cashier_documents_document_number"),
    )
    op.create_index("ix_cashier_documents_reservation_id", "cashier_documents", ["reservation_id"], unique=False)
    op.create_index("ix_cashier_documents_document_type", "cashier_documents", ["document_type"], unique=False)

    op.create_table(
        "cashier_activity_log",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("reservation_id", sa.Uuid(), nullable=True),
        sa.Column("folio_charge_id", sa.Uuid(), nullable=True),
        sa.Column("cashier_document_id", sa.Uuid(), nullable=True),
        sa.Column("actor_user_id", sa.Uuid(), nullable=True),
        sa.Column("event_type", sa.String(length=120), nullable=False),
        sa.Column("amount", sa.Numeric(10, 2), nullable=True),
        sa.Column("note", sa.String(length=255), nullable=True),
        sa.Column("metadata", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.ForeignKeyConstraint(["reservation_id"], ["reservations.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["folio_charge_id"], ["folio_charges.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["cashier_document_id"], ["cashier_documents.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["actor_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_cashier_activity_reservation_created", "cashier_activity_log", ["reservation_id", "created_at"], unique=False)
    op.create_index("ix_cashier_activity_event_created", "cashier_activity_log", ["event_type", "created_at"], unique=False)


def downgrade():
    op.drop_index("ix_cashier_activity_event_created", table_name="cashier_activity_log")
    op.drop_index("ix_cashier_activity_reservation_created", table_name="cashier_activity_log")
    op.drop_table("cashier_activity_log")

    op.drop_index("ix_cashier_documents_document_type", table_name="cashier_documents")
    op.drop_index("ix_cashier_documents_reservation_id", table_name="cashier_documents")
    op.drop_table("cashier_documents")

    op.drop_table("cashier_document_sequences")

    with op.batch_alter_table("folio_charges", recreate="always") as batch_op:
        batch_op.drop_index("ix_folio_charges_service_date")
        batch_op.drop_constraint("uq_folio_charges_posting_key", type_="unique")
        batch_op.drop_constraint("ck_folio_charges_tax_amount", type_="check")
        batch_op.drop_constraint("ck_folio_charges_charge_type", type_="check")
        batch_op.drop_constraint("ck_folio_charges_charge_code", type_="check")
        batch_op.drop_constraint("fk_folio_charges_voided_by_user_id_users", type_="foreignkey")
        batch_op.drop_column("void_reason")
        batch_op.drop_column("voided_by_user_id")
        batch_op.drop_column("voided_at")
        batch_op.drop_column("posting_key")
        batch_op.create_check_constraint(
            "ck_folio_charges_charge_code",
            "charge_code IN ('RM', 'VAT', 'DEP', 'DEP_APPL', 'EXG', 'EXB', 'ECI', 'LCO', 'LND', 'SNK', 'TEL', 'ADJ_POS', 'ADJ_NEG', 'REF')",
        )
        batch_op.create_check_constraint("ck_folio_charges_tax_amount", "tax_amount >= 0")
