"""Add composite folio charge index for reservation and void status

Revision ID: 20260320_01
Revises: 20260317_02
Create Date: 2026-03-20 14:30:00.000000
"""
from alembic import op


revision = "20260320_01"
down_revision = "20260317_02"
branch_labels = None
depends_on = None


def upgrade():
    op.create_index(
        "ix_folio_charges_reservation_voided",
        "folio_charges",
        ["reservation_id", "voided_at"],
    )


def downgrade():
    op.drop_index("ix_folio_charges_reservation_voided", table_name="folio_charges")
