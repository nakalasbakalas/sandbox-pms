"""Admin policy, notification template, role, and audit operations."""

from __future__ import annotations

from .admin_base import *  # noqa: F401,F403

@dataclass
class PolicyPayload:
    code: str
    name: str
    version: str
    content: dict[str, str]
    is_active: bool


def upsert_policy_document(payload: PolicyPayload, *, actor_user_id: uuid.UUID) -> PolicyDocument:
    if payload.code not in POLICY_DOCUMENT_CODES:
        raise ValueError("Policy document code is invalid.")
    normalized_content = {}
    for language_code in BOOKING_LANGUAGES:
        text = clean_optional(payload.content.get(language_code), limit=5000)
        if not text:
            raise ValueError(f"Policy content is required for {language_code}.")
        normalized_content[language_code] = text

    document = (
        db.session.execute(sa.select(PolicyDocument).where(PolicyDocument.code == payload.code))
        .scalars()
        .first()
    )
    before = _policy_snapshot(document) if document else None
    if not document:
        document = PolicyDocument(code=payload.code, created_by_user_id=actor_user_id)
        db.session.add(document)
    document.name = payload.name.strip()
    document.version = payload.version.strip()
    document.content_json = normalized_content
    document.is_active = payload.is_active
    document.updated_by_user_id = actor_user_id
    db.session.flush()

    write_audit_log(
        actor_user_id=actor_user_id,
        entity_table="policy_documents",
        entity_id=str(document.id),
        action="policy_upserted",
        before_data=before,
        after_data=_policy_snapshot(document),
    )
    write_activity_log(
        actor_user_id=actor_user_id,
        event_type="admin.policy_updated",
        entity_table="policy_documents",
        entity_id=str(document.id),
        metadata={"code": document.code, "version": document.version},
    )
    db.session.commit()
    return document


def policy_text(code: str, language: str, fallback: str) -> str:
    document = (
        db.session.execute(
            sa.select(PolicyDocument).where(
                PolicyDocument.code == code,
                PolicyDocument.is_active.is_(True),
                PolicyDocument.deleted_at.is_(None),
            )
        )
        .scalars()
        .first()
    )
    if not document:
        default_document = POLICY_DOCUMENTS_SEED.get(code)
        if default_document:
            return default_document["content"].get(language) or default_document["content"].get("en") or fallback
        return fallback
    return (
        document.content_json.get(language)
        or document.content_json.get("en")
        or next(iter(document.content_json.values()))
        or fallback
    )


def policy_documents_context() -> dict[str, PolicyDocument | None]:
    """Return active policy documents keyed by code."""
    docs = db.session.execute(
        sa.select(PolicyDocument).where(
            PolicyDocument.is_active.is_(True),
            PolicyDocument.deleted_at.is_(None),
        )
    ).scalars().all()
    return {doc.code: doc for doc in docs}


@dataclass
class NotificationTemplatePayload:
    template_key: str
    channel: str
    language_code: str
    description: str | None
    subject_template: str
    body_template: str
    is_active: bool


def upsert_notification_template(
    template_id: uuid.UUID | None,
    payload: NotificationTemplatePayload,
    *,
    actor_user_id: uuid.UUID,
) -> NotificationTemplate:
    if payload.channel not in NOTIFICATION_TEMPLATE_CHANNELS:
        raise ValueError("Notification channel is invalid.")
    if payload.language_code not in BOOKING_LANGUAGES:
        raise ValueError("Language code is invalid.")
    allowed_tokens = set(NOTIFICATION_TEMPLATE_PLACEHOLDERS.get(payload.template_key, []))
    if not allowed_tokens:
        raise ValueError("Notification template key is invalid.")
    _validate_template_tokens(payload.subject_template, allowed_tokens)
    _validate_template_tokens(payload.body_template, allowed_tokens)

    existing = (
        db.session.execute(
            sa.select(NotificationTemplate).where(
                NotificationTemplate.template_key == payload.template_key,
                NotificationTemplate.channel == payload.channel,
                NotificationTemplate.language_code == payload.language_code,
                NotificationTemplate.deleted_at.is_(None),
            )
        )
        .scalars()
        .first()
    )
    if existing and existing.id != template_id:
        raise ValueError("A template already exists for that key, channel, and language.")

    template = db.session.get(NotificationTemplate, template_id) if template_id else None
    if template_id and not template:
        raise ValueError("Notification template not found.")
    before = _notification_template_snapshot(template) if template else None

    if not template:
        template = NotificationTemplate(created_by_user_id=actor_user_id)
        db.session.add(template)
    template.template_key = payload.template_key
    template.channel = payload.channel
    template.language_code = payload.language_code
    template.description = clean_optional(payload.description, limit=255)
    template.subject_template = payload.subject_template.strip()
    template.body_template = payload.body_template.strip()
    template.is_active = payload.is_active
    template.updated_by_user_id = actor_user_id
    db.session.flush()

    write_audit_log(
        actor_user_id=actor_user_id,
        entity_table="notification_templates",
        entity_id=str(template.id),
        action="notification_template_upserted",
        before_data=before,
        after_data=_notification_template_snapshot(template),
    )
    write_activity_log(
        actor_user_id=actor_user_id,
        event_type="admin.notification_template_updated",
        entity_table="notification_templates",
        entity_id=str(template.id),
        metadata={"template_key": template.template_key, "language_code": template.language_code},
    )
    db.session.commit()
    return template


def get_notification_template_variant(
    template_key: str,
    language_code: str,
    *,
    channel: str = "email",
) -> NotificationTemplate | None:
    fallback_channels = [channel]
    if channel != "email":
        fallback_channels.append("email")
    fallback_languages = [language_code]
    if language_code != "en":
        fallback_languages.append("en")
    for candidate_channel in fallback_channels:
        for candidate_language in fallback_languages:
            template = (
                db.session.execute(
                    sa.select(NotificationTemplate).where(
                        NotificationTemplate.template_key == template_key,
                        NotificationTemplate.channel == candidate_channel,
                        NotificationTemplate.language_code == candidate_language,
                        NotificationTemplate.is_active.is_(True),
                        NotificationTemplate.deleted_at.is_(None),
                    )
                    .order_by(NotificationTemplate.updated_at.desc())
                )
                .scalars()
                .first()
            )
            if template:
                return template
    return None


def preview_notification_template(template_key: str, language_code: str, *, channel: str = "email") -> dict[str, str]:
    allowed_tokens = set(NOTIFICATION_TEMPLATE_PLACEHOLDERS.get(template_key, []))
    template = get_notification_template_variant(template_key, language_code, channel=channel)
    context = sample_notification_context(language_code)
    if template:
        return {
            "subject": _render_template_text(template.subject_template, context, allowed_tokens),
            "body": _render_template_text(template.body_template, context, allowed_tokens),
        }
    return {"subject": "", "body": ""}


def render_notification_template(
    template_key: str,
    language_code: str,
    context: dict[str, object],
    *,
    fallback_subject: str,
    fallback_body: str,
    channel: str = "email",
) -> tuple[str, str]:
    def _append_guest_branding_footer(body_text: str) -> str:
        if channel != "email" or template_key.startswith("internal_"):
            return body_text
        extra_lines: list[str] = []
        support_contact_text = str(context.get("support_contact_text") or "").strip()
        public_booking_url = str(context.get("public_booking_url") or "").strip()
        if support_contact_text and support_contact_text not in body_text:
            extra_lines.append(support_contact_text)
        if public_booking_url and public_booking_url not in body_text:
            extra_lines.append(public_booking_url)
        if not extra_lines:
            return body_text
        separator = "" if not body_text else "\n"
        footer_text = "\n".join(extra_lines)
        return f"{body_text}{separator}{footer_text}"

    template = get_notification_template_variant(template_key, language_code, channel=channel)
    if not template:
        return fallback_subject, _append_guest_branding_footer(fallback_body)
    allowed_tokens = set(NOTIFICATION_TEMPLATE_PLACEHOLDERS.get(template_key, []))
    subject = _render_template_text(template.subject_template, context, allowed_tokens) or fallback_subject
    body = _render_template_text(template.body_template, context, allowed_tokens) or fallback_body
    return subject, _append_guest_branding_footer(body)


def update_role_permissions(role_id: uuid.UUID, permission_codes: list[str], *, actor_user_id: uuid.UUID) -> Role:
    role = db.session.get(Role, role_id)
    if not role:
        raise ValueError("Role not found.")
    selected_permissions = (
        db.session.execute(sa.select(Permission).where(Permission.code.in_(permission_codes)))
        .scalars()
        .all()
    )
    if len(selected_permissions) != len(set(permission_codes)):
        raise ValueError("One or more selected permissions are invalid.")
    before = {"permissions": [item.code for item in role.permissions]}
    role.permissions = selected_permissions
    role.updated_by_user_id = actor_user_id

    write_audit_log(
        actor_user_id=actor_user_id,
        entity_table="roles",
        entity_id=str(role.id),
        action="role_permissions_updated",
        before_data=before,
        after_data={"permissions": sorted(permission_codes)},
    )
    write_activity_log(
        actor_user_id=actor_user_id,
        event_type="admin.role_permissions_updated",
        entity_table="roles",
        entity_id=str(role.id),
        metadata={"role_code": role.code, "permission_count": len(permission_codes)},
    )
    db.session.commit()
    return role


def query_audit_entries(
    *,
    actor_user_id: uuid.UUID | None = None,
    entity_table: str | None = None,
    action: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    limit: int = 200,
) -> list[AuditLog]:
    query = sa.select(AuditLog)
    if actor_user_id:
        query = query.where(AuditLog.actor_user_id == actor_user_id)
    if entity_table:
        query = query.where(AuditLog.entity_table == entity_table)
    if action:
        query = query.where(AuditLog.action == action)
    if date_from:
        query = query.where(AuditLog.created_at >= datetime.combine(date_from, datetime.min.time(), tzinfo=timezone.utc))
    if date_to:
        query = query.where(AuditLog.created_at < datetime.combine(date_to + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc))
    return db.session.execute(query.order_by(AuditLog.created_at.desc()).limit(limit)).scalars().all()


def summarize_audit_entry(entry: AuditLog) -> str:
    if entry.after_data and isinstance(entry.after_data, dict):
        interesting = list(entry.after_data.items())[:3]
        return ", ".join(f"{key}={value}" for key, value in interesting)
    if entry.before_data and isinstance(entry.before_data, dict):
        interesting = list(entry.before_data.items())[:3]
        return ", ".join(f"{key}={value}" for key, value in interesting)
    return ""


def sample_notification_context(language_code: str) -> dict[str, object]:
    branding = branding_settings_context()
    return {
        "hotel_name": branding["hotel_name"],
        "hotel_logo_url": branding["logo_url"],
        "hotel_address": branding["address"],
        "hotel_name": str(get_setting_value("hotel.name", "Sandbox Hotel")),
        "guest_name": "Sample Guest",
        "reservation_code": "SBX-00009999",
        "check_in_date": "2026-04-01",
        "check_out_date": "2026-04-03",
        "room_type_name": "Standard Double",
        "grand_total": "1500.00",
        "deposit_amount": "750.00",
        "payment_link": f"{branding['public_base_url']}/payments/request/PAY-SAMPLE" if branding["public_base_url"] else "/payments/request/PAY-SAMPLE",
        "contact_phone": branding["contact_phone"],
        "contact_email": branding["contact_email"],
        "support_contact_text": branding["support_contact_text"],
        "public_booking_url": branding["public_base_url"],
        "payment_link": build_booking_url("/payments/request/PAY-SAMPLE"),
        "contact_phone": str(get_setting_value("hotel.contact_phone", "+66 000 000 000")),
        "contact_email": str(get_setting_value("hotel.contact_email", "reservations@sandbox-hotel.local")),
        "cancellation_policy": policy_text("cancellation_policy", language_code, ""),
        "check_in_policy": policy_text("check_in_policy", language_code, ""),
        "check_out_policy": policy_text("check_out_policy", language_code, ""),
        "source_channel": "direct_web",
    }



def _validate_template_tokens(template_text: str, allowed_tokens: set[str]) -> None:
    tokens = {field_name for _, field_name, _, _ in string.Formatter().parse(template_text) if field_name}
    unknown_tokens = sorted(tokens - allowed_tokens)
    if unknown_tokens:
        raise ValueError(f"Unknown template placeholders: {', '.join(unknown_tokens)}")


def _render_template_text(template_text: str, context: dict[str, object], allowed_tokens: set[str]) -> str:
    _validate_template_tokens(template_text, allowed_tokens)
    safe_context = {key: str(value or "") for key, value in context.items()}
    return template_text.format_map(_TemplateContext(safe_context))


class _TemplateContext(dict):
    def __missing__(self, key: str) -> str:
        return "{" + key + "}"



def _policy_snapshot(document: PolicyDocument | None) -> dict | None:
    if not document:
        return None
    return {
        "code": document.code,
        "name": document.name,
        "version": document.version,
        "is_active": document.is_active,
        "content": document.content_json,
    }


def _notification_template_snapshot(template: NotificationTemplate | None) -> dict | None:
    if not template:
        return None
    return {
        "template_key": template.template_key,
        "channel": template.channel,
        "language_code": template.language_code,
        "is_active": template.is_active,
        "description": template.description,
    }


