# Staff Alerts

Staff alerts are routed through the internal messaging and notification layers. The implementation lives in:

- `src/lib/alert-routing.ts`
- `src/types/staff-alerts.ts`
- `src/components/settings/StaffAlertSettings.tsx`

## Operating Rules

Keep throttling enabled for high-volume or recurring alerts. Room-ready, maintenance, payment, and escalation alerts should include enough context for staff action without exposing unnecessary guest data.

For notification architecture, see [NOTIFICATIONS.md](./NOTIFICATIONS.md). For LINE delivery setup, see [LINE-INTEGRATION.md](./LINE-INTEGRATION.md).
