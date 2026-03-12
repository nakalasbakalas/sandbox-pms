from __future__ import annotations

import hashlib
import secrets
import urllib.error
import urllib.parse
import urllib.request
import uuid
from collections import Counter
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

import sqlalchemy as sa
from flask import current_app, url_for
from icalendar import Calendar, Event

from ..activity import write_activity_log
from ..audit import write_audit_log
from ..extensions import db
from ..models import (
    CalendarFeed,
    ExternalCalendarBlock,
    ExternalCalendarSource,
    ExternalCalendarSyncRun,
    Reservation,
    Room,
    utc_now,
)
from ..pricing import get_setting_value
from .auth_service import decrypt_secret, encrypt_secret

ACTIVE_CALENDAR_RESERVATION_STATUSES = {"tentative", "confirmed", "checked_in", "house_use"}


@dataclass(slots=True)
class CalendarFeedToken:
    feed: CalendarFeed
    token: str


def calendar_export_enabled() -> bool:
    return bool(get_setting_value("calendar.export_enabled", True))


def calendar_import_enabled() -> bool:
    return bool(get_setting_value("calendar.import_enabled", True))


def calendar_timezone_name() -> str:
    return str(get_setting_value("hotel.timezone", "Asia/Bangkok") or "Asia/Bangkok")


def calendar_timezone() -> ZoneInfo:
    try:
        return ZoneInfo(calendar_timezone_name())
    except Exception:  # noqa: BLE001
        return ZoneInfo("UTC")


def list_calendar_feeds(*, scope_type: str | None = None) -> list[CalendarFeed]:
    query = CalendarFeed.query.options(sa.orm.joinedload(CalendarFeed.room))
    if scope_type:
        query = query.filter(CalendarFeed.scope_type == scope_type)
    return query.order_by(CalendarFeed.scope_type.asc(), CalendarFeed.name.asc()).all()


def create_calendar_feed(
    *,
    scope_type: str,
    actor_user_id: uuid.UUID | None,
    room_id: uuid.UUID | None = None,
    name: str | None = None,
) -> CalendarFeedToken:
    _validate_scope(scope_type, room_id)
    room = db.session.get(Room, room_id) if room_id else None
    if scope_type == "room" and not room:
        raise ValueError("Room feed requires a valid room.")

    existing = _find_existing_feed(scope_type=scope_type, room_id=room_id)
    if existing and existing.is_active:
        return rotate_calendar_feed(existing.id, actor_user_id=actor_user_id)

    token = secrets.token_urlsafe(32)
    feed = CalendarFeed(
        scope_type=scope_type,
        room_id=room_id,
        name=(name or _default_feed_name(scope_type, room)).strip()[:120],
        token_hash=_token_hash(token),
        token_encrypted=encrypt_secret(token),
        token_hint=_token_hint(token),
        is_active=True,
        last_rotated_at=utc_now(),
        created_by_user_id=actor_user_id,
        updated_by_user_id=actor_user_id,
    )
    db.session.add(feed)
    db.session.flush()
    write_audit_log(
        actor_user_id=actor_user_id,
        entity_table="calendar_feeds",
        entity_id=str(feed.id),
        action="calendar_feed_created",
        after_data={
            "scope_type": scope_type,
            "room_id": str(room_id) if room_id else None,
            "name": feed.name,
            "token_hint": feed.token_hint,
        },
    )
    write_activity_log(
        actor_user_id=actor_user_id,
        event_type="calendar.feed_created",
        entity_table="calendar_feeds",
        entity_id=str(feed.id),
        metadata={"scope_type": scope_type, "room_id": str(room_id) if room_id else None},
    )
    db.session.commit()
    return CalendarFeedToken(feed=feed, token=token)


def rotate_calendar_feed(feed_id: uuid.UUID, *, actor_user_id: uuid.UUID | None) -> CalendarFeedToken:
    feed = (
        db.session.execute(sa.select(CalendarFeed).where(CalendarFeed.id == feed_id).with_for_update())
        .scalars()
        .first()
    )
    if not feed:
        raise ValueError("Calendar feed not found.")
    token = secrets.token_urlsafe(32)
    before_data = {"token_hint": feed.token_hint, "is_active": feed.is_active}
    feed.token_hash = _token_hash(token)
    feed.token_encrypted = encrypt_secret(token)
    feed.token_hint = _token_hint(token)
    feed.is_active = True
    feed.last_rotated_at = utc_now()
    feed.updated_by_user_id = actor_user_id
    write_audit_log(
        actor_user_id=actor_user_id,
        entity_table="calendar_feeds",
        entity_id=str(feed.id),
        action="calendar_feed_rotated",
        before_data=before_data,
        after_data={"token_hint": feed.token_hint, "is_active": True},
    )
    write_activity_log(
        actor_user_id=actor_user_id,
        event_type="calendar.feed_rotated",
        entity_table="calendar_feeds",
        entity_id=str(feed.id),
        metadata={"scope_type": feed.scope_type, "room_id": str(feed.room_id) if feed.room_id else None},
    )
    db.session.commit()
    return CalendarFeedToken(feed=feed, token=token)


def resolve_calendar_feed_by_token(token: str) -> CalendarFeed | None:
    candidate = (token or "").strip()
    if not candidate:
        return None
    feed = CalendarFeed.query.filter_by(token_hash=_token_hash(candidate), is_active=True).first()
    if feed:
        feed.last_accessed_at = utc_now()
        db.session.commit()
    return feed


def calendar_feed_export_url(feed: CalendarFeed) -> str:
    token = decrypt_secret(feed.token_encrypted)
    base = str(current_app.config.get("APP_BASE_URL") or "").strip().rstrip("/")
    path = url_for("calendar_feed_export", token=token)
    if base:
        return f"{base}{path}"
    return url_for("calendar_feed_export", token=token, _external=True)


def export_feed_ical(token: str) -> tuple[CalendarFeed, bytes]:
    if not calendar_export_enabled():
        raise ValueError("Calendar export is disabled.")
    feed = resolve_calendar_feed_by_token(token)
    if not feed:
        raise LookupError("Calendar feed not found.")
    calendar = Calendar()
    calendar.add("prodid", "-//Sandbox Hotel//PMS Calendar//EN")
    calendar.add("version", "2.0")
    calendar.add("calscale", "GREGORIAN")
    calendar.add("x-wr-timezone", calendar_timezone_name())
    calendar.add("x-wr-calname", feed.name)

    for event in _internal_feed_events(feed):
        calendar.add_component(event)
    for event in _external_block_feed_events(feed):
        calendar.add_component(event)

    return feed, calendar.to_ical()


def list_external_calendar_sources() -> list[ExternalCalendarSource]:
    return (
        ExternalCalendarSource.query.options(sa.orm.joinedload(ExternalCalendarSource.room))
        .filter(ExternalCalendarSource.deleted_at.is_(None))
        .order_by(ExternalCalendarSource.is_active.desc(), ExternalCalendarSource.name.asc())
        .all()
    )


def create_external_calendar_source(
    *,
    room_id: uuid.UUID,
    name: str,
    feed_url: str,
    actor_user_id: uuid.UUID | None,
) -> ExternalCalendarSource:
    if not calendar_import_enabled():
        raise ValueError("External calendar import is disabled.")
    room = db.session.get(Room, room_id)
    if not room:
        raise ValueError("Room not found.")
    cleaned_name = (name or "").strip()
    if not cleaned_name:
        raise ValueError("Source name is required.")
    normalized_url = normalize_external_feed_url(feed_url)
    source = ExternalCalendarSource(
        room_id=room.id,
        name=cleaned_name[:120],
        feed_url_encrypted=encrypt_secret(normalized_url),
        feed_url_hint=_feed_url_hint(normalized_url),
        external_reference=_external_reference(normalized_url),
        is_active=True,
        created_by_user_id=actor_user_id,
        updated_by_user_id=actor_user_id,
    )
    db.session.add(source)
    db.session.flush()
    write_audit_log(
        actor_user_id=actor_user_id,
        entity_table="external_calendar_sources",
        entity_id=str(source.id),
        action="external_calendar_source_created",
        after_data={"room_id": str(room.id), "name": source.name, "feed_url_hint": source.feed_url_hint},
    )
    write_activity_log(
        actor_user_id=actor_user_id,
        event_type="calendar.source_created",
        entity_table="external_calendar_sources",
        entity_id=str(source.id),
        metadata={"room_id": str(room.id), "name": source.name},
    )
    db.session.commit()
    return source


def sync_external_calendar_source(
    source_id: uuid.UUID,
    *,
    actor_user_id: uuid.UUID | None,
) -> dict[str, Any]:
    if not calendar_import_enabled():
        raise ValueError("External calendar import is disabled.")

    source = (
        db.session.execute(sa.select(ExternalCalendarSource).where(ExternalCalendarSource.id == source_id).with_for_update())
        .scalars()
        .first()
    )
    if not source or source.deleted_at is not None:
        raise ValueError("External calendar source not found.")
    if not source.is_active:
        raise ValueError("External calendar source is disabled.")

    run = ExternalCalendarSyncRun(
        source_id=source.id,
        status="success",
        started_at=utc_now(),
        created_by_user_id=actor_user_id,
        updated_by_user_id=actor_user_id,
    )
    db.session.add(run)
    db.session.flush()

    try:
        raw_bytes = _fetch_feed_bytes(source)
        parsed_events = parse_ical_events(raw_bytes)
        stats = _apply_sync_events(source, parsed_events, actor_user_id=actor_user_id)
        run.status = "conflict" if stats["conflict_count"] else "success"
        run.finished_at = utc_now()
        run.fetched_event_count = stats["fetched_event_count"]
        run.upserted_block_count = stats["upserted_block_count"]
        run.duplicate_event_count = stats["duplicate_event_count"]
        run.released_block_count = stats["released_block_count"]
        run.conflict_count = stats["conflict_count"]
        run.metadata_json = {"uids": stats["uids"][:50]}
        source.last_synced_at = run.finished_at
        source.last_successful_sync_at = run.finished_at
        source.last_status = run.status
        source.last_error = None
        source.updated_by_user_id = actor_user_id
        write_audit_log(
            actor_user_id=actor_user_id,
            entity_table="external_calendar_sources",
            entity_id=str(source.id),
            action="external_calendar_sync",
            after_data={
                "status": run.status,
                "fetched_event_count": run.fetched_event_count,
                "upserted_block_count": run.upserted_block_count,
                "released_block_count": run.released_block_count,
                "conflict_count": run.conflict_count,
            },
        )
        write_activity_log(
            actor_user_id=actor_user_id,
            event_type="calendar.sync_completed",
            entity_table="external_calendar_sources",
            entity_id=str(source.id),
            metadata={
                "room_id": str(source.room_id),
                "status": run.status,
                "conflict_count": run.conflict_count,
            },
        )
        db.session.commit()
        return {"source": source, "run": run, **stats}
    except Exception as exc:  # noqa: BLE001
        db.session.rollback()
        source = db.session.get(ExternalCalendarSource, source_id)
        if source:
            run = ExternalCalendarSyncRun(
                source_id=source.id,
                status="failed",
                started_at=utc_now(),
                finished_at=utc_now(),
                error_message=str(exc)[:255],
                created_by_user_id=actor_user_id,
                updated_by_user_id=actor_user_id,
            )
            source.last_synced_at = utc_now()
            source.last_status = "failed"
            source.last_error = str(exc)[:255]
            source.updated_by_user_id = actor_user_id
            db.session.add(run)
            write_activity_log(
                actor_user_id=actor_user_id,
                event_type="calendar.sync_failed",
                entity_table="external_calendar_sources",
                entity_id=str(source.id),
                metadata={"room_id": str(source.room_id), "error": str(exc)[:255]},
            )
            db.session.commit()
        raise


def sync_all_external_calendar_sources(*, actor_user_id: uuid.UUID | None) -> dict[str, int]:
    totals = {"sources": 0, "success": 0, "conflict": 0, "failed": 0}
    source_ids = [
        item.id
        for item in ExternalCalendarSource.query.filter(
            ExternalCalendarSource.deleted_at.is_(None),
            ExternalCalendarSource.is_active.is_(True),
        )
        .order_by(ExternalCalendarSource.created_at.asc())
        .all()
    ]
    for source_id in source_ids:
        totals["sources"] += 1
        try:
            result = sync_external_calendar_source(source_id, actor_user_id=actor_user_id)
            if result["run"].status == "conflict":
                totals["conflict"] += 1
            else:
                totals["success"] += 1
        except Exception:  # noqa: BLE001
            totals["failed"] += 1
    return totals


def room_has_external_block(
    room_id: uuid.UUID,
    start_date: date,
    end_date: date,
    *,
    for_update: bool = False,
) -> bool:
    return bool(overlapping_external_blocks(room_id, start_date, end_date, limit=1, for_update=for_update))


def overlapping_external_blocks(
    room_id: uuid.UUID,
    start_date: date,
    end_date: date,
    *,
    limit: int | None = None,
    for_update: bool = False,
) -> list[ExternalCalendarBlock]:
    query = ExternalCalendarBlock.query.filter(
        ExternalCalendarBlock.room_id == room_id,
        ExternalCalendarBlock.starts_on < end_date,
        ExternalCalendarBlock.ends_on > start_date,
    ).order_by(ExternalCalendarBlock.starts_on.asc(), ExternalCalendarBlock.external_uid.asc())
    if for_update:
        query = query.with_for_update()
    if limit:
        query = query.limit(limit)
    return query.all()


def provider_calendar_context() -> dict[str, Any]:
    property_feeds = list_calendar_feeds(scope_type="property")
    room_feeds = list_calendar_feeds(scope_type="room")
    sources = list_external_calendar_sources()
    source_ids = [item.id for item in sources]
    conflict_counts = {
        source_id: count
        for source_id, count in db.session.query(
            ExternalCalendarBlock.source_id,
            sa.func.count(ExternalCalendarBlock.id),
        )
        .filter(ExternalCalendarBlock.source_id.in_(source_ids), ExternalCalendarBlock.is_conflict.is_(True))
        .group_by(ExternalCalendarBlock.source_id)
        .all()
    } if source_ids else {}
    latest_runs = {}
    if source_ids:
        run_rows = (
            ExternalCalendarSyncRun.query.filter(ExternalCalendarSyncRun.source_id.in_(source_ids))
            .order_by(ExternalCalendarSyncRun.started_at.desc())
            .all()
        )
        for run in run_rows:
            latest_runs.setdefault(run.source_id, run)

    return {
        "export_enabled": calendar_export_enabled(),
        "import_enabled": calendar_import_enabled(),
        "timezone_name": calendar_timezone_name(),
        "property_feed": _serialize_feed(property_feeds[0]) if property_feeds else None,
        "room_feeds": [_serialize_feed(item) for item in room_feeds],
        "sources": [
            _serialize_source(item, conflict_count=conflict_counts.get(item.id, 0), latest_run=latest_runs.get(item.id))
            for item in sources
        ],
        "rooms_without_feed": [
            room
            for room in Room.query.filter_by(is_active=True).order_by(Room.room_number.asc()).all()
            if room.id not in {feed.room_id for feed in room_feeds if feed.room_id}
        ],
        "recent_conflicts": [
            _serialize_conflict(item)
            for item in ExternalCalendarBlock.query.options(
                sa.orm.joinedload(ExternalCalendarBlock.room),
                sa.orm.joinedload(ExternalCalendarBlock.conflict_reservation),
            )
            .filter(ExternalCalendarBlock.is_conflict.is_(True))
            .order_by(ExternalCalendarBlock.last_seen_at.desc())
            .limit(20)
            .all()
        ],
    }


def parse_ical_events(payload: bytes) -> list[dict[str, Any]]:
    calendar = Calendar.from_ical(payload)
    events: list[dict[str, Any]] = []
    for component in calendar.walk("VEVENT"):
        raw_status = str(component.get("STATUS") or "").strip().upper()
        transparency = str(component.get("TRANSP") or "").strip().upper()
        if raw_status == "CANCELLED" or transparency == "TRANSPARENT":
            continue
        starts_on, ends_on = _component_dates(component)
        if starts_on >= ends_on:
            continue
        external_uid = str(component.get("UID") or _event_fallback_uid(component, starts_on, ends_on))
        categories = _component_categories(component)
        x_properties = _component_x_properties(component)
        sequence = _component_sequence(component)
        events.append(
            {
                "external_uid": external_uid[:255],
                "summary": _truncate(str(component.get("SUMMARY") or "").strip(), 255),
                "starts_on": starts_on,
                "ends_on": ends_on,
                "event_created_at": _component_timestamp(component.get("CREATED")),
                "event_updated_at": _component_timestamp(component.get("LAST-MODIFIED") or component.get("DTSTAMP")),
                "raw_status": raw_status or None,
                "metadata_json": {
                    "location": _truncate(str(component.get("LOCATION") or "").strip(), 255) or None,
                    "description": _truncate(str(component.get("DESCRIPTION") or "").strip(), 255) or None,
                    "categories": categories or None,
                    "sequence": sequence,
                    "x_properties": x_properties or None,
                    "last_modified": _component_timestamp(component.get("LAST-MODIFIED")).isoformat()
                    if _component_timestamp(component.get("LAST-MODIFIED"))
                    else None,
                    "dtstamp": _component_timestamp(component.get("DTSTAMP")).isoformat()
                    if _component_timestamp(component.get("DTSTAMP"))
                    else None,
                    "timezone_issue": _component_timezone_issue(component),
                },
            }
        )
    return events


def export_front_desk_blocks_ical(
    blocks: list[dict[str, Any]],
    *,
    calendar_name: str,
) -> bytes:
    calendar = Calendar()
    calendar.add("prodid", "-//Sandbox Hotel//Front Desk Board//EN")
    calendar.add("version", "2.0")
    calendar.add("calscale", "GREGORIAN")
    calendar.add("x-wr-timezone", calendar_timezone_name())
    calendar.add("x-wr-calname", _truncate(calendar_name.strip() or "Front desk board", 120))
    for block in blocks:
        calendar.add_component(_front_desk_block_event(block))
    return calendar.to_ical()


def stage_ical_import(payload: bytes, *, known_uids: set[str] | None = None) -> dict[str, Any]:
    known_uids = {item for item in (known_uids or set()) if item}
    report = {
        "timezone_name": calendar_timezone_name(),
        "parsed_events": [],
        "accepted_events": [],
        "rejected_events": [],
        "duplicate_uid_issues": [],
        "missing_fields": [],
        "timezone_issues": [],
        "invalid_dates": [],
    }
    try:
        calendar = Calendar.from_ical(payload)
    except Exception as exc:  # noqa: BLE001
        report["rejected_events"].append(
            {
                "uid": None,
                "summary": None,
                "reason": f"Invalid iCalendar payload: {exc}",
            }
        )
        report["summary"] = {
            "parsed_count": 0,
            "accepted_count": 0,
            "rejected_count": 1,
            "duplicate_uid_count": 0,
        }
        return report

    seen_uids: Counter[str] = Counter()
    for index, component in enumerate(calendar.walk("VEVENT"), start=1):
        raw_uid = str(component.get("UID") or "").strip()
        summary = _truncate(str(component.get("SUMMARY") or "").strip(), 255) or None
        missing_fields: list[str] = []
        if not raw_uid:
            missing_fields.append("UID")
        if component.get("DTSTART") is None:
            missing_fields.append("DTSTART")
        if component.get("DTEND") is None:
            missing_fields.append("DTEND")

        timezone_issue = _component_timezone_issue(component)
        parsed_event: dict[str, Any] = {
            "index": index,
            "uid": raw_uid or None,
            "summary": summary,
            "status": str(component.get("STATUS") or "").strip().upper() or None,
            "categories": _component_categories(component),
            "x_properties": _component_x_properties(component),
            "sequence": _component_sequence(component),
        }

        try:
            starts_on, ends_on = _component_dates(component, normalize_invalid_end=False)
        except Exception as exc:  # noqa: BLE001
            parsed_event["reason"] = f"Unable to parse event dates: {exc}"
            report["rejected_events"].append(parsed_event)
            continue

        parsed_event["starts_on"] = starts_on.isoformat()
        parsed_event["ends_on"] = ends_on.isoformat()
        uid = raw_uid or _event_fallback_uid(component, starts_on, ends_on)
        parsed_event["uid"] = uid

        if missing_fields:
            report["missing_fields"].append(
                {
                    "uid": uid,
                    "summary": summary,
                    "fields": missing_fields,
                }
            )

        if timezone_issue:
            report["timezone_issues"].append(
                {
                    "uid": uid,
                    "summary": summary,
                    "issue": timezone_issue,
                }
            )

        if starts_on >= ends_on:
            parsed_event["reason"] = "DTEND must be after DTSTART."
            report["invalid_dates"].append({"uid": uid, "summary": summary})
            report["rejected_events"].append(parsed_event)
            continue

        seen_uids[uid] += 1
        if seen_uids[uid] > 1:
            parsed_event["reason"] = "Duplicate UID appears multiple times in this payload."
            report["duplicate_uid_issues"].append({"uid": uid, "scope": "payload"})
            report["rejected_events"].append(parsed_event)
            continue
        if uid in known_uids:
            parsed_event["reason"] = "UID already exists in imported calendar data."
            report["duplicate_uid_issues"].append({"uid": uid, "scope": "existing"})
            report["rejected_events"].append(parsed_event)
            continue

        report["parsed_events"].append(parsed_event)
        report["accepted_events"].append(parsed_event)

    report["summary"] = {
        "parsed_count": len(report["parsed_events"]),
        "accepted_count": len(report["accepted_events"]),
        "rejected_count": len(report["rejected_events"]),
        "duplicate_uid_count": len(report["duplicate_uid_issues"]),
    }
    return report


def normalize_external_feed_url(feed_url: str) -> str:
    candidate = (feed_url or "").strip()
    if not candidate:
        raise ValueError("Calendar feed URL is required.")
    parsed = urllib.parse.urlparse(candidate)
    scheme = parsed.scheme.lower()
    host = (parsed.hostname or "").lower()
    if parsed.username or parsed.password:
        raise ValueError("Calendar feed URLs with embedded credentials are not allowed.")
    testing = bool(current_app.config.get("TESTING"))
    app_env = str(current_app.config.get("APP_ENV") or "development").lower()
    if scheme == "webcal":
        parsed = parsed._replace(scheme="https")
        scheme = "https"
        candidate = urllib.parse.urlunparse(parsed)
    if scheme == "https":
        return candidate
    if scheme == "http" and (testing or (app_env != "production" and host in {"localhost", "127.0.0.1"})):
        return candidate
    if scheme == "file" and testing:
        return candidate
    raise ValueError("External calendar feeds must use HTTPS in normal operation.")


def _apply_sync_events(
    source: ExternalCalendarSource,
    events: list[dict[str, Any]],
    *,
    actor_user_id: uuid.UUID | None,
) -> dict[str, Any]:
    seen_uids: set[str] = set()
    duplicate_count = 0
    upserted_count = 0
    conflict_count = 0
    fetched_count = len(events)
    current_seen_at = utc_now()

    existing_rows = {
        item.external_uid: item
        for item in ExternalCalendarBlock.query.filter_by(source_id=source.id).all()
    }

    for event in events:
        uid = event["external_uid"]
        if uid in seen_uids:
            duplicate_count += 1
            continue
        seen_uids.add(uid)
        row = existing_rows.get(uid)
        if not row:
            row = ExternalCalendarBlock(
                source_id=source.id,
                room_id=source.room_id,
                external_uid=uid,
                created_by_user_id=actor_user_id,
                updated_by_user_id=actor_user_id,
            )
            db.session.add(row)
        row.summary = event["summary"]
        row.starts_on = event["starts_on"]
        row.ends_on = event["ends_on"]
        row.event_created_at = event["event_created_at"]
        row.event_updated_at = event["event_updated_at"]
        row.raw_status = event["raw_status"]
        row.metadata_json = event["metadata_json"]
        row.last_seen_at = current_seen_at
        row.updated_by_user_id = actor_user_id
        conflict_reservation = _conflicting_internal_reservation(source.room_id, row.starts_on, row.ends_on)
        row.is_conflict = conflict_reservation is not None
        row.conflict_reservation_id = conflict_reservation.id if conflict_reservation else None
        row.conflict_reason = (
            f"Overlaps internal reservation {conflict_reservation.reservation_code}"
            if conflict_reservation
            else None
        )
        if row.is_conflict:
            conflict_count += 1
        upserted_count += 1

    released_count = 0
    stale_rows = [
        item
        for uid, item in existing_rows.items()
        if uid not in seen_uids
    ]
    for row in stale_rows:
        db.session.delete(row)
        released_count += 1

    return {
        "fetched_event_count": fetched_count,
        "upserted_block_count": upserted_count,
        "duplicate_event_count": duplicate_count,
        "released_block_count": released_count,
        "conflict_count": conflict_count,
        "uids": sorted(seen_uids),
    }


def _internal_feed_events(feed: CalendarFeed) -> list[Event]:
    query = Reservation.query.options(sa.orm.joinedload(Reservation.assigned_room))
    query = query.filter(Reservation.current_status.in_(tuple(ACTIVE_CALENDAR_RESERVATION_STATUSES)))
    if feed.scope_type == "room":
        query = query.filter(Reservation.assigned_room_id == feed.room_id)
    reservations = query.order_by(Reservation.check_in_date.asc(), Reservation.reservation_code.asc()).all()
    host = _calendar_uid_host()
    events: list[Event] = []
    for reservation in reservations:
        room = reservation.assigned_room
        if not room:
            continue
        event = Event()
        event.add("uid", f"reservation-{reservation.id}-{room.id}@{host}")
        event.add("dtstamp", utc_now())
        event.add("dtstart", reservation.check_in_date)
        event.add("dtend", reservation.check_out_date)
        event.add("summary", _feed_summary(feed, room.room_number, "Reserved"))
        event.add("description", f"Reservation block for room {room.room_number}")
        event.add("status", "CONFIRMED")
        event.add("transp", "OPAQUE")
        events.append(event)
    return events


def _external_block_feed_events(feed: CalendarFeed) -> list[Event]:
    query = ExternalCalendarBlock.query.options(sa.orm.joinedload(ExternalCalendarBlock.room))
    if feed.scope_type == "room":
        query = query.filter(ExternalCalendarBlock.room_id == feed.room_id)
    query = query.filter(
        sa.or_(
            ExternalCalendarBlock.is_conflict.is_(False),
            ExternalCalendarBlock.conflict_reservation_id.is_(None),
        )
    )
    blocks = query.order_by(ExternalCalendarBlock.starts_on.asc(), ExternalCalendarBlock.external_uid.asc()).all()
    host = _calendar_uid_host()
    events: list[Event] = []
    for block in blocks:
        room = block.room
        if not room:
            continue
        event = Event()
        event.add("uid", f"external-{block.source_id}-{block.external_uid}@{host}")
        event.add("dtstamp", block.event_updated_at or block.last_seen_at or utc_now())
        event.add("dtstart", block.starts_on)
        event.add("dtend", block.ends_on)
        event.add("summary", _feed_summary(feed, room.room_number, "Blocked"))
        event.add("description", block.summary or f"External calendar block for room {room.room_number}")
        event.add("status", "CONFIRMED")
        event.add("transp", "OPAQUE")
        events.append(event)
    return events


def _fetch_feed_bytes(source: ExternalCalendarSource) -> bytes:
    target_url = decrypt_secret(source.feed_url_encrypted)
    headers = {"User-Agent": current_app.config.get("ICAL_SYNC_USER_AGENT", "SandboxHotelPMS/1.0")}
    request_row = urllib.request.Request(target_url, headers=headers)
    timeout = int(current_app.config.get("ICAL_SYNC_HTTP_TIMEOUT_SECONDS", 15))
    with urllib.request.urlopen(request_row, timeout=timeout) as response:  # noqa: S310
        return response.read()


def _front_desk_block_event(block: dict[str, Any]) -> Event:
    event = Event()
    metadata = block.get("metadata") or {}
    room_number = metadata.get("roomNumber")
    room_type_code = metadata.get("roomTypeCode")
    event.add("uid", _front_desk_block_uid(block))
    event.add("dtstamp", _coerce_event_timestamp(metadata.get("updatedAt")) or utc_now())
    event.add("dtstart", _coerce_event_date(block.get("startDate")))
    event.add("dtend", _coerce_event_date(block.get("endDateExclusive")))
    event.add("summary", _front_desk_block_summary(block))
    event.add("description", _front_desk_block_description(block))
    event.add("status", _front_desk_block_status(block))
    event.add("location", _front_desk_block_location(block))
    event.add(
        "categories",
        [item for item in [block.get("sourceType"), block.get("status"), room_type_code] if item],
    )
    event.add("last-modified", _coerce_event_timestamp(metadata.get("updatedAt")) or utc_now())
    event.add("sequence", int(metadata.get("sequence") or 0))
    event.add("transp", "OPAQUE")
    if block.get("reservationId"):
        event.add("x-reservation-id", str(block["reservationId"]))
    if block.get("roomId"):
        event.add("x-room-id", str(block["roomId"]))
    if block.get("roomTypeId"):
        event.add("x-room-type-id", str(block["roomTypeId"]))
    event.add("x-block-type", str(block.get("sourceType") or "unknown"))
    if block.get("status"):
        event.add("x-pms-status", str(block["status"]))
    if room_number:
        event.add("x-room-number", _truncate(str(room_number), 32))
    return event


def _front_desk_block_uid(block: dict[str, Any]) -> str:
    metadata = block.get("metadata") or {}
    source_type = str(block.get("sourceType") or "block")
    source_id = (
        metadata.get("externalUid")
        or block.get("sourceId")
        or block.get("reservationId")
        or block.get("overrideId")
        or block.get("id")
    )
    return f"{source_type}-{source_id}@{_calendar_uid_host()}"


def _front_desk_block_summary(block: dict[str, Any]) -> str:
    source_type = block.get("sourceType")
    room_number = (block.get("metadata") or {}).get("roomNumber")
    if source_type == "reservation":
        guest_name = block.get("guestName") or block.get("label") or "Reservation"
        if room_number:
            return _truncate(f"{guest_name} - Room {room_number}", 255)
        return _truncate(str(guest_name), 255)
    if source_type == "closure":
        return _truncate(str(block.get("label") or "Room closure"), 255)
    if source_type == "maintenance":
        return _truncate(str(block.get("label") or "Maintenance"), 255)
    if source_type == "hold":
        return _truncate(str(block.get("label") or "Reservation hold"), 255)
    return _truncate(str(block.get("label") or "Planning block"), 255)


def _front_desk_block_description(block: dict[str, Any]) -> str:
    metadata = block.get("metadata") or {}
    description_parts = [
        block.get("subtitle"),
        metadata.get("reservationCode"),
        metadata.get("reason"),
    ]
    return _truncate(" | ".join(str(part).strip() for part in description_parts if part), 1024) or "Planning board event"


def _front_desk_block_location(block: dict[str, Any]) -> str:
    metadata = block.get("metadata") or {}
    room_number = metadata.get("roomNumber")
    room_type_code = metadata.get("roomTypeCode")
    if room_number:
        return _truncate(f"Room {room_number}", 255)
    if room_type_code:
        return _truncate(f"Unallocated - {room_type_code}", 255)
    return "Unallocated"


def _front_desk_block_status(block: dict[str, Any]) -> str:
    status = str(block.get("status") or "").strip().lower()
    if status in {"tentative", "pending"}:
        return "TENTATIVE"
    if status in {"cancelled"}:
        return "CANCELLED"
    return "CONFIRMED"


def _component_dates(component, *, normalize_invalid_end: bool = True) -> tuple[date, date]:
    tz = calendar_timezone()
    starts_on = _coerce_component_date(component.decoded("DTSTART"), tz, is_end=False)
    dtend_raw = component.get("DTEND")
    if dtend_raw is not None:
        ends_on = _coerce_component_date(component.decoded("DTEND"), tz, is_end=True)
    else:
        ends_on = starts_on + timedelta(days=1)
    if normalize_invalid_end and ends_on <= starts_on:
        ends_on = starts_on + timedelta(days=1)
    return starts_on, ends_on


def _coerce_component_date(value: Any, tz: ZoneInfo, *, is_end: bool) -> date:
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    if not isinstance(value, datetime):
        raise ValueError("Unsupported calendar date value.")
    if value.tzinfo is None:
        localized = value.replace(tzinfo=tz)
    else:
        localized = value.astimezone(tz)
    if is_end and localized.timetz() == time(0, 0, tzinfo=localized.tzinfo):
        return localized.date()
    return localized.date()


def _component_timestamp(value: Any | None) -> datetime | None:
    if value is None:
        return None
    decoded = getattr(value, "dt", None)
    if decoded is not None and decoded is not value:
        return _component_timestamp(decoded)
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)
    if isinstance(value, str):
        candidate = value.strip()
        if not candidate:
            return None
        if candidate.endswith("Z"):
            candidate = f"{candidate[:-1]}+00:00"
        try:
            parsed = datetime.fromisoformat(candidate)
        except ValueError:
            try:
                parsed = datetime.strptime(value.strip(), "%Y%m%dT%H%M%S%z")
            except ValueError:
                return None
        return _component_timestamp(parsed)
    serialized = value.to_ical() if hasattr(value, "to_ical") else None
    if isinstance(serialized, bytes):
        return _component_timestamp(serialized.decode("utf-8", errors="ignore"))
    return None


def _coerce_event_date(value: Any) -> date:
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    if isinstance(value, str):
        return date.fromisoformat(value)
    raise ValueError("Unsupported front desk event date value.")


def _coerce_event_timestamp(value: Any | None) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return _component_timestamp(value)
    if isinstance(value, str):
        try:
            parsed = datetime.fromisoformat(value)
        except ValueError:
            return None
        return _component_timestamp(parsed)
    return None


def _component_categories(component) -> list[str]:
    raw = component.get("CATEGORIES")
    if raw is None:
        return []
    values: list[Any] = []
    queue = list(raw) if isinstance(raw, (list, tuple)) else [raw]
    while queue:
        item = queue.pop(0)
        nested_values = getattr(item, "cats", None)
        if nested_values:
            queue[:0] = list(nested_values)
            continue
        serialized = item.to_ical() if hasattr(item, "to_ical") else str(item)
        if isinstance(serialized, bytes):
            serialized = serialized.decode("utf-8", errors="ignore")
        values.extend(str(serialized).split(","))
    return [_truncate(str(item).strip(), 80) for item in values if str(item).strip()]


def _component_x_properties(component) -> dict[str, str]:
    properties: dict[str, str] = {}
    for key in component.keys():
        upper_key = str(key).upper()
        if not upper_key.startswith("X-"):
            continue
        properties[upper_key] = _truncate(str(component.get(key) or "").strip(), 255)
    return properties


def _component_sequence(component) -> int | None:
    value = component.get("SEQUENCE")
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _component_timezone_issue(component) -> str | None:
    issues: list[str] = []
    hotel_tz = calendar_timezone_name()
    for field in ("DTSTART", "DTEND"):
        property_value = component.get(field)
        if property_value is None:
            continue
        decoded = component.decoded(field)
        tzid = property_value.params.get("TZID") if getattr(property_value, "params", None) else None
        if isinstance(decoded, datetime) and decoded.tzinfo is None and not tzid:
            issues.append(f"{field} is timezone-naive.")
        elif tzid and str(tzid) != hotel_tz:
            issues.append(f"{field} uses {tzid} instead of {hotel_tz}.")
    if not issues:
        return None
    return " ".join(issues)


def _conflicting_internal_reservation(room_id: uuid.UUID, starts_on: date, ends_on: date) -> Reservation | None:
    return (
        Reservation.query.filter(
            Reservation.assigned_room_id == room_id,
            Reservation.current_status.in_(tuple(ACTIVE_CALENDAR_RESERVATION_STATUSES)),
            Reservation.check_in_date < ends_on,
            Reservation.check_out_date > starts_on,
        )
        .order_by(Reservation.check_in_date.asc(), Reservation.booked_at.asc())
        .first()
    )


def _validate_scope(scope_type: str, room_id: uuid.UUID | None) -> None:
    if scope_type not in {"property", "room"}:
        raise ValueError("Unsupported calendar feed scope.")
    if scope_type == "property" and room_id is not None:
        raise ValueError("Property feeds cannot target a room.")
    if scope_type == "room" and room_id is None:
        raise ValueError("Room feeds require a room.")


def _find_existing_feed(*, scope_type: str, room_id: uuid.UUID | None) -> CalendarFeed | None:
    query = CalendarFeed.query.filter_by(scope_type=scope_type)
    if scope_type == "property":
        query = query.filter(CalendarFeed.room_id.is_(None))
    else:
        query = query.filter(CalendarFeed.room_id == room_id)
    return query.order_by(CalendarFeed.created_at.desc()).first()


def _default_feed_name(scope_type: str, room: Room | None) -> str:
    hotel_name = str(get_setting_value("hotel.name", current_app.config.get("HOTEL_NAME", "Sandbox Hotel")))
    if scope_type == "room" and room:
        return f"{hotel_name} room {room.room_number}"
    return f"{hotel_name} availability"


def _token_hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _token_hint(value: str) -> str:
    return value[-6:]


def _feed_url_hint(value: str) -> str:
    parsed = urllib.parse.urlparse(value)
    host = parsed.netloc or parsed.path
    return _truncate(host, 255)


def _external_reference(value: str) -> str | None:
    parsed = urllib.parse.urlparse(value)
    host = (parsed.hostname or "").strip()
    return host or None


def _event_fallback_uid(component, starts_on: date, ends_on: date) -> str:
    seed = "|".join(
        [
            str(component.get("SUMMARY") or ""),
            starts_on.isoformat(),
            ends_on.isoformat(),
        ]
    )
    return hashlib.sha256(seed.encode("utf-8")).hexdigest()


def _serialize_feed(feed: CalendarFeed) -> dict[str, Any]:
    room = feed.room
    return {
        "id": feed.id,
        "scope_type": feed.scope_type,
        "name": feed.name,
        "room_id": feed.room_id,
        "room_number": room.room_number if room else None,
        "token_hint": feed.token_hint,
        "is_active": feed.is_active,
        "last_accessed_at": feed.last_accessed_at,
        "last_rotated_at": feed.last_rotated_at,
        "export_url": calendar_feed_export_url(feed),
    }


def _serialize_source(
    source: ExternalCalendarSource,
    *,
    conflict_count: int,
    latest_run: ExternalCalendarSyncRun | None,
) -> dict[str, Any]:
    return {
        "id": source.id,
        "name": source.name,
        "room_id": source.room_id,
        "room_number": source.room.room_number if source.room else None,
        "feed_url_hint": source.feed_url_hint,
        "external_reference": source.external_reference,
        "is_active": source.is_active,
        "last_synced_at": source.last_synced_at,
        "last_successful_sync_at": source.last_successful_sync_at,
        "last_status": source.last_status,
        "last_error": source.last_error,
        "conflict_count": conflict_count,
        "latest_run": _serialize_sync_run(latest_run),
    }


def _serialize_conflict(block: ExternalCalendarBlock) -> dict[str, Any]:
    return {
        "id": block.id,
        "room_number": block.room.room_number if block.room else None,
        "starts_on": block.starts_on,
        "ends_on": block.ends_on,
        "summary": block.summary,
        "last_seen_at": block.last_seen_at,
        "conflict_reason": block.conflict_reason,
        "reservation_code": block.conflict_reservation.reservation_code if block.conflict_reservation else None,
    }


def _serialize_sync_run(run: ExternalCalendarSyncRun | None) -> dict[str, Any] | None:
    if not run:
        return None
    return {
        "id": run.id,
        "status": run.status,
        "started_at": run.started_at,
        "finished_at": run.finished_at,
        "fetched_event_count": run.fetched_event_count,
        "upserted_block_count": run.upserted_block_count,
        "duplicate_event_count": run.duplicate_event_count,
        "released_block_count": run.released_block_count,
        "conflict_count": run.conflict_count,
        "error_message": run.error_message,
    }


def _calendar_uid_host() -> str:
    raw = str(current_app.config.get("APP_BASE_URL") or "sandboxhotel.local")
    parsed = urllib.parse.urlparse(raw if "://" in raw else f"https://{raw}")
    return parsed.hostname or "sandboxhotel.local"


def _feed_summary(feed: CalendarFeed, room_number: str, label: str) -> str:
    if feed.scope_type == "property":
        return f"{label} - Room {room_number}"
    return label


def _truncate(value: str | None, limit: int) -> str | None:
    candidate = (value or "").strip()
    if not candidate:
        return None
    return candidate[:limit]
