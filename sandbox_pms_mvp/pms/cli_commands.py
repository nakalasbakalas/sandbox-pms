"""Flask CLI commands for the PMS application.

These are registered with the app in ``create_app()`` via
``register_cli(app)``.
"""

from __future__ import annotations

from datetime import date, datetime

import click
from flask import Flask

from .audit import cleanup_audit_logs
from .extensions import db
from .seeds import (
    bootstrap_inventory_horizon,
    clear_operational_data,
    seed_all,
    seed_reference_data,
    seed_roles_permissions,
)
from .services.communication_service import (
    dispatch_notification_deliveries,
    send_due_failed_payment_reminders,
    send_due_pre_arrival_reminders,
)
from .services.front_desk_service import auto_cancel_no_shows
from .services.ical_service import sync_all_external_calendar_sources
from .services.messaging_service import process_pending_automations
from .services.pre_checkin_service import fire_pre_checkin_not_completed_events
from .services.reservation_service import expire_stale_waitlist, promote_eligible_waitlist


def register_cli(app: Flask) -> None:
    @app.cli.command("seed-reference-data")
    def seed_reference_data_command() -> None:
        seed_reference_data(sync_existing_roles=False)
        print("Reference data seeded.")

    @app.cli.command("sync-role-permissions")
    def sync_role_permissions_command() -> None:
        seed_roles_permissions(sync_existing_roles=True)
        db.session.commit()
        print("System role permissions synchronized.")

    @app.cli.command("seed-phase2")
    @click.option("--demo-data", is_flag=True, default=False, help="Include demo guests and reservations")
    def seed_phase2_command(demo_data: bool) -> None:
        seed_all(app.config["INVENTORY_BOOTSTRAP_DAYS"], include_demo_data=demo_data)
        print("Phase 2 seed completed." + (" (with demo data)" if demo_data else ""))

    @app.cli.command("bootstrap-inventory")
    def bootstrap_inventory_command() -> None:
        bootstrap_inventory_horizon(date.today(), app.config["INVENTORY_BOOTSTRAP_DAYS"])
        db.session.commit()
        print("Inventory horizon bootstrapped.")

    @app.cli.command("clear-operational-data")
    @click.option("--confirm", is_flag=True, default=False, help="Must pass --confirm to execute the clear.")
    def clear_operational_data_command(confirm: bool) -> None:
        """Remove all guest/booking/folio operational data while preserving accounts and config.

        This is irreversible. Pass --confirm to proceed.
        """
        if not confirm:
            print("ERROR: This command permanently deletes all guest and reservation data.")
            print("Pass --confirm to execute.")
            return
        counts = clear_operational_data()
        removed = sum(v for k, v in counts.items() if not k.endswith("_reset"))
        print(f"Operational data cleared. {removed} rows removed across {len(counts)} tables.")
        for table, count in counts.items():
            if count:
                print(f"  {table}: {count}")

    @app.cli.command("process-notifications")
    def process_notifications_command() -> None:
        result = dispatch_notification_deliveries()
        print(f"Notifications processed: {result}")

    @app.cli.command("send-pre-arrival-reminders")
    def send_pre_arrival_reminders_command() -> None:
        result = send_due_pre_arrival_reminders(actor_user_id=None)
        print(f"Pre-arrival reminders: {result}")

    @app.cli.command("send-failed-payment-reminders")
    def send_failed_payment_reminders_command() -> None:
        result = send_due_failed_payment_reminders(actor_user_id=None)
        print(f"Failed payment reminders: {result}")

    @app.cli.command("fire-pre-checkin-reminders")
    @click.option(
        "--hours-before",
        default=48,
        type=int,
        help="Hours before check-in to target (default: 48).",
    )
    def fire_pre_checkin_reminders_command(hours_before: int) -> None:
        """Fire pre_checkin_not_completed automation events for upcoming arrivals.

        Run daily via cron ~48 hours before check-in day to nudge guests who
        have not submitted (or not started) their digital pre-check-in.
        """
        result = fire_pre_checkin_not_completed_events(hours_before=hours_before)
        print(f"Pre-check-in reminder events: fired={result['fired']}, skipped={result['skipped']}")

    @app.cli.command("sync-ical-sources")
    def sync_ical_sources_command() -> None:
        result = sync_all_external_calendar_sources(actor_user_id=None)
        print(f"iCal sync result: {result}")

    @app.cli.command("process-automation-events")
    def process_automation_events_command() -> None:
        result = process_pending_automations()
        print(
            f"Automation events processed: {result['processed']} sent, "
            f"{result['skipped']} skipped, {result['errors']} errors, "
            f"{result.get('cleaned_up', 0)} cleaned up."
        )

    @app.cli.command("cleanup-audit-logs")
    @click.option(
        "--retention-days",
        default=None,
        type=int,
        help="Delete audit logs older than N days. Defaults to AUDIT_LOG_RETENTION_DAYS.",
    )
    @click.option("--dry-run", is_flag=True, help="Report matching audit-log rows without deleting them.")
    def cleanup_audit_logs_command(retention_days: int | None, dry_run: bool) -> None:
        result = cleanup_audit_logs(retention_days=retention_days, dry_run=dry_run)
        if not result["enabled"]:
            print("Audit log cleanup skipped: AUDIT_LOG_RETENTION_DAYS is not set to a positive value.")
            return
        mode = "would delete" if dry_run else "deleted"
        cutoff_val = result["cutoff"]
        cutoff = cutoff_val.isoformat() if isinstance(cutoff_val, datetime) else "n/a"
        print(
            f"Audit log cleanup: {result['deleted']} rows {mode}, "
            f"retention_days={result['retention_days']}, cutoff={cutoff}"
        )

    @app.cli.command("process-waitlist")
    @click.option("--max-age-days", default=14, type=int, help="Expire waitlist entries older than N days (default: 14).")
    def process_waitlist_command(max_age_days: int) -> None:
        """Promote eligible waitlisted reservations and expire stale ones."""
        promo = promote_eligible_waitlist()
        expiry = expire_stale_waitlist(max_age_days=max_age_days)
        print(
            f"Waitlist: {promo['promoted']} promoted, {promo['skipped']} skipped, "
            f"{expiry['expired']} expired."
        )

    @app.cli.command("auto-cancel-no-shows")
    @click.option("--date", "target_date", default=None, type=click.DateTime(formats=["%Y-%m-%d"]), help="Business date (default: today).")
    def auto_cancel_no_shows_command(target_date: datetime | None) -> None:
        """Auto-cancel same-day no-shows after cutoff hour."""
        biz_date = target_date.date() if target_date else None
        result = auto_cancel_no_shows(business_date=biz_date)
        print(
            f"No-show auto-cancel: {result['processed']} processed, "
            f"{result['skipped']} skipped, {result['errors']} errors."
            + (f" ({result.get('reason', '')})" if result.get("reason") else "")
        )
