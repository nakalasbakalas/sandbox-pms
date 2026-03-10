from __future__ import annotations

import uuid
from datetime import datetime, timezone

import sqlalchemy as sa
from sqlalchemy import CheckConstraint, ForeignKey, Index, UniqueConstraint, event
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .constants import (
    AUTH_FAILURE_REASONS,
    BLACKOUT_TYPES,
    BOOKING_LANGUAGES,
    BOOKING_SOURCE_CHANNELS,
    CASHIER_DOCUMENT_STATUSES,
    CASHIER_DOCUMENT_TYPES,
    CANCELLATION_REQUEST_STATUSES,
    EMAIL_OUTBOX_STATUSES,
    FOLIO_CHARGE_CODES,
    FOLIO_CHARGE_TYPES,
    GUEST_NOTE_TYPES,
    HOUSEKEEPING_STATUS_CODES,
    INVENTORY_OVERRIDE_ACTIONS,
    INVENTORY_OVERRIDE_SCOPE_TYPES,
    INVENTORY_AVAILABILITY_STATUSES,
    MFA_FACTOR_TYPES,
    MODIFICATION_REQUEST_STATUSES,
    NOTE_VISIBILITY_SCOPES,
    NOTIFICATION_AUDIENCE_TYPES,
    NOTIFICATION_DELIVERY_STATUSES,
    NOTIFICATION_TEMPLATE_CHANNELS,
    NOTIFICATION_TEMPLATE_KEYS,
    PAYMENT_REQUEST_STATUSES,
    POLICY_DOCUMENT_CODES,
    RATE_ADJUSTMENT_TYPES,
    RATE_RULE_TYPES,
    RESERVATION_STATUSES,
    RESERVATION_HOLD_STATUSES,
    REVIEW_QUEUE_STATUSES,
    ROOM_NOTE_TYPES,
    ROOM_OPERATIONAL_STATUSES,
    STAFF_NOTIFICATION_STATUSES,
    USER_ACCOUNT_STATES,
)
from .extensions import db

UUIDType = sa.Uuid(as_uuid=True)
JSONType = sa.JSON().with_variant(sa.dialects.postgresql.JSONB(astext_type=sa.Text()), "postgresql")


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class AuditMixin:
    id: Mapped[uuid.UUID] = mapped_column(UUIDType, primary_key=True, default=uuid.uuid4)
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False, default=utc_now
    )
    updated_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False, default=utc_now
    )
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUIDType, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    updated_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUIDType, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )


class SoftDeleteMixin:
    deleted_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)
    deleted_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUIDType, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )


class RolePermission(db.Model):
    __tablename__ = "role_permissions"

    role_id: Mapped[uuid.UUID] = mapped_column(
        UUIDType, ForeignKey("roles.id", ondelete="CASCADE"), primary_key=True
    )
    permission_id: Mapped[uuid.UUID] = mapped_column(
        UUIDType, ForeignKey("permissions.id", ondelete="CASCADE"), primary_key=True
    )


class UserRole(db.Model):
    __tablename__ = "user_roles"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUIDType, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    role_id: Mapped[uuid.UUID] = mapped_column(
        UUIDType, ForeignKey("roles.id", ondelete="CASCADE"), primary_key=True
    )


class User(AuditMixin, SoftDeleteMixin, db.Model):
    __tablename__ = "users"

    username: Mapped[str] = mapped_column(sa.String(80), nullable=False, unique=True)
    email: Mapped[str] = mapped_column(sa.String(255), nullable=False, unique=True)
    full_name: Mapped[str] = mapped_column(sa.String(255), nullable=False)
    password_hash: Mapped[str] = mapped_column(sa.String(255), nullable=False)
    is_active: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, default=True)
    account_state: Mapped[str] = mapped_column(sa.String(40), nullable=False, default="active")
    last_login_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)
    failed_login_count: Mapped[int] = mapped_column(sa.Integer, nullable=False, default=0)
    last_failed_login_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)
    locked_until: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)
    force_password_reset: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, default=False)
    password_changed_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)
    mfa_required: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, default=False)

    roles = relationship("Role", secondary="user_roles", lazy="joined")
    sessions = relationship("UserSession", back_populates="user", lazy="select")
    mfa_factors = relationship("MfaFactor", back_populates="user", lazy="select")

    __table_args__ = (
        Index("ix_users_active_email", "email", unique=False, sqlite_where=sa.text("deleted_at IS NULL")),
        Index("ix_users_active_username", "username", unique=False, sqlite_where=sa.text("deleted_at IS NULL")),
        CheckConstraint(
            f"account_state IN ({', '.join(repr(v) for v in USER_ACCOUNT_STATES)})",
            name="ck_users_account_state",
        ),
        CheckConstraint("failed_login_count >= 0", name="ck_users_failed_login_count"),
    )

    @property
    def primary_role(self) -> str | None:
        if not self.roles:
            return None
        ordered = sorted(self.roles, key=lambda role: role.sort_order)
        return ordered[0].code

    @property
    def permission_codes(self) -> set[str]:
        codes: set[str] = set()
        for role in self.roles:
            for permission in role.permissions:
                codes.add(permission.code)
        return codes

    def has_permission(self, permission_code: str) -> bool:
        return permission_code in self.permission_codes

    def is_locked(self) -> bool:
        if self.locked_until is None:
            return False
        locked_until = self.locked_until
        if locked_until.tzinfo is None:
            locked_until = locked_until.replace(tzinfo=timezone.utc)
        else:
            locked_until = locked_until.astimezone(timezone.utc)
        return locked_until > utc_now()

    def is_available_for_login(self) -> bool:
        if not self.is_active or self.deleted_at is not None:
            return False
        return self.account_state not in {"disabled"}


class Role(AuditMixin, db.Model):
    __tablename__ = "roles"

    code: Mapped[str] = mapped_column(sa.String(80), nullable=False, unique=True)
    name: Mapped[str] = mapped_column(sa.String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(sa.String(255), nullable=True)
    is_system_role: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, default=True)
    sort_order: Mapped[int] = mapped_column(sa.Integer, nullable=False, default=0)

    permissions = relationship("Permission", secondary="role_permissions", lazy="joined")


class Permission(AuditMixin, db.Model):
    __tablename__ = "permissions"

    code: Mapped[str] = mapped_column(sa.String(120), nullable=False, unique=True)
    name: Mapped[str] = mapped_column(sa.String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(sa.String(255), nullable=True)
    module: Mapped[str] = mapped_column(sa.String(80), nullable=False)


class UserPasswordHistory(db.Model):
    __tablename__ = "user_password_history"

    id: Mapped[uuid.UUID] = mapped_column(UUIDType, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUIDType, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    password_hash: Mapped[str] = mapped_column(sa.String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), nullable=False, default=utc_now)

    __table_args__ = (Index("ix_user_password_history_user_id", "user_id"),)


class UserSession(db.Model):
    __tablename__ = "user_sessions"

    id: Mapped[uuid.UUID] = mapped_column(UUIDType, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUIDType, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    selector: Mapped[str] = mapped_column(sa.String(64), nullable=False, unique=True)
    token_hash: Mapped[str] = mapped_column(sa.String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), nullable=False, default=utc_now)
    last_activity_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), nullable=False, default=utc_now)
    expires_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)
    mfa_completed_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)
    ip_address: Mapped[str | None] = mapped_column(sa.String(64), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(sa.String(512), nullable=True)

    user = relationship("User", back_populates="sessions")

    __table_args__ = (
        Index("ix_user_sessions_user_id", "user_id"),
        Index("ix_user_sessions_expires_at", "expires_at"),
    )


class PasswordResetToken(db.Model):
    __tablename__ = "password_reset_tokens"

    id: Mapped[uuid.UUID] = mapped_column(UUIDType, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUIDType, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    token_hash: Mapped[str] = mapped_column(sa.String(255), nullable=False, unique=True)
    expires_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), nullable=False, default=utc_now)
    created_by_ip: Mapped[str | None] = mapped_column(sa.String(64), nullable=True)

    __table_args__ = (
        Index("ix_password_reset_tokens_user_id", "user_id"),
        Index("ix_password_reset_tokens_expires_at", "expires_at"),
    )


class AuthAttempt(db.Model):
    __tablename__ = "auth_attempts"

    id: Mapped[uuid.UUID] = mapped_column(UUIDType, primary_key=True, default=uuid.uuid4)
    attempted_identifier: Mapped[str] = mapped_column(sa.String(255), nullable=False)
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUIDType, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    ip_address: Mapped[str | None] = mapped_column(sa.String(64), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(sa.String(512), nullable=True)
    success: Mapped[bool] = mapped_column(sa.Boolean, nullable=False)
    failure_reason: Mapped[str | None] = mapped_column(sa.String(40), nullable=True)
    attempted_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), nullable=False, default=utc_now)

    __table_args__ = (
        CheckConstraint(
            f"failure_reason IS NULL OR failure_reason IN ({', '.join(repr(v) for v in AUTH_FAILURE_REASONS)})",
            name="ck_auth_attempts_failure_reason",
        ),
        Index("ix_auth_attempts_identifier_attempted_at", "attempted_identifier", "attempted_at"),
        Index("ix_auth_attempts_ip_attempted_at", "ip_address", "attempted_at"),
        Index("ix_auth_attempts_user_attempted_at", "user_id", "attempted_at"),
    )


class MfaFactor(db.Model):
    __tablename__ = "mfa_factors"

    id: Mapped[uuid.UUID] = mapped_column(UUIDType, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUIDType, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    factor_type: Mapped[str] = mapped_column(sa.String(40), nullable=False, default="totp")
    secret_encrypted: Mapped[str] = mapped_column(sa.Text, nullable=False)
    is_primary: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, default=True)
    enrolled_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), nullable=False, default=utc_now)
    verified_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)
    disabled_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)
    last_used_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)

    user = relationship("User", back_populates="mfa_factors")
    recovery_codes = relationship("MfaRecoveryCode", back_populates="mfa_factor", lazy="select")

    __table_args__ = (
        CheckConstraint(
            f"factor_type IN ({', '.join(repr(v) for v in MFA_FACTOR_TYPES)})",
            name="ck_mfa_factors_factor_type",
        ),
        Index("ix_mfa_factors_user_id", "user_id"),
    )


class MfaRecoveryCode(db.Model):
    __tablename__ = "mfa_recovery_codes"

    id: Mapped[uuid.UUID] = mapped_column(UUIDType, primary_key=True, default=uuid.uuid4)
    mfa_factor_id: Mapped[uuid.UUID] = mapped_column(
        UUIDType, ForeignKey("mfa_factors.id", ondelete="CASCADE"), nullable=False
    )
    code_hash: Mapped[str] = mapped_column(sa.String(255), nullable=False, unique=True)
    used_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), nullable=False, default=utc_now)

    mfa_factor = relationship("MfaFactor", back_populates="recovery_codes")

    __table_args__ = (Index("ix_mfa_recovery_codes_factor_id", "mfa_factor_id"),)


class ActivityLog(db.Model):
    __tablename__ = "activity_log"

    id: Mapped[uuid.UUID] = mapped_column(UUIDType, primary_key=True, default=uuid.uuid4)
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUIDType, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    event_type: Mapped[str] = mapped_column(sa.String(120), nullable=False)
    entity_table: Mapped[str | None] = mapped_column(sa.String(120), nullable=True)
    entity_id: Mapped[str | None] = mapped_column(sa.String(64), nullable=True)
    metadata_json: Mapped[dict | None] = mapped_column("metadata", JSONType, nullable=True)
    ip_address: Mapped[str | None] = mapped_column(sa.String(64), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(sa.String(512), nullable=True)
    created_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), nullable=False, default=utc_now)

    __table_args__ = (
        Index("ix_activity_log_actor_created_at", "actor_user_id", "created_at"),
        Index("ix_activity_log_event_created_at", "event_type", "created_at"),
    )


class Guest(AuditMixin, SoftDeleteMixin, db.Model):
    __tablename__ = "guests"

    first_name: Mapped[str] = mapped_column(sa.String(120), nullable=False)
    last_name: Mapped[str] = mapped_column(sa.String(120), nullable=False)
    full_name: Mapped[str] = mapped_column(sa.String(255), nullable=False)
    phone: Mapped[str] = mapped_column(sa.String(60), nullable=False)
    email: Mapped[str | None] = mapped_column(sa.String(255), nullable=True)
    nationality: Mapped[str | None] = mapped_column(sa.String(80), nullable=True)
    id_document_type: Mapped[str | None] = mapped_column(sa.String(80), nullable=True)
    id_document_number: Mapped[str | None] = mapped_column(sa.String(120), nullable=True)
    date_of_birth: Mapped[datetime | None] = mapped_column(sa.Date, nullable=True)
    preferred_language: Mapped[str | None] = mapped_column(sa.String(30), nullable=True)
    marketing_opt_in: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, default=False)
    blacklist_flag: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, default=False)
    notes_summary: Mapped[str | None] = mapped_column(sa.String(255), nullable=True)

    __table_args__ = (
        Index("ix_guests_phone", "phone"),
        Index("ix_guests_email", "email"),
        Index("ix_guests_full_name", "full_name"),
    )


class GuestNote(AuditMixin, SoftDeleteMixin, db.Model):
    __tablename__ = "guest_notes"

    guest_id: Mapped[uuid.UUID] = mapped_column(
        UUIDType, ForeignKey("guests.id", ondelete="CASCADE"), nullable=False
    )
    note_text: Mapped[str] = mapped_column(sa.Text, nullable=False)
    note_type: Mapped[str] = mapped_column(sa.String(40), nullable=False, default="general")
    is_important: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, default=False)
    visibility_scope: Mapped[str] = mapped_column(sa.String(40), nullable=False, default="all_staff")

    guest = relationship("Guest")

    __table_args__ = (
        CheckConstraint(
            f"note_type IN ({', '.join(repr(v) for v in GUEST_NOTE_TYPES)})",
            name="ck_guest_note_type",
        ),
        CheckConstraint(
            f"visibility_scope IN ({', '.join(repr(v) for v in NOTE_VISIBILITY_SCOPES)})",
            name="ck_guest_note_visibility_scope",
        ),
        Index("ix_guest_notes_guest_id", "guest_id"),
    )


class RoomType(AuditMixin, db.Model):
    __tablename__ = "room_types"

    code: Mapped[str] = mapped_column(sa.String(20), nullable=False, unique=True)
    name: Mapped[str] = mapped_column(sa.String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    standard_occupancy: Mapped[int] = mapped_column(sa.Integer, nullable=False)
    max_occupancy: Mapped[int] = mapped_column(sa.Integer, nullable=False)
    extra_bed_allowed: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, default=False)
    is_active: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, default=True)

    rooms = relationship("Room", back_populates="room_type")

    __table_args__ = (
        CheckConstraint("standard_occupancy >= 1", name="ck_room_type_standard_occupancy"),
        CheckConstraint("max_occupancy >= standard_occupancy", name="ck_room_type_max_occupancy"),
    )


class Room(AuditMixin, db.Model):
    __tablename__ = "rooms"

    room_number: Mapped[str] = mapped_column(sa.String(20), nullable=False, unique=True)
    room_type_id: Mapped[uuid.UUID] = mapped_column(
        UUIDType, ForeignKey("room_types.id", ondelete="RESTRICT"), nullable=False
    )
    floor_number: Mapped[int] = mapped_column(sa.Integer, nullable=False)
    is_active: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, default=True)
    is_sellable: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, default=True)
    default_operational_status: Mapped[str] = mapped_column(
        sa.String(40), nullable=False, default="available"
    )
    notes: Mapped[str | None] = mapped_column(sa.String(255), nullable=True)

    room_type = relationship("RoomType", back_populates="rooms")
    room_notes = relationship(
        "RoomNote",
        back_populates="room",
        order_by="RoomNote.created_at.desc()",
        lazy="select",
    )
    status_history = relationship(
        "RoomStatusHistory",
        back_populates="room",
        order_by="RoomStatusHistory.changed_at.desc()",
        lazy="select",
    )

    __table_args__ = (
        CheckConstraint(
            f"default_operational_status IN ({', '.join(repr(v) for v in ROOM_OPERATIONAL_STATUSES)})",
            name="ck_rooms_default_operational_status",
        ),
        Index("ix_rooms_room_type_id", "room_type_id"),
    )


class HousekeepingStatus(AuditMixin, db.Model):
    __tablename__ = "housekeeping_statuses"

    code: Mapped[str] = mapped_column(sa.String(40), nullable=False, unique=True)
    name: Mapped[str] = mapped_column(sa.String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(sa.String(255), nullable=True)
    is_sellable_state: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, default=False)
    sort_order: Mapped[int] = mapped_column(sa.Integer, nullable=False, default=0)


class RoomNote(db.Model):
    __tablename__ = "room_notes"

    id: Mapped[uuid.UUID] = mapped_column(UUIDType, primary_key=True, default=uuid.uuid4)
    room_id: Mapped[uuid.UUID] = mapped_column(
        UUIDType, ForeignKey("rooms.id", ondelete="CASCADE"), nullable=False
    )
    business_date: Mapped[datetime | None] = mapped_column(sa.Date, nullable=True)
    note_text: Mapped[str] = mapped_column(sa.Text, nullable=False)
    note_type: Mapped[str] = mapped_column(sa.String(40), nullable=False, default="housekeeping")
    is_important: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, default=False)
    visibility_scope: Mapped[str] = mapped_column(sa.String(40), nullable=False, default="all_staff")
    created_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), nullable=False, default=utc_now)
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUIDType, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    room = relationship("Room", back_populates="room_notes")
    created_by_user = relationship("User", foreign_keys=[created_by_user_id])

    __table_args__ = (
        CheckConstraint(
            f"note_type IN ({', '.join(repr(v) for v in ROOM_NOTE_TYPES)})",
            name="ck_room_notes_note_type",
        ),
        CheckConstraint(
            f"visibility_scope IN ({', '.join(repr(v) for v in NOTE_VISIBILITY_SCOPES)})",
            name="ck_room_notes_visibility_scope",
        ),
        Index("ix_room_notes_room_created", "room_id", "created_at"),
        Index("ix_room_notes_room_business_date", "room_id", "business_date"),
    )


class RoomStatusHistory(db.Model):
    __tablename__ = "room_status_history"

    id: Mapped[uuid.UUID] = mapped_column(UUIDType, primary_key=True, default=uuid.uuid4)
    room_id: Mapped[uuid.UUID] = mapped_column(
        UUIDType, ForeignKey("rooms.id", ondelete="CASCADE"), nullable=False
    )
    inventory_day_id: Mapped[uuid.UUID | None] = mapped_column(
        UUIDType, ForeignKey("inventory_days.id", ondelete="SET NULL"), nullable=True
    )
    business_date: Mapped[datetime] = mapped_column(sa.Date, nullable=False)
    previous_housekeeping_status_id: Mapped[uuid.UUID | None] = mapped_column(
        UUIDType, ForeignKey("housekeeping_statuses.id", ondelete="SET NULL"), nullable=True
    )
    new_housekeeping_status_id: Mapped[uuid.UUID | None] = mapped_column(
        UUIDType, ForeignKey("housekeeping_statuses.id", ondelete="SET NULL"), nullable=True
    )
    previous_availability_status: Mapped[str | None] = mapped_column(sa.String(30), nullable=True)
    new_availability_status: Mapped[str | None] = mapped_column(sa.String(30), nullable=True)
    previous_is_sellable: Mapped[bool | None] = mapped_column(sa.Boolean, nullable=True)
    new_is_sellable: Mapped[bool | None] = mapped_column(sa.Boolean, nullable=True)
    previous_is_blocked: Mapped[bool | None] = mapped_column(sa.Boolean, nullable=True)
    new_is_blocked: Mapped[bool | None] = mapped_column(sa.Boolean, nullable=True)
    previous_maintenance_flag: Mapped[bool | None] = mapped_column(sa.Boolean, nullable=True)
    new_maintenance_flag: Mapped[bool | None] = mapped_column(sa.Boolean, nullable=True)
    event_type: Mapped[str] = mapped_column(sa.String(60), nullable=False)
    note: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    changed_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), nullable=False, default=utc_now)
    changed_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUIDType, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    room = relationship("Room", back_populates="status_history")
    previous_housekeeping_status = relationship("HousekeepingStatus", foreign_keys=[previous_housekeeping_status_id])
    new_housekeeping_status = relationship("HousekeepingStatus", foreign_keys=[new_housekeeping_status_id])
    changed_by_user = relationship("User", foreign_keys=[changed_by_user_id])

    __table_args__ = (
        Index("ix_room_status_history_room_changed", "room_id", "changed_at"),
        Index("ix_room_status_history_business_date", "business_date"),
    )


class ReservationCodeSequence(db.Model):
    __tablename__ = "reservation_code_sequence"

    sequence_name: Mapped[str] = mapped_column(sa.String(80), primary_key=True)
    next_value: Mapped[int] = mapped_column(sa.BigInteger, nullable=False)


class Reservation(AuditMixin, db.Model):
    __tablename__ = "reservations"

    reservation_code: Mapped[str] = mapped_column(sa.String(20), nullable=False, unique=True)
    primary_guest_id: Mapped[uuid.UUID] = mapped_column(
        UUIDType, ForeignKey("guests.id", ondelete="RESTRICT"), nullable=False
    )
    room_type_id: Mapped[uuid.UUID] = mapped_column(
        UUIDType, ForeignKey("room_types.id", ondelete="RESTRICT"), nullable=False
    )
    assigned_room_id: Mapped[uuid.UUID] = mapped_column(
        UUIDType, ForeignKey("rooms.id", ondelete="RESTRICT"), nullable=False
    )
    current_status: Mapped[str] = mapped_column(sa.String(30), nullable=False)
    source_channel: Mapped[str] = mapped_column(sa.String(80), nullable=False, default="direct")
    check_in_date: Mapped[datetime] = mapped_column(sa.Date, nullable=False)
    check_out_date: Mapped[datetime] = mapped_column(sa.Date, nullable=False)
    adults: Mapped[int] = mapped_column(sa.Integer, nullable=False)
    children: Mapped[int] = mapped_column(sa.Integer, nullable=False, default=0)
    extra_guests: Mapped[int] = mapped_column(sa.Integer, nullable=False, default=0)
    special_requests: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    internal_notes: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    quoted_room_total: Mapped[float] = mapped_column(sa.Numeric(10, 2), nullable=False, default=0)
    quoted_tax_total: Mapped[float] = mapped_column(sa.Numeric(10, 2), nullable=False, default=0)
    quoted_grand_total: Mapped[float] = mapped_column(sa.Numeric(10, 2), nullable=False, default=0)
    deposit_required_amount: Mapped[float] = mapped_column(sa.Numeric(10, 2), nullable=False, default=0)
    deposit_received_amount: Mapped[float] = mapped_column(sa.Numeric(10, 2), nullable=False, default=0)
    created_from_public_booking_flow: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, default=False)
    booking_language: Mapped[str] = mapped_column(sa.String(20), nullable=False, default="th")
    source_metadata_json: Mapped[dict | None] = mapped_column("source_metadata", JSONType, nullable=True)
    duplicate_suspected: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, default=False)
    terms_accepted_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)
    terms_version: Mapped[str | None] = mapped_column(sa.String(40), nullable=True)
    public_confirmation_token: Mapped[str | None] = mapped_column(sa.String(120), nullable=True, unique=True)
    booked_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), nullable=False)
    cancelled_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)
    cancellation_reason: Mapped[str | None] = mapped_column(sa.String(255), nullable=True)
    no_show_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)
    checked_in_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)
    checked_out_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)
    identity_verified_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)
    identity_verified_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUIDType, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    primary_guest = relationship("Guest")
    room_type = relationship("RoomType")
    assigned_room = relationship("Room")
    status_history = relationship(
        "ReservationStatusHistory",
        back_populates="reservation",
        order_by="ReservationStatusHistory.changed_at.desc()",
    )
    notes = relationship(
        "ReservationNote",
        back_populates="reservation",
        order_by="ReservationNote.created_at.desc()",
    )

    __table_args__ = (
        CheckConstraint("check_in_date < check_out_date", name="ck_reservation_dates"),
        CheckConstraint("adults >= 1", name="ck_reservations_adults"),
        CheckConstraint("children >= 0", name="ck_reservations_children"),
        CheckConstraint("extra_guests >= 0", name="ck_reservations_extra_guests"),
        CheckConstraint("quoted_room_total >= 0", name="ck_reservations_room_total"),
        CheckConstraint("quoted_tax_total >= 0", name="ck_reservations_tax_total"),
        CheckConstraint("quoted_grand_total >= 0", name="ck_reservations_grand_total"),
        CheckConstraint("deposit_required_amount >= 0", name="ck_reservations_deposit_required"),
        CheckConstraint("deposit_received_amount >= 0", name="ck_reservations_deposit_received"),
        CheckConstraint(
            f"booking_language IN ({', '.join(repr(v) for v in BOOKING_LANGUAGES)})",
            name="ck_reservations_booking_language",
        ),
        CheckConstraint(
            f"current_status IN ({', '.join(repr(v) for v in RESERVATION_STATUSES)})",
            name="ck_reservations_current_status",
        ),
        CheckConstraint(
            "reservation_code LIKE 'SBX-%'",
            name="ck_reservations_reservation_code_format",
        ),
        Index("ix_reservations_status_dates", "current_status", "check_in_date", "check_out_date"),
        Index("ix_reservations_primary_guest_id", "primary_guest_id"),
        Index("ix_reservations_assigned_room_id", "assigned_room_id"),
        Index("ix_reservations_source_channel", "source_channel"),
    )


class ReservationStatusHistory(db.Model):
    __tablename__ = "reservation_status_history"

    id: Mapped[uuid.UUID] = mapped_column(UUIDType, primary_key=True, default=uuid.uuid4)
    reservation_id: Mapped[uuid.UUID] = mapped_column(
        UUIDType, ForeignKey("reservations.id", ondelete="CASCADE"), nullable=False
    )
    old_status: Mapped[str | None] = mapped_column(sa.String(30), nullable=True)
    new_status: Mapped[str] = mapped_column(sa.String(30), nullable=False)
    reason: Mapped[str | None] = mapped_column(sa.String(255), nullable=True)
    note: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    changed_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False, default=utc_now
    )
    changed_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUIDType, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    reservation = relationship("Reservation", back_populates="status_history")

    __table_args__ = (
        CheckConstraint(
            f"new_status IN ({', '.join(repr(v) for v in RESERVATION_STATUSES)})",
            name="ck_reservation_status_history_new_status",
        ),
        Index("ix_reservation_status_history_reservation_changed", "reservation_id", "changed_at"),
    )


class ReservationNote(db.Model):
    __tablename__ = "reservation_notes"

    id: Mapped[uuid.UUID] = mapped_column(UUIDType, primary_key=True, default=uuid.uuid4)
    reservation_id: Mapped[uuid.UUID] = mapped_column(
        UUIDType, ForeignKey("reservations.id", ondelete="CASCADE"), nullable=False
    )
    note_text: Mapped[str] = mapped_column(sa.Text, nullable=False)
    note_type: Mapped[str] = mapped_column(sa.String(40), nullable=False, default="general")
    is_important: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, default=False)
    visibility_scope: Mapped[str] = mapped_column(sa.String(40), nullable=False, default="all_staff")
    created_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), nullable=False, default=utc_now)
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUIDType, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    reservation = relationship("Reservation", back_populates="notes")

    __table_args__ = (
        CheckConstraint(
            f"note_type IN ({', '.join(repr(v) for v in GUEST_NOTE_TYPES)})",
            name="ck_reservation_notes_note_type",
        ),
        CheckConstraint(
            f"visibility_scope IN ({', '.join(repr(v) for v in NOTE_VISIBILITY_SCOPES)})",
            name="ck_reservation_notes_visibility_scope",
        ),
        Index("ix_reservation_notes_reservation_created", "reservation_id", "created_at"),
    )


class ReservationHold(db.Model):
    __tablename__ = "reservation_holds"

    id: Mapped[uuid.UUID] = mapped_column(UUIDType, primary_key=True, default=uuid.uuid4)
    hold_code: Mapped[str] = mapped_column(sa.String(24), nullable=False, unique=True)
    room_type_id: Mapped[uuid.UUID] = mapped_column(
        UUIDType, ForeignKey("room_types.id", ondelete="RESTRICT"), nullable=False
    )
    assigned_room_id: Mapped[uuid.UUID | None] = mapped_column(
        UUIDType, ForeignKey("rooms.id", ondelete="SET NULL"), nullable=True
    )
    guest_email: Mapped[str | None] = mapped_column(sa.String(255), nullable=True)
    check_in_date: Mapped[datetime] = mapped_column(sa.Date, nullable=False)
    check_out_date: Mapped[datetime] = mapped_column(sa.Date, nullable=False)
    adults: Mapped[int] = mapped_column(sa.Integer, nullable=False)
    children: Mapped[int] = mapped_column(sa.Integer, nullable=False, default=0)
    extra_guests: Mapped[int] = mapped_column(sa.Integer, nullable=False, default=0)
    source_channel: Mapped[str] = mapped_column(sa.String(40), nullable=False, default="direct_web")
    booking_language: Mapped[str] = mapped_column(sa.String(20), nullable=False, default="th")
    source_metadata_json: Mapped[dict | None] = mapped_column("source_metadata", JSONType, nullable=True)
    idempotency_key: Mapped[str | None] = mapped_column(sa.String(120), nullable=True, unique=True)
    status: Mapped[str] = mapped_column(sa.String(20), nullable=False, default="active")
    expires_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), nullable=False, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), nullable=False, default=utc_now)
    request_ip: Mapped[str | None] = mapped_column(sa.String(64), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(sa.String(512), nullable=True)
    quoted_room_total: Mapped[float] = mapped_column(sa.Numeric(10, 2), nullable=False, default=0)
    quoted_tax_total: Mapped[float] = mapped_column(sa.Numeric(10, 2), nullable=False, default=0)
    quoted_grand_total: Mapped[float] = mapped_column(sa.Numeric(10, 2), nullable=False, default=0)
    converted_reservation_id: Mapped[uuid.UUID | None] = mapped_column(
        UUIDType, ForeignKey("reservations.id", ondelete="SET NULL"), nullable=True
    )

    __table_args__ = (
        CheckConstraint("check_in_date < check_out_date", name="ck_reservation_holds_dates"),
        CheckConstraint("adults >= 1", name="ck_reservation_holds_adults"),
        CheckConstraint("children >= 0", name="ck_reservation_holds_children"),
        CheckConstraint("extra_guests >= 0", name="ck_reservation_holds_extra_guests"),
        CheckConstraint(
            f"status IN ({', '.join(repr(v) for v in RESERVATION_HOLD_STATUSES)})",
            name="ck_reservation_holds_status",
        ),
        CheckConstraint(
            f"booking_language IN ({', '.join(repr(v) for v in BOOKING_LANGUAGES)})",
            name="ck_reservation_holds_booking_language",
        ),
        CheckConstraint(
            f"source_channel IN ({', '.join(repr(v) for v in BOOKING_SOURCE_CHANNELS)})",
            name="ck_reservation_holds_source_channel",
        ),
        Index("ix_reservation_holds_status_expires_at", "status", "expires_at"),
        Index("ix_reservation_holds_dates", "check_in_date", "check_out_date"),
        Index("ix_reservation_holds_guest_email", "guest_email"),
    )


class ReservationReviewQueue(db.Model):
    __tablename__ = "reservation_review_queue"

    id: Mapped[uuid.UUID] = mapped_column(UUIDType, primary_key=True, default=uuid.uuid4)
    reservation_id: Mapped[uuid.UUID] = mapped_column(
        UUIDType, ForeignKey("reservations.id", ondelete="CASCADE"), nullable=False, unique=True
    )
    review_status: Mapped[str] = mapped_column(sa.String(30), nullable=False, default="new")
    deposit_state: Mapped[str | None] = mapped_column(sa.String(40), nullable=True)
    flagged_duplicate_suspected: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, default=False)
    special_requests_present: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, default=False)
    reviewed_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)
    reviewed_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUIDType, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    contacted_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)
    internal_note: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), nullable=False, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), nullable=False, default=utc_now)

    __table_args__ = (
        CheckConstraint(
            f"review_status IN ({', '.join(repr(v) for v in REVIEW_QUEUE_STATUSES)})",
            name="ck_reservation_review_queue_status",
        ),
        Index("ix_reservation_review_queue_status_created", "review_status", "created_at"),
    )


class StaffNotification(db.Model):
    __tablename__ = "staff_notifications"

    id: Mapped[uuid.UUID] = mapped_column(UUIDType, primary_key=True, default=uuid.uuid4)
    notification_type: Mapped[str] = mapped_column(sa.String(80), nullable=False)
    reservation_id: Mapped[uuid.UUID | None] = mapped_column(
        UUIDType, ForeignKey("reservations.id", ondelete="SET NULL"), nullable=True
    )
    payload_json: Mapped[dict | None] = mapped_column("payload", JSONType, nullable=True)
    status: Mapped[str] = mapped_column(sa.String(20), nullable=False, default="new")
    created_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), nullable=False, default=utc_now)
    read_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)

    __table_args__ = (
        CheckConstraint(
            f"status IN ({', '.join(repr(v) for v in STAFF_NOTIFICATION_STATUSES)})",
            name="ck_staff_notifications_status",
        ),
        Index("ix_staff_notifications_status_created", "status", "created_at"),
    )


class CancellationRequest(db.Model):
    __tablename__ = "cancellation_requests"

    id: Mapped[uuid.UUID] = mapped_column(UUIDType, primary_key=True, default=uuid.uuid4)
    reservation_id: Mapped[uuid.UUID | None] = mapped_column(
        UUIDType, ForeignKey("reservations.id", ondelete="SET NULL"), nullable=True
    )
    request_code: Mapped[str] = mapped_column(sa.String(24), nullable=False, unique=True)
    booking_reference: Mapped[str] = mapped_column(sa.String(20), nullable=False)
    requester_contact_hash: Mapped[str] = mapped_column(sa.String(255), nullable=False)
    requester_contact_hint: Mapped[str | None] = mapped_column(sa.String(80), nullable=True)
    status: Mapped[str] = mapped_column(sa.String(30), nullable=False, default="submitted")
    reason: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    requested_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), nullable=False, default=utc_now)
    processed_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)
    processed_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUIDType, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    internal_note: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    request_ip: Mapped[str | None] = mapped_column(sa.String(64), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(sa.String(512), nullable=True)

    __table_args__ = (
        CheckConstraint(
            f"status IN ({', '.join(repr(v) for v in CANCELLATION_REQUEST_STATUSES)})",
            name="ck_cancellation_requests_status",
        ),
        Index("ix_cancellation_requests_booking_reference", "booking_reference"),
        Index("ix_cancellation_requests_status_requested", "status", "requested_at"),
    )


class ModificationRequest(db.Model):
    __tablename__ = "modification_requests"

    id: Mapped[uuid.UUID] = mapped_column(UUIDType, primary_key=True, default=uuid.uuid4)
    reservation_id: Mapped[uuid.UUID] = mapped_column(
        UUIDType, ForeignKey("reservations.id", ondelete="CASCADE"), nullable=False
    )
    request_code: Mapped[str] = mapped_column(sa.String(24), nullable=False, unique=True)
    requested_changes_json: Mapped[dict] = mapped_column("requested_changes", JSONType, nullable=False)
    requester_contact_hash: Mapped[str] = mapped_column(sa.String(255), nullable=False)
    requester_contact_hint: Mapped[str | None] = mapped_column(sa.String(80), nullable=True)
    status: Mapped[str] = mapped_column(sa.String(30), nullable=False, default="submitted")
    requested_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), nullable=False, default=utc_now)
    reviewed_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)
    reviewed_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUIDType, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    internal_note: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    request_ip: Mapped[str | None] = mapped_column(sa.String(64), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(sa.String(512), nullable=True)

    __table_args__ = (
        CheckConstraint(
            f"status IN ({', '.join(repr(v) for v in MODIFICATION_REQUEST_STATUSES)})",
            name="ck_modification_requests_status",
        ),
        Index("ix_modification_requests_reservation_id", "reservation_id"),
        Index("ix_modification_requests_status_requested", "status", "requested_at"),
    )


class EmailOutbox(db.Model):
    __tablename__ = "email_outbox"

    id: Mapped[uuid.UUID] = mapped_column(UUIDType, primary_key=True, default=uuid.uuid4)
    email_type: Mapped[str] = mapped_column(sa.String(80), nullable=False)
    reservation_id: Mapped[uuid.UUID | None] = mapped_column(
        UUIDType, ForeignKey("reservations.id", ondelete="SET NULL"), nullable=True
    )
    recipient_email: Mapped[str] = mapped_column(sa.String(255), nullable=False)
    subject: Mapped[str] = mapped_column(sa.String(255), nullable=False)
    body_text: Mapped[str] = mapped_column(sa.Text, nullable=False)
    language: Mapped[str] = mapped_column(sa.String(20), nullable=False, default="th")
    dedupe_key: Mapped[str] = mapped_column(sa.String(120), nullable=False, unique=True)
    status: Mapped[str] = mapped_column(sa.String(20), nullable=False, default="pending")
    attempts: Mapped[int] = mapped_column(sa.Integer, nullable=False, default=0)
    last_error: Mapped[str | None] = mapped_column(sa.String(255), nullable=True)
    sent_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), nullable=False, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), nullable=False, default=utc_now)

    __table_args__ = (
        CheckConstraint(
            f"status IN ({', '.join(repr(v) for v in EMAIL_OUTBOX_STATUSES)})",
            name="ck_email_outbox_status",
        ),
        CheckConstraint(
            f"language IN ({', '.join(repr(v) for v in BOOKING_LANGUAGES)})",
            name="ck_email_outbox_language",
        ),
        Index("ix_email_outbox_status_created", "status", "created_at"),
    )


class InventoryDay(AuditMixin, db.Model):
    __tablename__ = "inventory_days"

    room_id: Mapped[uuid.UUID] = mapped_column(
        UUIDType, ForeignKey("rooms.id", ondelete="RESTRICT"), nullable=False
    )
    room_type_id: Mapped[uuid.UUID] = mapped_column(
        UUIDType, ForeignKey("room_types.id", ondelete="RESTRICT"), nullable=False
    )
    business_date: Mapped[datetime] = mapped_column(sa.Date, nullable=False)
    availability_status: Mapped[str] = mapped_column(sa.String(30), nullable=False, default="available")
    housekeeping_status_id: Mapped[uuid.UUID | None] = mapped_column(
        UUIDType, ForeignKey("housekeeping_statuses.id", ondelete="SET NULL"), nullable=True
    )
    hold_id: Mapped[uuid.UUID | None] = mapped_column(
        UUIDType, ForeignKey("reservation_holds.id", ondelete="SET NULL"), nullable=True
    )
    reservation_id: Mapped[uuid.UUID | None] = mapped_column(
        UUIDType, ForeignKey("reservations.id", ondelete="SET NULL"), nullable=True
    )
    nightly_rate: Mapped[float | None] = mapped_column(sa.Numeric(10, 2), nullable=True)
    is_sellable: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, default=True)
    is_blocked: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, default=False)
    blocked_reason: Mapped[str | None] = mapped_column(sa.String(255), nullable=True)
    blocked_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)
    blocked_until: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)
    blocked_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUIDType, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    maintenance_flag: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, default=False)
    maintenance_note: Mapped[str | None] = mapped_column(sa.String(255), nullable=True)
    maintenance_flagged_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)
    maintenance_flagged_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUIDType, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    cleaned_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)
    inspected_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)
    notes: Mapped[str | None] = mapped_column(sa.String(255), nullable=True)

    __table_args__ = (
        UniqueConstraint("room_id", "business_date", name="uq_inventory_days_room_date"),
        CheckConstraint(
            f"availability_status IN ({', '.join(repr(v) for v in INVENTORY_AVAILABILITY_STATUSES)})",
            name="ck_inventory_days_availability_status",
        ),
        CheckConstraint(
            "(reservation_id IS NULL) OR (availability_status IN ('held', 'reserved', 'occupied', 'house_use'))",
            name="ck_inventory_days_reservation_requires_consuming_status",
        ),
        CheckConstraint(
            "(hold_id IS NULL) OR availability_status = 'held'",
            name="ck_inventory_days_hold_requires_held_status",
        ),
        CheckConstraint(
            "(availability_status NOT IN ('out_of_service', 'out_of_order')) OR reservation_id IS NULL",
            name="ck_inventory_days_closure_without_reservation",
        ),
        Index("ix_inventory_days_business_date", "business_date"),
        Index("ix_inventory_days_room_type_date", "room_type_id", "business_date"),
        Index("ix_inventory_days_hold_id", "hold_id"),
        Index("ix_inventory_days_reservation_id", "reservation_id"),
        Index("ix_inventory_days_status_date", "availability_status", "business_date"),
        Index("ix_inventory_days_blocked_date", "is_blocked", "business_date"),
        Index("ix_inventory_days_maintenance_date", "maintenance_flag", "business_date"),
    )


class RateRule(AuditMixin, SoftDeleteMixin, db.Model):
    __tablename__ = "rate_rules"

    name: Mapped[str] = mapped_column(sa.String(255), nullable=False)
    room_type_id: Mapped[uuid.UUID | None] = mapped_column(
        UUIDType, ForeignKey("room_types.id", ondelete="RESTRICT"), nullable=True
    )
    priority: Mapped[int] = mapped_column(sa.Integer, nullable=False, default=100)
    is_active: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, default=True)
    rule_type: Mapped[str] = mapped_column(sa.String(40), nullable=False)
    adjustment_type: Mapped[str] = mapped_column(sa.String(40), nullable=False)
    adjustment_value: Mapped[float] = mapped_column(sa.Numeric(10, 2), nullable=False)
    start_date: Mapped[datetime | None] = mapped_column(sa.Date, nullable=True)
    end_date: Mapped[datetime | None] = mapped_column(sa.Date, nullable=True)
    days_of_week: Mapped[str | None] = mapped_column(sa.String(50), nullable=True)
    min_nights: Mapped[int | None] = mapped_column(sa.Integer, nullable=True)
    max_nights: Mapped[int | None] = mapped_column(sa.Integer, nullable=True)
    extra_guest_fee_override: Mapped[float | None] = mapped_column(sa.Numeric(10, 2), nullable=True)
    child_fee_override: Mapped[float | None] = mapped_column(sa.Numeric(10, 2), nullable=True)
    metadata_json: Mapped[dict | None] = mapped_column("metadata", JSONType, nullable=True)

    __table_args__ = (
        CheckConstraint(
            f"rule_type IN ({', '.join(repr(v) for v in RATE_RULE_TYPES)})",
            name="ck_rate_rules_rule_type",
        ),
        CheckConstraint(
            f"adjustment_type IN ({', '.join(repr(v) for v in RATE_ADJUSTMENT_TYPES)})",
            name="ck_rate_rules_adjustment_type",
        ),
        CheckConstraint("adjustment_value >= 0 OR adjustment_type != 'fixed'", name="ck_rate_rules_adjustment_value"),
        Index("ix_rate_rules_room_type_active", "room_type_id", "is_active"),
        Index("ix_rate_rules_date_window", "start_date", "end_date"),
    )


class FolioCharge(db.Model):
    __tablename__ = "folio_charges"

    id: Mapped[uuid.UUID] = mapped_column(UUIDType, primary_key=True, default=uuid.uuid4)
    reservation_id: Mapped[uuid.UUID] = mapped_column(
        UUIDType, ForeignKey("reservations.id", ondelete="RESTRICT"), nullable=False
    )
    charge_code: Mapped[str] = mapped_column(sa.String(40), nullable=False)
    charge_type: Mapped[str] = mapped_column(sa.String(40), nullable=False)
    description: Mapped[str] = mapped_column(sa.String(255), nullable=False)
    quantity: Mapped[float] = mapped_column(sa.Numeric(10, 2), nullable=False, default=1)
    unit_amount: Mapped[float] = mapped_column(sa.Numeric(10, 2), nullable=False)
    line_amount: Mapped[float] = mapped_column(sa.Numeric(10, 2), nullable=False)
    tax_amount: Mapped[float] = mapped_column(sa.Numeric(10, 2), nullable=False, default=0)
    total_amount: Mapped[float] = mapped_column(sa.Numeric(10, 2), nullable=False)
    service_date: Mapped[datetime] = mapped_column(sa.Date, nullable=False)
    posted_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), nullable=False, default=utc_now)
    posted_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUIDType, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    is_reversal: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, default=False)
    reversed_charge_id: Mapped[uuid.UUID | None] = mapped_column(
        UUIDType, ForeignKey("folio_charges.id", ondelete="RESTRICT"), nullable=True
    )
    posting_key: Mapped[str | None] = mapped_column(sa.String(160), nullable=True, unique=True)
    voided_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)
    voided_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUIDType, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    void_reason: Mapped[str | None] = mapped_column(sa.String(255), nullable=True)
    metadata_json: Mapped[dict | None] = mapped_column("metadata", JSONType, nullable=True)
    created_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), nullable=False, default=utc_now)
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUIDType, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    reservation = relationship("Reservation")
    posted_by_user = relationship("User", foreign_keys=[posted_by_user_id])
    voided_by_user = relationship("User", foreign_keys=[voided_by_user_id])
    reversed_charge = relationship("FolioCharge", remote_side="FolioCharge.id", foreign_keys=[reversed_charge_id])

    __table_args__ = (
        CheckConstraint(
            f"charge_code IN ({', '.join(repr(v) for v in FOLIO_CHARGE_CODES)})",
            name="ck_folio_charges_charge_code",
        ),
        CheckConstraint(
            f"charge_type IN ({', '.join(repr(v) for v in FOLIO_CHARGE_TYPES)})",
            name="ck_folio_charges_charge_type",
        ),
        CheckConstraint("quantity >= 0", name="ck_folio_charges_quantity"),
        CheckConstraint("unit_amount >= 0", name="ck_folio_charges_unit_amount"),
        CheckConstraint(
            "((total_amount >= 0 AND tax_amount >= 0) OR (total_amount < 0 AND tax_amount <= 0))",
            name="ck_folio_charges_tax_amount",
        ),
        Index("ix_folio_charges_reservation_id", "reservation_id"),
        Index("ix_folio_charges_posted_at", "posted_at"),
        Index("ix_folio_charges_service_date", "service_date"),
    )


class CashierDocumentSequence(db.Model):
    __tablename__ = "cashier_document_sequences"

    sequence_name: Mapped[str] = mapped_column(sa.String(80), primary_key=True)
    next_value: Mapped[int] = mapped_column(sa.BigInteger, nullable=False)


class CashierDocument(db.Model):
    __tablename__ = "cashier_documents"

    id: Mapped[uuid.UUID] = mapped_column(UUIDType, primary_key=True, default=uuid.uuid4)
    reservation_id: Mapped[uuid.UUID] = mapped_column(
        UUIDType, ForeignKey("reservations.id", ondelete="RESTRICT"), nullable=False
    )
    document_type: Mapped[str] = mapped_column(sa.String(20), nullable=False)
    document_number: Mapped[str] = mapped_column(sa.String(40), nullable=False, unique=True)
    status: Mapped[str] = mapped_column(sa.String(20), nullable=False, default="issued")
    total_amount: Mapped[float] = mapped_column(sa.Numeric(10, 2), nullable=False, default=0)
    currency_code: Mapped[str] = mapped_column(sa.String(3), nullable=False, default="THB")
    issued_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), nullable=False, default=utc_now)
    issued_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUIDType, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    printed_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)
    voided_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)
    voided_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUIDType, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    void_reason: Mapped[str | None] = mapped_column(sa.String(255), nullable=True)
    metadata_json: Mapped[dict | None] = mapped_column("metadata", JSONType, nullable=True)

    reservation = relationship("Reservation")
    issued_by_user = relationship("User", foreign_keys=[issued_by_user_id])
    voided_by_user = relationship("User", foreign_keys=[voided_by_user_id])

    __table_args__ = (
        CheckConstraint(
            f"document_type IN ({', '.join(repr(v) for v in CASHIER_DOCUMENT_TYPES)})",
            name="ck_cashier_documents_document_type",
        ),
        CheckConstraint(
            f"status IN ({', '.join(repr(v) for v in CASHIER_DOCUMENT_STATUSES)})",
            name="ck_cashier_documents_status",
        ),
        CheckConstraint("total_amount >= 0", name="ck_cashier_documents_total_amount"),
        Index("ix_cashier_documents_reservation_id", "reservation_id"),
        Index("ix_cashier_documents_document_type", "document_type"),
    )


class CashierActivityLog(db.Model):
    __tablename__ = "cashier_activity_log"

    id: Mapped[uuid.UUID] = mapped_column(UUIDType, primary_key=True, default=uuid.uuid4)
    reservation_id: Mapped[uuid.UUID | None] = mapped_column(
        UUIDType, ForeignKey("reservations.id", ondelete="SET NULL"), nullable=True
    )
    folio_charge_id: Mapped[uuid.UUID | None] = mapped_column(
        UUIDType, ForeignKey("folio_charges.id", ondelete="SET NULL"), nullable=True
    )
    cashier_document_id: Mapped[uuid.UUID | None] = mapped_column(
        UUIDType, ForeignKey("cashier_documents.id", ondelete="SET NULL"), nullable=True
    )
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUIDType, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    event_type: Mapped[str] = mapped_column(sa.String(120), nullable=False)
    amount: Mapped[float | None] = mapped_column(sa.Numeric(10, 2), nullable=True)
    note: Mapped[str | None] = mapped_column(sa.String(255), nullable=True)
    metadata_json: Mapped[dict | None] = mapped_column("metadata", JSONType, nullable=True)
    created_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), nullable=False, default=utc_now)

    reservation = relationship("Reservation")
    folio_charge = relationship("FolioCharge")
    cashier_document = relationship("CashierDocument")
    actor_user = relationship("User", foreign_keys=[actor_user_id])

    __table_args__ = (
        Index("ix_cashier_activity_reservation_created", "reservation_id", "created_at"),
        Index("ix_cashier_activity_event_created", "event_type", "created_at"),
    )


class PaymentRequest(AuditMixin, db.Model):
    __tablename__ = "payment_requests"

    request_code: Mapped[str | None] = mapped_column(sa.String(32), nullable=True, unique=True)
    reservation_id: Mapped[uuid.UUID] = mapped_column(
        UUIDType, ForeignKey("reservations.id", ondelete="RESTRICT"), nullable=False
    )
    request_type: Mapped[str] = mapped_column(sa.String(40), nullable=False)
    amount: Mapped[float] = mapped_column(sa.Numeric(10, 2), nullable=False)
    currency_code: Mapped[str] = mapped_column(sa.String(3), nullable=False, default="THB")
    due_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)
    status: Mapped[str] = mapped_column(sa.String(20), nullable=False, default="pending")
    provider: Mapped[str] = mapped_column(sa.String(80), nullable=False)
    provider_reference: Mapped[str | None] = mapped_column(sa.String(255), nullable=True)
    provider_payment_reference: Mapped[str | None] = mapped_column(sa.String(255), nullable=True)
    provider_status: Mapped[str | None] = mapped_column(sa.String(80), nullable=True)
    payment_url: Mapped[str | None] = mapped_column(sa.String(1024), nullable=True)
    guest_email: Mapped[str | None] = mapped_column(sa.String(255), nullable=True)
    guest_name: Mapped[str | None] = mapped_column(sa.String(255), nullable=True)
    expires_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)
    checkout_created_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)
    last_sent_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)
    last_synced_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)
    paid_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)
    failed_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)
    expired_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)
    cancelled_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)
    metadata_json: Mapped[dict | None] = mapped_column("metadata", JSONType, nullable=True)

    __table_args__ = (
        CheckConstraint("amount >= 0", name="ck_payment_requests_amount"),
        CheckConstraint(
            f"status IN ({', '.join(repr(v) for v in PAYMENT_REQUEST_STATUSES)})",
            name="ck_payment_requests_status",
        ),
        Index("ix_payment_requests_request_code", "request_code"),
        Index("ix_payment_requests_reservation_id", "reservation_id"),
        Index("ix_payment_requests_status", "status"),
        Index("ix_payment_requests_request_type_status", "request_type", "status"),
        Index("ix_payment_requests_provider_reference", "provider", "provider_reference", unique=True),
    )


class PaymentEvent(db.Model):
    __tablename__ = "payment_events"

    id: Mapped[uuid.UUID] = mapped_column(UUIDType, primary_key=True, default=uuid.uuid4)
    payment_request_id: Mapped[uuid.UUID | None] = mapped_column(
        UUIDType, ForeignKey("payment_requests.id", ondelete="SET NULL"), nullable=True
    )
    reservation_id: Mapped[uuid.UUID | None] = mapped_column(
        UUIDType, ForeignKey("reservations.id", ondelete="SET NULL"), nullable=True
    )
    event_type: Mapped[str] = mapped_column(sa.String(80), nullable=False)
    amount: Mapped[float | None] = mapped_column(sa.Numeric(10, 2), nullable=True)
    currency_code: Mapped[str | None] = mapped_column(sa.String(3), nullable=True)
    provider: Mapped[str | None] = mapped_column(sa.String(80), nullable=True)
    provider_event_id: Mapped[str | None] = mapped_column(sa.String(255), nullable=True)
    raw_payload: Mapped[dict | None] = mapped_column(JSONType, nullable=True)
    processed_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), nullable=False, default=utc_now)
    created_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), nullable=False, default=utc_now)
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUIDType, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    __table_args__ = (
        Index("ix_payment_events_payment_request_id", "payment_request_id"),
        Index("ix_payment_events_reservation_id", "reservation_id"),
        Index("ix_payment_events_provider_event", "provider", "provider_event_id", unique=True),
    )


class AuditLog(db.Model):
    __tablename__ = "audit_log"

    id: Mapped[uuid.UUID] = mapped_column(UUIDType, primary_key=True, default=uuid.uuid4)
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUIDType, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    entity_table: Mapped[str] = mapped_column(sa.String(120), nullable=False)
    entity_id: Mapped[str] = mapped_column(sa.String(64), nullable=False)
    action: Mapped[str] = mapped_column(sa.String(80), nullable=False)
    before_data: Mapped[dict | None] = mapped_column(JSONType, nullable=True)
    after_data: Mapped[dict | None] = mapped_column(JSONType, nullable=True)
    request_id: Mapped[str | None] = mapped_column(sa.String(120), nullable=True)
    ip_address: Mapped[str | None] = mapped_column(sa.String(64), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(sa.String(512), nullable=True)
    created_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), nullable=False, default=utc_now)

    __table_args__ = (
        Index("ix_audit_log_entity", "entity_table", "entity_id"),
        Index("ix_audit_log_actor_created", "actor_user_id", "created_at"),
    )


class InventoryOverride(AuditMixin, db.Model):
    __tablename__ = "inventory_overrides"

    name: Mapped[str] = mapped_column(sa.String(120), nullable=False)
    scope_type: Mapped[str] = mapped_column(sa.String(20), nullable=False, default="room")
    override_action: Mapped[str] = mapped_column(sa.String(20), nullable=False, default="close")
    room_id: Mapped[uuid.UUID | None] = mapped_column(
        UUIDType, ForeignKey("rooms.id", ondelete="SET NULL"), nullable=True
    )
    room_type_id: Mapped[uuid.UUID | None] = mapped_column(
        UUIDType, ForeignKey("room_types.id", ondelete="SET NULL"), nullable=True
    )
    start_date: Mapped[datetime] = mapped_column(sa.Date, nullable=False)
    end_date: Mapped[datetime] = mapped_column(sa.Date, nullable=False)
    reason: Mapped[str] = mapped_column(sa.String(255), nullable=False)
    is_active: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, default=True)
    expires_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)
    released_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)
    released_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUIDType, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    room = relationship("Room", foreign_keys=[room_id])
    room_type = relationship("RoomType", foreign_keys=[room_type_id])
    released_by_user = relationship("User", foreign_keys=[released_by_user_id])

    __table_args__ = (
        CheckConstraint(
            f"scope_type IN ({', '.join(repr(v) for v in INVENTORY_OVERRIDE_SCOPE_TYPES)})",
            name="ck_inventory_overrides_scope_type",
        ),
        CheckConstraint(
            f"override_action IN ({', '.join(repr(v) for v in INVENTORY_OVERRIDE_ACTIONS)})",
            name="ck_inventory_overrides_action",
        ),
        CheckConstraint("start_date <= end_date", name="ck_inventory_overrides_dates"),
        CheckConstraint(
            "((scope_type = 'room' AND room_id IS NOT NULL AND room_type_id IS NULL) OR "
            "(scope_type = 'room_type' AND room_type_id IS NOT NULL AND room_id IS NULL))",
            name="ck_inventory_overrides_scope_target",
        ),
        Index("ix_inventory_overrides_active_dates", "is_active", "start_date", "end_date"),
        Index("ix_inventory_overrides_room_dates", "room_id", "start_date", "end_date"),
        Index("ix_inventory_overrides_room_type_dates", "room_type_id", "start_date", "end_date"),
    )


class BlackoutPeriod(AuditMixin, db.Model):
    __tablename__ = "blackout_periods"

    name: Mapped[str] = mapped_column(sa.String(120), nullable=False)
    blackout_type: Mapped[str] = mapped_column(sa.String(30), nullable=False, default="closed_to_booking")
    start_date: Mapped[datetime] = mapped_column(sa.Date, nullable=False)
    end_date: Mapped[datetime] = mapped_column(sa.Date, nullable=False)
    reason: Mapped[str] = mapped_column(sa.String(255), nullable=False)
    is_active: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, default=True)

    __table_args__ = (
        CheckConstraint(
            f"blackout_type IN ({', '.join(repr(v) for v in BLACKOUT_TYPES)})",
            name="ck_blackout_periods_type",
        ),
        CheckConstraint("start_date <= end_date", name="ck_blackout_periods_dates"),
        Index("ix_blackout_periods_active_dates", "is_active", "start_date", "end_date"),
    )


class PolicyDocument(AuditMixin, SoftDeleteMixin, db.Model):
    __tablename__ = "policy_documents"

    code: Mapped[str] = mapped_column(sa.String(80), nullable=False, unique=True)
    name: Mapped[str] = mapped_column(sa.String(120), nullable=False)
    content_json: Mapped[dict] = mapped_column("content", JSONType, nullable=False)
    version: Mapped[str] = mapped_column(sa.String(40), nullable=False, default="2026-03")
    is_active: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, default=True)

    __table_args__ = (
        CheckConstraint(
            f"code IN ({', '.join(repr(v) for v in POLICY_DOCUMENT_CODES)})",
            name="ck_policy_documents_code",
        ),
        Index("ix_policy_documents_active", "is_active"),
    )


class NotificationTemplate(AuditMixin, SoftDeleteMixin, db.Model):
    __tablename__ = "notification_templates"

    template_key: Mapped[str] = mapped_column(sa.String(80), nullable=False)
    channel: Mapped[str] = mapped_column(sa.String(20), nullable=False, default="email")
    language_code: Mapped[str] = mapped_column(sa.String(20), nullable=False, default="th")
    description: Mapped[str | None] = mapped_column(sa.String(255), nullable=True)
    subject_template: Mapped[str] = mapped_column(sa.Text, nullable=False)
    body_template: Mapped[str] = mapped_column(sa.Text, nullable=False)
    is_active: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, default=True)

    __table_args__ = (
        CheckConstraint(
            f"template_key IN ({', '.join(repr(v) for v in NOTIFICATION_TEMPLATE_KEYS)})",
            name="ck_notification_templates_key",
        ),
        CheckConstraint(
            f"channel IN ({', '.join(repr(v) for v in NOTIFICATION_TEMPLATE_CHANNELS)})",
            name="ck_notification_templates_channel",
        ),
        CheckConstraint(
            f"language_code IN ({', '.join(repr(v) for v in BOOKING_LANGUAGES)})",
            name="ck_notification_templates_language",
        ),
        UniqueConstraint("template_key", "channel", "language_code", name="uq_notification_template_variant"),
        Index("ix_notification_templates_active_key", "template_key", "is_active"),
    )


class NotificationDelivery(AuditMixin, db.Model):
    __tablename__ = "notification_deliveries"

    event_type: Mapped[str] = mapped_column(sa.String(80), nullable=False)
    reservation_id: Mapped[uuid.UUID | None] = mapped_column(
        UUIDType, ForeignKey("reservations.id", ondelete="SET NULL"), nullable=True
    )
    payment_request_id: Mapped[uuid.UUID | None] = mapped_column(
        UUIDType, ForeignKey("payment_requests.id", ondelete="SET NULL"), nullable=True
    )
    audience_type: Mapped[str] = mapped_column(sa.String(20), nullable=False)
    channel: Mapped[str] = mapped_column(sa.String(30), nullable=False)
    template_id: Mapped[uuid.UUID | None] = mapped_column(
        UUIDType, ForeignKey("notification_templates.id", ondelete="SET NULL"), nullable=True
    )
    template_key: Mapped[str | None] = mapped_column(sa.String(80), nullable=True)
    language_code: Mapped[str] = mapped_column(sa.String(20), nullable=False, default="th")
    recipient_target: Mapped[str | None] = mapped_column(sa.String(255), nullable=True)
    recipient_name: Mapped[str | None] = mapped_column(sa.String(255), nullable=True)
    event_key: Mapped[str | None] = mapped_column(sa.String(160), nullable=True)
    dedupe_key: Mapped[str] = mapped_column(sa.String(160), nullable=False, unique=True)
    status: Mapped[str] = mapped_column(sa.String(20), nullable=False, default="pending")
    failure_category: Mapped[str | None] = mapped_column(sa.String(40), nullable=True)
    failure_reason: Mapped[str | None] = mapped_column(sa.String(255), nullable=True)
    rendered_subject: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    rendered_body: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    metadata_json: Mapped[dict | None] = mapped_column("metadata", JSONType, nullable=True)
    email_outbox_id: Mapped[uuid.UUID | None] = mapped_column(
        UUIDType, ForeignKey("email_outbox.id", ondelete="SET NULL"), nullable=True
    )
    staff_notification_id: Mapped[uuid.UUID | None] = mapped_column(
        UUIDType, ForeignKey("staff_notifications.id", ondelete="SET NULL"), nullable=True
    )
    external_message_id: Mapped[str | None] = mapped_column(sa.String(255), nullable=True)
    queued_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)
    sent_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)
    delivered_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)
    failed_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)
    attempts: Mapped[int] = mapped_column(sa.Integer, nullable=False, default=0)

    reservation = relationship("Reservation", foreign_keys=[reservation_id])
    payment_request = relationship("PaymentRequest", foreign_keys=[payment_request_id])
    template = relationship("NotificationTemplate", foreign_keys=[template_id])
    email_outbox = relationship("EmailOutbox", foreign_keys=[email_outbox_id])
    staff_notification = relationship("StaffNotification", foreign_keys=[staff_notification_id])

    __table_args__ = (
        CheckConstraint(
            f"audience_type IN ({', '.join(repr(v) for v in NOTIFICATION_AUDIENCE_TYPES)})",
            name="ck_notification_deliveries_audience",
        ),
        CheckConstraint(
            f"channel IN ({', '.join(repr(v) for v in NOTIFICATION_TEMPLATE_CHANNELS)})",
            name="ck_notification_deliveries_channel",
        ),
        CheckConstraint(
            f"language_code IN ({', '.join(repr(v) for v in BOOKING_LANGUAGES)})",
            name="ck_notification_deliveries_language",
        ),
        CheckConstraint(
            f"status IN ({', '.join(repr(v) for v in NOTIFICATION_DELIVERY_STATUSES)})",
            name="ck_notification_deliveries_status",
        ),
        CheckConstraint("attempts >= 0", name="ck_notification_deliveries_attempts"),
        Index("ix_notification_deliveries_reservation_created", "reservation_id", "created_at"),
        Index("ix_notification_deliveries_payment_created", "payment_request_id", "created_at"),
        Index("ix_notification_deliveries_status_created", "status", "created_at"),
        Index("ix_notification_deliveries_channel_status", "channel", "status"),
        Index("ix_notification_deliveries_event_created", "event_type", "created_at"),
    )


class AppSetting(AuditMixin, SoftDeleteMixin, db.Model):
    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(sa.String(120), nullable=False, unique=True)
    value_json: Mapped[dict] = mapped_column(JSONType, nullable=False)
    value_type: Mapped[str] = mapped_column(sa.String(40), nullable=False)
    description: Mapped[str | None] = mapped_column(sa.String(255), nullable=True)
    is_public: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, default=False)
    sort_order: Mapped[int] = mapped_column(sa.Integer, nullable=False, default=0)


def _timestamp_before_update(mapper, connection, target) -> None:  # noqa: ARG001
    target.updated_at = utc_now()


def _prevent_append_only_mutation(mapper, connection, target) -> None:  # noqa: ARG001
    raise ValueError(f"{target.__class__.__name__} is append-only and cannot be modified.")


for model in (
    User,
    Role,
    Permission,
    Guest,
    GuestNote,
    RoomType,
    Room,
    HousekeepingStatus,
    Reservation,
    ReservationHold,
    ReservationReviewQueue,
    InventoryDay,
    RateRule,
    PaymentRequest,
    EmailOutbox,
    InventoryOverride,
    BlackoutPeriod,
    PolicyDocument,
    NotificationTemplate,
    NotificationDelivery,
    AppSetting,
):
    event.listen(model, "before_update", _timestamp_before_update)


for model in (
    ActivityLog,
    AuditLog,
    PaymentEvent,
    ReservationStatusHistory,
    RoomStatusHistory,
):
    event.listen(model, "before_update", _prevent_append_only_mutation)
    event.listen(model, "before_delete", _prevent_append_only_mutation)
