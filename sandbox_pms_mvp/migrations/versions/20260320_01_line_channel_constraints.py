"""Add LINE guest messaging channel constraints.

Revision ID: 20260320_03
Revises: 20260320_02
Create Date: 2026-03-20 18:10:00.000000
"""
from alembic import op


revision = "20260320_03"
down_revision = "20260320_02"
branch_labels = None
depends_on = None


OLD_CHANNELS = "'email','sms','whatsapp','internal_note','manual_call_log','ota_message'"
NEW_CHANNELS = "'email','sms','line','whatsapp','internal_note','manual_call_log','ota_message'"


def upgrade():
    with op.batch_alter_table("conversation_threads", recreate="always") as batch_op:
        batch_op.drop_constraint("ck_conversation_threads_channel", type_="check")
        batch_op.create_check_constraint(
            "ck_conversation_threads_channel",
            f"channel IN ({NEW_CHANNELS})",
        )

    with op.batch_alter_table("messages", recreate="always") as batch_op:
        batch_op.drop_constraint("ck_messages_channel", type_="check")
        batch_op.create_check_constraint(
            "ck_messages_channel",
            f"channel IN ({NEW_CHANNELS})",
        )

    with op.batch_alter_table("message_templates", recreate="always") as batch_op:
        batch_op.drop_constraint("ck_message_templates_channel", type_="check")
        batch_op.create_check_constraint(
            "ck_message_templates_channel",
            f"channel IN ({NEW_CHANNELS})",
        )


def downgrade():
    with op.batch_alter_table("message_templates", recreate="always") as batch_op:
        batch_op.drop_constraint("ck_message_templates_channel", type_="check")
        batch_op.create_check_constraint(
            "ck_message_templates_channel",
            f"channel IN ({OLD_CHANNELS})",
        )

    with op.batch_alter_table("messages", recreate="always") as batch_op:
        batch_op.drop_constraint("ck_messages_channel", type_="check")
        batch_op.create_check_constraint(
            "ck_messages_channel",
            f"channel IN ({OLD_CHANNELS})",
        )

    with op.batch_alter_table("conversation_threads", recreate="always") as batch_op:
        batch_op.drop_constraint("ck_conversation_threads_channel", type_="check")
        batch_op.create_check_constraint(
            "ck_conversation_threads_channel",
            f"channel IN ({OLD_CHANNELS})",
        )
