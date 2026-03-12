"""phase14 provider portal and calendar sync

Revision ID: c7d8e9f0a1b2
Revises: b2c3d4e5f6a7
Create Date: 2026-03-11 15:30:00.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "c7d8e9f0a1b2"
down_revision = "b2c3d4e5f6a7"
branch_labels = None
depends_on = None


UUID = sa.Uuid(as_uuid=True)
JSON = sa.JSON()


def _now_default() -> sa.TextClause:
    return sa.text("CURRENT_TIMESTAMP")


def upgrade():
    op.create_table(
        "calendar_feeds",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=_now_default()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=_now_default()),
        sa.Column("created_by_user_id", UUID),
        sa.Column("updated_by_user_id", UUID),
        sa.Column("scope_type", sa.String(length=20), nullable=False, server_default="property"),
        sa.Column("room_id", UUID),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("token_hash", sa.String(length=255), nullable=False),
        sa.Column("token_encrypted", sa.Text(), nullable=False),
        sa.Column("token_hint", sa.String(length=24)),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("last_accessed_at", sa.DateTime(timezone=True)),
        sa.Column("last_rotated_at", sa.DateTime(timezone=True)),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["updated_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["room_id"], ["rooms.id"], ondelete="CASCADE"),
        sa.CheckConstraint("scope_type IN ('property', 'room')", name="ck_calendar_feeds_scope_type"),
        sa.CheckConstraint(
            "((scope_type = 'property' AND room_id IS NULL) OR (scope_type = 'room' AND room_id IS NOT NULL))",
            name="ck_calendar_feeds_scope_target",
        ),
        sa.UniqueConstraint("token_hash", name="uq_calendar_feeds_token_hash"),
    )
    op.create_index("ix_calendar_feeds_scope_active", "calendar_feeds", ["scope_type", "is_active"], unique=False)
    op.create_index("ix_calendar_feeds_room_active", "calendar_feeds", ["room_id", "is_active"], unique=False)

    op.create_table(
        "external_calendar_sources",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=_now_default()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=_now_default()),
        sa.Column("created_by_user_id", UUID),
        sa.Column("updated_by_user_id", UUID),
        sa.Column("deleted_at", sa.DateTime(timezone=True)),
        sa.Column("deleted_by_user_id", UUID),
        sa.Column("room_id", UUID, nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("feed_url_encrypted", sa.Text(), nullable=False),
        sa.Column("feed_url_hint", sa.String(length=255)),
        sa.Column("external_reference", sa.String(length=255)),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("last_synced_at", sa.DateTime(timezone=True)),
        sa.Column("last_successful_sync_at", sa.DateTime(timezone=True)),
        sa.Column("last_status", sa.String(length=20), nullable=False, server_default="never_synced"),
        sa.Column("last_error", sa.String(length=255)),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["updated_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["deleted_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["room_id"], ["rooms.id"], ondelete="CASCADE"),
        sa.CheckConstraint(
            "last_status IN ('never_synced', 'success', 'failed', 'conflict', 'disabled')",
            name="ck_external_calendar_sources_last_status",
        ),
    )
    op.create_index(
        "ix_external_calendar_sources_room_active",
        "external_calendar_sources",
        ["room_id", "is_active"],
        unique=False,
    )
    op.create_index(
        "ix_external_calendar_sources_status",
        "external_calendar_sources",
        ["last_status"],
        unique=False,
    )

    op.create_table(
        "external_calendar_blocks",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=_now_default()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=_now_default()),
        sa.Column("created_by_user_id", UUID),
        sa.Column("updated_by_user_id", UUID),
        sa.Column("source_id", UUID, nullable=False),
        sa.Column("room_id", UUID, nullable=False),
        sa.Column("external_uid", sa.String(length=255), nullable=False),
        sa.Column("summary", sa.String(length=255)),
        sa.Column("starts_on", sa.Date(), nullable=False),
        sa.Column("ends_on", sa.Date(), nullable=False),
        sa.Column("event_created_at", sa.DateTime(timezone=True)),
        sa.Column("event_updated_at", sa.DateTime(timezone=True)),
        sa.Column("raw_status", sa.String(length=80)),
        sa.Column("is_conflict", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("conflict_reason", sa.String(length=255)),
        sa.Column("conflict_reservation_id", UUID),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False, server_default=_now_default()),
        sa.Column("metadata", JSON),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["updated_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["source_id"], ["external_calendar_sources.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["room_id"], ["rooms.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["conflict_reservation_id"], ["reservations.id"], ondelete="SET NULL"),
        sa.CheckConstraint("starts_on < ends_on", name="ck_external_calendar_blocks_dates"),
        sa.UniqueConstraint("source_id", "external_uid", name="uq_external_calendar_blocks_source_uid"),
    )
    op.create_index(
        "ix_external_calendar_blocks_room_dates",
        "external_calendar_blocks",
        ["room_id", "starts_on", "ends_on"],
        unique=False,
    )
    op.create_index(
        "ix_external_calendar_blocks_source_seen",
        "external_calendar_blocks",
        ["source_id", "last_seen_at"],
        unique=False,
    )
    op.create_index(
        "ix_external_calendar_blocks_conflict",
        "external_calendar_blocks",
        ["is_conflict", "starts_on"],
        unique=False,
    )

    op.create_table(
        "external_calendar_sync_runs",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=_now_default()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=_now_default()),
        sa.Column("created_by_user_id", UUID),
        sa.Column("updated_by_user_id", UUID),
        sa.Column("source_id", UUID, nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="success"),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False, server_default=_now_default()),
        sa.Column("finished_at", sa.DateTime(timezone=True)),
        sa.Column("fetched_event_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("upserted_block_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("duplicate_event_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("released_block_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("conflict_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("error_message", sa.String(length=255)),
        sa.Column("metadata", JSON),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["updated_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["source_id"], ["external_calendar_sources.id"], ondelete="CASCADE"),
        sa.CheckConstraint(
            "status IN ('success', 'failed', 'conflict')",
            name="ck_external_calendar_sync_runs_status",
        ),
        sa.CheckConstraint("fetched_event_count >= 0", name="ck_external_calendar_sync_runs_fetched"),
        sa.CheckConstraint("upserted_block_count >= 0", name="ck_external_calendar_sync_runs_upserted"),
        sa.CheckConstraint("duplicate_event_count >= 0", name="ck_external_calendar_sync_runs_duplicates"),
        sa.CheckConstraint("released_block_count >= 0", name="ck_external_calendar_sync_runs_released"),
        sa.CheckConstraint("conflict_count >= 0", name="ck_external_calendar_sync_runs_conflicts"),
    )
    op.create_index(
        "ix_external_calendar_sync_runs_source_started",
        "external_calendar_sync_runs",
        ["source_id", "started_at"],
        unique=False,
    )
    op.create_index(
        "ix_external_calendar_sync_runs_status_started",
        "external_calendar_sync_runs",
        ["status", "started_at"],
        unique=False,
    )


def downgrade():
    op.drop_index("ix_external_calendar_sync_runs_status_started", table_name="external_calendar_sync_runs")
    op.drop_index("ix_external_calendar_sync_runs_source_started", table_name="external_calendar_sync_runs")
    op.drop_table("external_calendar_sync_runs")

    op.drop_index("ix_external_calendar_blocks_conflict", table_name="external_calendar_blocks")
    op.drop_index("ix_external_calendar_blocks_source_seen", table_name="external_calendar_blocks")
    op.drop_index("ix_external_calendar_blocks_room_dates", table_name="external_calendar_blocks")
    op.drop_table("external_calendar_blocks")

    op.drop_index("ix_external_calendar_sources_status", table_name="external_calendar_sources")
    op.drop_index("ix_external_calendar_sources_room_active", table_name="external_calendar_sources")
    op.drop_table("external_calendar_sources")

    op.drop_index("ix_calendar_feeds_room_active", table_name="calendar_feeds")
    op.drop_index("ix_calendar_feeds_scope_active", table_name="calendar_feeds")
    op.drop_table("calendar_feeds")
