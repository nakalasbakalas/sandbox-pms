"""phase9 hosted payments

Revision ID: e8f9a0b1c2d3
Revises: d4e5f6a7b8c9
Create Date: 2026-03-09 20:00:00.000000

"""

from alembic import op
import sqlalchemy as sa


revision = "e8f9a0b1c2d3"
down_revision = "d4e5f6a7b8c9"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("payment_requests", recreate="always") as batch_op:
        batch_op.add_column(sa.Column("request_code", sa.String(length=32), nullable=True))
        batch_op.add_column(sa.Column("provider_payment_reference", sa.String(length=255), nullable=True))
        batch_op.add_column(sa.Column("provider_status", sa.String(length=80), nullable=True))
        batch_op.add_column(sa.Column("guest_email", sa.String(length=255), nullable=True))
        batch_op.add_column(sa.Column("guest_name", sa.String(length=255), nullable=True))
        batch_op.add_column(sa.Column("checkout_created_at", sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(sa.Column("last_sent_at", sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(sa.Column("last_synced_at", sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(sa.Column("paid_at", sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(sa.Column("failed_at", sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(sa.Column("expired_at", sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(sa.Column("metadata", sa.JSON(), nullable=True))
        batch_op.create_index("ix_payment_requests_request_code", ["request_code"], unique=False)
        batch_op.create_index("ix_payment_requests_request_type_status", ["request_type", "status"], unique=False)
        batch_op.create_index("ix_payment_requests_provider_reference", ["provider", "provider_reference"], unique=True)
        batch_op.create_unique_constraint("uq_payment_requests_request_code", ["request_code"])

    op.create_index(
        "ix_payment_events_provider_event",
        "payment_events",
        ["provider", "provider_event_id"],
        unique=True,
    )


def downgrade():
    op.drop_index("ix_payment_events_provider_event", table_name="payment_events")

    with op.batch_alter_table("payment_requests", recreate="always") as batch_op:
        batch_op.drop_constraint("uq_payment_requests_request_code", type_="unique")
        batch_op.drop_index("ix_payment_requests_provider_reference")
        batch_op.drop_index("ix_payment_requests_request_type_status")
        batch_op.drop_index("ix_payment_requests_request_code")
        batch_op.drop_column("metadata")
        batch_op.drop_column("cancelled_at")
        batch_op.drop_column("expired_at")
        batch_op.drop_column("failed_at")
        batch_op.drop_column("paid_at")
        batch_op.drop_column("last_synced_at")
        batch_op.drop_column("last_sent_at")
        batch_op.drop_column("checkout_created_at")
        batch_op.drop_column("guest_name")
        batch_op.drop_column("guest_email")
        batch_op.drop_column("provider_status")
        batch_op.drop_column("provider_payment_reference")
        batch_op.drop_column("request_code")
