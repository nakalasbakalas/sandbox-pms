from __future__ import annotations

from .extensions import db
from .models import ActivityLog
from .security import request_client_ip, request_user_agent, sanitize_log_data


def write_activity_log(
    *,
    actor_user_id,
    event_type: str,
    entity_table: str | None = None,
    entity_id: str | None = None,
    metadata: dict | None = None,
) -> None:
    db.session.add(
        ActivityLog(
            actor_user_id=actor_user_id,
            event_type=event_type,
            entity_table=entity_table,
            entity_id=entity_id,
            metadata_json=sanitize_log_data(metadata),
            ip_address=request_client_ip(),
            user_agent=request_user_agent(),
        )
    )
