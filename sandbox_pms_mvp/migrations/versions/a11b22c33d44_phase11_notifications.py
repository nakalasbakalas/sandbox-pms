"""phase11 notifications

Revision ID: a11b22c33d44
Revises: f1a2b3c4d5e6
Create Date: 2026-03-10 10:15:00.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "a11b22c33d44"
down_revision = "f1a2b3c4d5e6"
branch_labels = None
depends_on = None


UUID = sa.Uuid(as_uuid=True)
JSON = sa.JSON()


def _now_default() -> sa.TextClause:
    return sa.text("CURRENT_TIMESTAMP")


def upgrade():
    op.create_table(
        "notification_deliveries",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("event_type", sa.String(length=80), nullable=False),
        sa.Column("reservation_id", UUID),
        sa.Column("payment_request_id", UUID),
        sa.Column("audience_type", sa.String(length=20), nullable=False),
        sa.Column("channel", sa.String(length=30), nullable=False),
        sa.Column("template_id", UUID),
        sa.Column("template_key", sa.String(length=80)),
        sa.Column("language_code", sa.String(length=20), nullable=False, server_default="th"),
        sa.Column("recipient_target", sa.String(length=255)),
        sa.Column("recipient_name", sa.String(length=255)),
        sa.Column("event_key", sa.String(length=160)),
        sa.Column("dedupe_key", sa.String(length=160), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="pending"),
        sa.Column("failure_category", sa.String(length=40)),
        sa.Column("failure_reason", sa.String(length=255)),
        sa.Column("rendered_subject", sa.Text()),
        sa.Column("rendered_body", sa.Text()),
        sa.Column("metadata", JSON),
        sa.Column("email_outbox_id", UUID),
        sa.Column("staff_notification_id", UUID),
        sa.Column("external_message_id", sa.String(length=255)),
        sa.Column("queued_at", sa.DateTime(timezone=True)),
        sa.Column("sent_at", sa.DateTime(timezone=True)),
        sa.Column("delivered_at", sa.DateTime(timezone=True)),
        sa.Column("failed_at", sa.DateTime(timezone=True)),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=_now_default()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=_now_default()),
        sa.Column("created_by_user_id", UUID),
        sa.Column("updated_by_user_id", UUID),
        sa.ForeignKeyConstraint(["reservation_id"], ["reservations.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["payment_request_id"], ["payment_requests.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["template_id"], ["notification_templates.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["email_outbox_id"], ["email_outbox.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["staff_notification_id"], ["staff_notifications.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["updated_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.CheckConstraint(
            "audience_type IN ('guest', 'staff')",
            name="ck_notification_deliveries_audience",
        ),
        sa.CheckConstraint(
            "channel IN ('email', 'internal_notification', 'line_staff_alert', 'whatsapp_staff_alert')",
            name="ck_notification_deliveries_channel",
        ),
        sa.CheckConstraint(
            "language_code IN ('th', 'en', 'zh-Hans')",
            name="ck_notification_deliveries_language",
        ),
        sa.CheckConstraint(
            "status IN ('pending', 'queued', 'sent', 'delivered', 'failed', 'skipped', 'cancelled')",
            name="ck_notification_deliveries_status",
        ),
        sa.CheckConstraint("attempts >= 0", name="ck_notification_deliveries_attempts"),
        sa.UniqueConstraint("dedupe_key", name="uq_notification_deliveries_dedupe_key"),
    )
    op.create_index(
        "ix_notification_deliveries_reservation_created",
        "notification_deliveries",
        ["reservation_id", "created_at"],
        unique=False,
    )
    op.create_index(
        "ix_notification_deliveries_payment_created",
        "notification_deliveries",
        ["payment_request_id", "created_at"],
        unique=False,
    )
    op.create_index(
        "ix_notification_deliveries_status_created",
        "notification_deliveries",
        ["status", "created_at"],
        unique=False,
    )
    op.create_index(
        "ix_notification_deliveries_channel_status",
        "notification_deliveries",
        ["channel", "status"],
        unique=False,
    )
    op.create_index(
        "ix_notification_deliveries_event_created",
        "notification_deliveries",
        ["event_type", "created_at"],
        unique=False,
    )

    with op.batch_alter_table("notification_templates", recreate="always") as batch_op:
        batch_op.drop_constraint("ck_notification_templates_key", type_="check")
        batch_op.drop_constraint("ck_notification_templates_channel", type_="check")
        batch_op.drop_constraint("ck_notification_templates_language", type_="check")
        batch_op.create_check_constraint(
            "ck_notification_templates_key",
            "template_key IN ('guest_confirmation', 'deposit_payment_request', 'payment_success', "
            "'payment_failed', 'pre_arrival_reminder', 'cancellation_confirmation', "
            "'modification_confirmation', 'cancellation_request_received', "
            "'modification_request_received', 'internal_new_booking_alert', 'internal_activity_alert')",
        )
        batch_op.create_check_constraint(
            "ck_notification_templates_channel",
            "channel IN ('email', 'internal_notification', 'line_staff_alert', 'whatsapp_staff_alert')",
        )
        batch_op.create_check_constraint(
            "ck_notification_templates_language",
            "language_code IN ('th', 'en', 'zh-Hans')",
        )


def downgrade():
    with op.batch_alter_table("notification_templates", recreate="always") as batch_op:
        batch_op.drop_constraint("ck_notification_templates_key", type_="check")
        batch_op.drop_constraint("ck_notification_templates_channel", type_="check")
        batch_op.drop_constraint("ck_notification_templates_language", type_="check")
        batch_op.create_check_constraint(
            "ck_notification_templates_key",
            "template_key IN ('guest_confirmation', 'deposit_payment_request', 'payment_success', "
            "'payment_failed', 'cancellation_request_received', 'modification_request_received', "
            "'internal_new_booking_alert')",
        )
        batch_op.create_check_constraint(
            "ck_notification_templates_channel",
            "channel IN ('email')",
        )
        batch_op.create_check_constraint(
            "ck_notification_templates_language",
            "language_code IN ('th', 'en', 'zh-Hans')",
        )

    op.drop_index("ix_notification_deliveries_event_created", table_name="notification_deliveries")
    op.drop_index("ix_notification_deliveries_channel_status", table_name="notification_deliveries")
    op.drop_index("ix_notification_deliveries_status_created", table_name="notification_deliveries")
    op.drop_index("ix_notification_deliveries_payment_created", table_name="notification_deliveries")
    op.drop_index("ix_notification_deliveries_reservation_created", table_name="notification_deliveries")
    op.drop_table("notification_deliveries")
