"""Add extra charge codes and complimentary payment method to folio_charges

Revision ID: 20260326_02
Revises: 20260326_01
Create Date: 2026-03-26 11:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260326_02"
down_revision = "20260326_01"
branch_labels = None
depends_on = None

# Updated list: adds PMT-COMP, FNB, MINI, TRNS, DMG
_NEW_CHARGE_CODES = (
    "'RM', 'VAT', 'DEP', 'DEP_APPL', "
    "'PMT-CASH', 'PMT-QR', 'PMT-CARD', 'PMT-BANK', 'PMT-COMP', "
    "'EXG', 'EXB', 'ECI', 'LCO', 'LND', 'SNK', 'TEL', 'XTR', "
    "'FNB', 'MINI', 'TRNS', 'DMG', "
    "'ADJ_POS', 'ADJ_NEG', 'CORR', 'REF'"
)

_OLD_CHARGE_CODES = (
    "'RM', 'VAT', 'DEP', 'DEP_APPL', "
    "'PMT-CASH', 'PMT-QR', 'PMT-CARD', 'PMT-BANK', "
    "'EXG', 'EXB', 'ECI', 'LCO', 'LND', 'SNK', 'TEL', 'XTR', "
    "'ADJ_POS', 'ADJ_NEG', 'CORR', 'REF'"
)


def upgrade() -> None:
    with op.batch_alter_table("folio_charges", recreate="auto") as batch_op:
        batch_op.drop_constraint("ck_folio_charges_charge_code", type_="check")
        batch_op.create_check_constraint(
            "ck_folio_charges_charge_code",
            f"charge_code IN ({_NEW_CHARGE_CODES})",
        )


def downgrade() -> None:
    with op.batch_alter_table("folio_charges", recreate="auto") as batch_op:
        batch_op.drop_constraint("ck_folio_charges_charge_code", type_="check")
        batch_op.create_check_constraint(
            "ck_folio_charges_charge_code",
            f"charge_code IN ({_OLD_CHARGE_CODES})",
        )
