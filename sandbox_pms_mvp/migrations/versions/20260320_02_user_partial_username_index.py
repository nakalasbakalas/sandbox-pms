"""Add PostgreSQL partial index for active usernames

Revision ID: 20260320_02
Revises: 20260320_01
Create Date: 2026-03-20 16:10:00.000000
"""
from alembic import op


revision = "20260320_02"
down_revision = "20260320_01"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_users_active_username_live ON users (username) WHERE deleted_at IS NULL"
    )


def downgrade():
    op.execute("DROP INDEX IF EXISTS ix_users_active_username_live")
