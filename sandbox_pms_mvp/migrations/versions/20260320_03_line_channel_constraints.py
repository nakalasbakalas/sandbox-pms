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

_TABLES = ("conversation_threads", "messages", "message_templates")


def _swap_constraints(channel_list):
    for table in _TABLES:
        constraint = f"ck_{table}_channel"
        with op.batch_alter_table(table, recreate="auto") as batch_op:
            batch_op.drop_constraint(constraint, type_="check")
            batch_op.create_check_constraint(
                constraint,
                f"channel IN ({channel_list})",
            )


def upgrade():
    _swap_constraints(NEW_CHANNELS)


def downgrade():
    _swap_constraints(OLD_CHANNELS)
