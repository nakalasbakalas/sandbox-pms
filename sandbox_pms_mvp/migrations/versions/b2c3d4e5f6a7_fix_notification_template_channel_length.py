"""fix notification template channel length

Revision ID: b2c3d4e5f6a7
Revises: a11b22c33d44
Create Date: 2026-03-10 19:35:00.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "b2c3d4e5f6a7"
down_revision = "a11b22c33d44"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("notification_templates", recreate="auto") as batch_op:
        batch_op.alter_column(
            "channel",
            existing_type=sa.String(length=20),
            type_=sa.String(length=30),
            existing_nullable=False,
            existing_server_default="email",
        )


def downgrade():
    with op.batch_alter_table("notification_templates", recreate="auto") as batch_op:
        batch_op.alter_column(
            "channel",
            existing_type=sa.String(length=30),
            type_=sa.String(length=20),
            existing_nullable=False,
            existing_server_default="email",
        )
