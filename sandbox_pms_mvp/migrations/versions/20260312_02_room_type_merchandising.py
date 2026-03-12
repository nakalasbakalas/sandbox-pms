"""add room type merchandising content

Revision ID: 20260312_02
Revises: 20260312_01
Create Date: 2026-03-12 16:30:00.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260312_02"
down_revision = "20260312_01"
branch_labels = None
depends_on = None


JSON = sa.JSON()


def upgrade():
    with op.batch_alter_table("room_types") as batch_op:
        batch_op.add_column(sa.Column("summary", sa.String(length=280), nullable=True))
        batch_op.add_column(sa.Column("bed_details", sa.String(length=255), nullable=True))
        batch_op.add_column(sa.Column("media_urls", JSON, nullable=True))
        batch_op.add_column(sa.Column("amenities", JSON, nullable=True))
        batch_op.add_column(sa.Column("policy_callouts", JSON, nullable=True))

    op.execute(sa.text("UPDATE room_types SET bed_details = description WHERE description IS NOT NULL"))


def downgrade():
    with op.batch_alter_table("room_types") as batch_op:
        batch_op.drop_column("policy_callouts")
        batch_op.drop_column("amenities")
        batch_op.drop_column("media_urls")
        batch_op.drop_column("bed_details")
        batch_op.drop_column("summary")
