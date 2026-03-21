from __future__ import annotations

from datetime import timedelta

import sqlalchemy as sa
from flask import current_app

from .security import current_request_id, request_client_ip, request_user_agent, sanitize_log_data

from .extensions import db
from .models import AuditLog
from .models import utc_now


def write_audit_log(
    *,
    actor_user_id,
    entity_table: str,
    entity_id: str,
    action: str,
    before_data: dict | None = None,
    after_data: dict | None = None,
) -> None:
    db.session.add(
        AuditLog(
            actor_user_id=actor_user_id,
            entity_table=entity_table,
            entity_id=entity_id,
            action=action,
            before_data=sanitize_log_data(before_data),
            after_data=sanitize_log_data(after_data),
            request_id=current_request_id(),
            ip_address=request_client_ip(),
            user_agent=request_user_agent(),
        )
    )


def cleanup_audit_logs(*, retention_days: int | None = None, dry_run: bool = False) -> dict[str, object]:
    configured_days = retention_days
    if configured_days is None:
        configured_days = int(current_app.config.get("AUDIT_LOG_RETENTION_DAYS", 0) or 0)
    days = int(configured_days or 0)
    if days <= 0:
        return {
            "enabled": False,
            "deleted": 0,
            "retention_days": days,
            "cutoff": None,
            "dry_run": dry_run,
        }

    cutoff = utc_now() - timedelta(days=days)
    delete_stmt = sa.delete(AuditLog).where(AuditLog.created_at < cutoff)
    if dry_run:
        count_stmt = sa.select(sa.func.count()).select_from(AuditLog).where(AuditLog.created_at < cutoff)
        deleted = int(db.session.execute(count_stmt).scalar_one())
    else:
        deleted = int(db.session.execute(delete_stmt).rowcount or 0)
        db.session.commit()

    return {
        "enabled": True,
        "deleted": deleted,
        "retention_days": days,
        "cutoff": cutoff,
        "dry_run": dry_run,
    }
