"""Add ocr_extracted_data column to reservation_documents

Revision ID: 20260317_02
Revises: 20260317_01
Create Date: 2026-03-17 12:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = "20260317_02"
down_revision = "20260317_01"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "reservation_documents",
        sa.Column("ocr_extracted_data", sa.JSON, nullable=True),
    )


def downgrade():
    op.drop_column("reservation_documents", "ocr_extracted_data")
