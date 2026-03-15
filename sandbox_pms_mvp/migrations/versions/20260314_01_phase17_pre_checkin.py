"""Add pre_checkins and reservation_documents tables for Digital Pre-Check-In module

Revision ID: 20260314_01
Revises: 20260313_01
Create Date: 2026-03-14 00:00:00.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260314_01"
down_revision = "20260313_01"
branch_labels = None
depends_on = None

UUID = sa.Uuid(as_uuid=True)
JSON = sa.JSON()

PRE_CHECKIN_STATUSES = [
    "not_sent", "sent", "opened", "in_progress",
    "submitted", "verified", "incomplete", "rejected", "expired",
]
ARRIVAL_READINESS_STATES = [
    "awaiting_guest", "docs_missing", "id_uploaded", "signature_missing",
    "payment_pending", "ready_for_arrival", "checked_at_desk",
]
DOCUMENT_TYPES = ["passport", "national_id", "driving_license", "other"]
DOCUMENT_VERIFICATION_STATUSES = ["pending", "verified", "rejected"]


def _now_default() -> sa.TextClause:
    return sa.text("CURRENT_TIMESTAMP")


def _ck_in(values: list[str]) -> str:
    return ", ".join(repr(v) for v in values)


def upgrade():
    op.create_table(
        "pre_checkins",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=_now_default()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=_now_default()),
        sa.Column("created_by_user_id", UUID, nullable=True),
        sa.Column("updated_by_user_id", UUID, nullable=True),
        sa.Column("reservation_id", UUID, nullable=False),
        sa.Column("token", sa.String(120), nullable=False),
        sa.Column("status", sa.String(30), nullable=False, server_default="not_sent"),
        sa.Column("readiness", sa.String(40), nullable=False, server_default="awaiting_guest"),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("eta", sa.String(40), nullable=True),
        sa.Column("special_requests", sa.Text, nullable=True),
        sa.Column("notes_for_staff", sa.Text, nullable=True),
        sa.Column("number_of_occupants", sa.Integer, nullable=True),
        sa.Column("primary_contact_name", sa.String(255), nullable=True),
        sa.Column("primary_contact_phone", sa.String(60), nullable=True),
        sa.Column("primary_contact_email", sa.String(255), nullable=True),
        sa.Column("nationality", sa.String(80), nullable=True),
        sa.Column("vehicle_registration", sa.String(80), nullable=True),
        sa.Column("acknowledgment_accepted", sa.Boolean, nullable=False, server_default=sa.text("false")),
        sa.Column("acknowledgment_name", sa.String(255), nullable=True),
        sa.Column("acknowledgment_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("occupant_details", JSON, nullable=True),
        sa.Column("link_sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("link_opened_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["reservation_id"], ["reservations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["updated_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.CheckConstraint(f"status IN ({_ck_in(PRE_CHECKIN_STATUSES)})", name="ck_pre_checkins_status"),
        sa.CheckConstraint(
            f"readiness IN ({_ck_in(ARRIVAL_READINESS_STATES)})", name="ck_pre_checkins_readiness"
        ),
        sa.UniqueConstraint("reservation_id", name="uq_pre_checkins_reservation_id"),
        sa.UniqueConstraint("token", name="uq_pre_checkins_token"),
    )
    op.create_index("ix_pre_checkins_token", "pre_checkins", ["token"])
    op.create_index("ix_pre_checkins_reservation_id", "pre_checkins", ["reservation_id"])
    op.create_index("ix_pre_checkins_status", "pre_checkins", ["status"])

    op.create_table(
        "reservation_documents",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=_now_default()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=_now_default()),
        sa.Column("created_by_user_id", UUID, nullable=True),
        sa.Column("updated_by_user_id", UUID, nullable=True),
        sa.Column("reservation_id", UUID, nullable=False),
        sa.Column("guest_id", UUID, nullable=True),
        sa.Column("document_type", sa.String(40), nullable=False),
        sa.Column("storage_key", sa.String(500), nullable=False),
        sa.Column("original_filename", sa.String(255), nullable=False),
        sa.Column("content_type", sa.String(120), nullable=False),
        sa.Column("file_size_bytes", sa.Integer, nullable=False),
        sa.Column("uploaded_at", sa.DateTime(timezone=True), nullable=False, server_default=_now_default()),
        sa.Column("verification_status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("verified_by_user_id", UUID, nullable=True),
        sa.Column("verified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("rejection_reason", sa.String(255), nullable=True),
        sa.ForeignKeyConstraint(["reservation_id"], ["reservations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["guest_id"], ["guests.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["updated_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["verified_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.CheckConstraint(
            f"document_type IN ({_ck_in(DOCUMENT_TYPES)})",
            name="ck_reservation_documents_document_type",
        ),
        sa.CheckConstraint(
            f"verification_status IN ({_ck_in(DOCUMENT_VERIFICATION_STATUSES)})",
            name="ck_reservation_documents_verification_status",
        ),
        sa.CheckConstraint("file_size_bytes > 0", name="ck_reservation_documents_file_size"),
    )
    op.create_index("ix_reservation_documents_reservation_id", "reservation_documents", ["reservation_id"])
    op.create_index(
        "ix_reservation_documents_verification_status", "reservation_documents", ["verification_status"]
    )


def downgrade():
    op.drop_index("ix_reservation_documents_verification_status", table_name="reservation_documents")
    op.drop_index("ix_reservation_documents_reservation_id", table_name="reservation_documents")
    op.drop_table("reservation_documents")
    op.drop_index("ix_pre_checkins_status", table_name="pre_checkins")
    op.drop_index("ix_pre_checkins_reservation_id", table_name="pre_checkins")
    op.drop_index("ix_pre_checkins_token", table_name="pre_checkins")
    op.drop_table("pre_checkins")
