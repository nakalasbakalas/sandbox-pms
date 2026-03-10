"""phase6 front desk identity fields

Revision ID: 9f4a6b2d1e31
Revises: 3a5f64b2d8b1
Create Date: 2026-03-08 22:10:00.000000

"""

from alembic import op
import sqlalchemy as sa


revision = "9f4a6b2d1e31"
down_revision = "3a5f64b2d8b1"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("reservations", recreate="always") as batch_op:
        batch_op.add_column(sa.Column("identity_verified_at", sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(sa.Column("identity_verified_by_user_id", sa.Uuid(), nullable=True))
        batch_op.create_foreign_key(
            "fk_reservations_identity_verified_by_user_id_users",
            "users",
            ["identity_verified_by_user_id"],
            ["id"],
            ondelete="SET NULL",
        )


def downgrade():
    with op.batch_alter_table("reservations", recreate="always") as batch_op:
        batch_op.drop_constraint("fk_reservations_identity_verified_by_user_id_users", type_="foreignkey")
        batch_op.drop_column("identity_verified_by_user_id")
        batch_op.drop_column("identity_verified_at")
