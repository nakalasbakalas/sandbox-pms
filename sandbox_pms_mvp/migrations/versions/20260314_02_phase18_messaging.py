"""Phase 18: Unified Guest Messaging Hub

Revision ID: a1b2c3d4e5f6
Revises: 20260314_01_phase17_pre_checkin
Create Date: 2026-03-14 07:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = "20260314_02"
down_revision = "20260314_01"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "conversation_threads",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True),
        sa.Column("guest_id", sa.Uuid(as_uuid=True), sa.ForeignKey("guests.id", ondelete="SET NULL"), nullable=True),
        sa.Column("reservation_id", sa.Uuid(as_uuid=True), sa.ForeignKey("reservations.id", ondelete="SET NULL"), nullable=True),
        sa.Column("channel", sa.String(40), nullable=False),
        sa.Column("subject", sa.String(255), nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="open"),
        sa.Column("assigned_user_id", sa.Uuid(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("last_message_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_message_preview", sa.String(255), nullable=True),
        sa.Column("unread_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("is_needs_followup", sa.Boolean, nullable=False, server_default=sa.text("0")),
        sa.Column("guest_contact_value", sa.String(255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_by_user_id", sa.Uuid(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("updated_by_user_id", sa.Uuid(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.CheckConstraint(
            "channel IN ('email','sms','whatsapp','internal_note','manual_call_log','ota_message')",
            name="ck_conversation_threads_channel",
        ),
        sa.CheckConstraint(
            "status IN ('open','waiting','closed','archived')",
            name="ck_conversation_threads_status",
        ),
    )
    op.create_index("ix_conversation_threads_guest_id", "conversation_threads", ["guest_id"])
    op.create_index("ix_conversation_threads_reservation_id", "conversation_threads", ["reservation_id"])
    op.create_index("ix_conversation_threads_status", "conversation_threads", ["status"])
    op.create_index("ix_conversation_threads_channel", "conversation_threads", ["channel"])
    op.create_index("ix_conversation_threads_last_message_at", "conversation_threads", ["last_message_at"])

    op.create_table(
        "messages",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True),
        sa.Column("thread_id", sa.Uuid(as_uuid=True), sa.ForeignKey("conversation_threads.id", ondelete="CASCADE"), nullable=False),
        sa.Column("direction", sa.String(20), nullable=False),
        sa.Column("channel", sa.String(40), nullable=False),
        sa.Column("sender_user_id", sa.Uuid(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("sender_name", sa.String(255), nullable=True),
        sa.Column("recipient_address", sa.String(255), nullable=True),
        sa.Column("subject", sa.String(255), nullable=True),
        sa.Column("body_text", sa.Text, nullable=False),
        sa.Column("body_html", sa.Text, nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="queued"),
        sa.Column("provider_message_id", sa.String(255), nullable=True),
        sa.Column("provider_error", sa.String(500), nullable=True),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("delivered_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("is_internal_note", sa.Boolean, nullable=False, server_default=sa.text("0")),
        sa.Column("template_key", sa.String(60), nullable=True),
        sa.Column("metadata_json", sa.JSON, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_by_user_id", sa.Uuid(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("updated_by_user_id", sa.Uuid(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.CheckConstraint(
            "direction IN ('inbound','outbound','internal')",
            name="ck_messages_direction",
        ),
        sa.CheckConstraint(
            "channel IN ('email','sms','whatsapp','internal_note','manual_call_log','ota_message')",
            name="ck_messages_channel",
        ),
        sa.CheckConstraint(
            "status IN ('draft','queued','sent','delivered','failed','read')",
            name="ck_messages_status",
        ),
    )
    op.create_index("ix_messages_thread_id", "messages", ["thread_id"])
    op.create_index("ix_messages_status", "messages", ["status"])
    op.create_index("ix_messages_created_at", "messages", ["created_at"])

    op.create_table(
        "message_templates",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True),
        sa.Column("template_key", sa.String(60), nullable=False),
        sa.Column("template_type", sa.String(40), nullable=False, server_default="general"),
        sa.Column("channel", sa.String(40), nullable=False, server_default="email"),
        sa.Column("language_code", sa.String(10), nullable=False, server_default="en"),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("subject_template", sa.String(500), nullable=True),
        sa.Column("body_template", sa.Text, nullable=False),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.text("1")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_by_user_id", sa.Uuid(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("updated_by_user_id", sa.Uuid(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by_user_id", sa.Uuid(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.CheckConstraint(
            "template_type IN ('booking_confirmation','pre_checkin_reminder','arrival_day_reminder','deposit_reminder','room_ready_notification','checkout_followup','manual_quote_response','inquiry_followup','general')",
            name="ck_message_templates_template_type",
        ),
        sa.CheckConstraint(
            "channel IN ('email','sms','whatsapp','internal_note','manual_call_log','ota_message')",
            name="ck_message_templates_channel",
        ),
        sa.UniqueConstraint("template_key", "channel", "language_code", name="uq_message_templates_key_channel_lang"),
    )
    op.create_index("ix_message_templates_template_key", "message_templates", ["template_key"])
    op.create_index("ix_message_templates_channel", "message_templates", ["channel"])

    op.create_table(
        "delivery_attempts",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True),
        sa.Column("message_id", sa.Uuid(as_uuid=True), sa.ForeignKey("messages.id", ondelete="CASCADE"), nullable=False),
        sa.Column("channel", sa.String(40), nullable=False),
        sa.Column("attempted_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("provider_response", sa.Text, nullable=True),
        sa.Column("error_detail", sa.String(500), nullable=True),
        sa.CheckConstraint(
            "status IN ('draft','queued','sent','delivered','failed','read')",
            name="ck_delivery_attempts_status",
        ),
    )
    op.create_index("ix_delivery_attempts_message_id", "delivery_attempts", ["message_id"])

    op.create_table(
        "automation_rules",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True),
        sa.Column("event_type", sa.String(60), nullable=False),
        sa.Column("template_id", sa.Uuid(as_uuid=True), sa.ForeignKey("message_templates.id", ondelete="SET NULL"), nullable=True),
        sa.Column("channel", sa.String(40), nullable=False, server_default="email"),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.text("0")),
        sa.Column("delay_minutes", sa.Integer, nullable=False, server_default="0"),
        sa.Column("conditions_json", sa.JSON, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_by_user_id", sa.Uuid(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("updated_by_user_id", sa.Uuid(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by_user_id", sa.Uuid(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
    )
    op.create_index("ix_automation_rules_event_type", "automation_rules", ["event_type"])


def downgrade():
    op.drop_table("automation_rules")
    op.drop_table("delivery_attempts")
    op.drop_table("message_templates")
    op.drop_table("messages")
    op.drop_table("conversation_threads")
