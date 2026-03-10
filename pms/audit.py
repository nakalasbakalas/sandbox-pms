from __future__ import annotations

from .security import current_request_id, request_client_ip, request_user_agent, sanitize_log_data

from .extensions import db
from .models import AuditLog


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
