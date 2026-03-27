# OTA Integration Architecture

## Overview

The Sandbox Hotel PMS provides a provider-agnostic OTA / channel manager
integration layer.  Real connectivity to Booking.com, Expedia, Agoda, or a
channel-management intermediary can be added by implementing a provider
adapter — no core service rewrites required.

> **Status** — The architecture is live-integration-ready.  Actual provider
> API credentials and provider-specific payload mappings are still required
> before connecting to a real OTA.

---

## Core Components

| Component | Location | Purpose |
|-----------|----------|---------|
| `ChannelProvider` (ABC) | `services/channel_service.py` | Abstract adapter interface |
| `ProviderCapabilities` | `services/channel_service.py` | Declares what a provider supports |
| `ChannelSyncService` | `services/channel_service.py` | Orchestrator for sync operations |
| `OtaChannel` | `models.py` | Per-provider configuration record |
| `OtaSyncLog` | `models.py` | Audit log of every sync operation |
| `OtaRoomTypeMapping` | `models.py` | Internal ↔ external room/rate mappings |
| `admin_channels.html` | `templates/` | Staff OTA control centre |
| Admin route | `routes/admin.py` | `staff_admin_channels` endpoint |

---

## Provider Adapter Contract

Every provider must subclass `ChannelProvider`:

```python
class MyOtaProvider(ChannelProvider):
    @property
    def provider_key(self) -> str:
        return "my_ota"

    @property
    def capabilities(self) -> ProviderCapabilities:
        return ProviderCapabilities(
            supports_reservation_pull=True,
            supports_inventory_push=True,
            supports_rate_push=True,
            supports_restriction_push=True,
            supports_connection_test=True,
            supports_webhooks=False,
            supports_test_mode=True,
            supports_full_refresh=False,
        )

    def pull_reservations(self, since=None): ...
    def push_inventory(self, updates): ...
    def push_rates(self, updates): ...        # optional — default returns unsupported
    def push_restrictions(self, updates): ... # optional — default returns unsupported
    def test_connection(self) -> bool: ...
    def validate_connection(self) -> dict: ... # optional — wraps test_connection
```

Register in `PROVIDER_REGISTRY`:

```python
PROVIDER_REGISTRY["my_ota"] = MyOtaProvider
```

Add the key to `OTA_PROVIDER_KEYS` in `constants.py` and update the
`OtaChannel.provider_key` CHECK constraint migration.

---

## Data Transfer Objects

| DTO | Direction | Purpose |
|-----|-----------|---------|
| `InboundReservation` | Pull | Normalised external booking payload |
| `OutboundInventoryUpdate` | Push | Availability update per room type per date |
| `OutboundRateUpdate` | Push | Rate update per room type / rate plan per date |
| `OutboundRestrictionUpdate` | Push | CTA/CTD, min/max stay, stop-sell per date |
| `SyncResult` | Both | Outcome of any sync operation |
| `ChannelMapping` | Config | Maps internal room type to external code |
| `InboundWebhookEvent` | Inbound | Normalised webhook / event payload |

---

## Sync Model

### Sync Types

| Sync Type | Direction | Description |
|-----------|-----------|-------------|
| Inventory push | Outbound | Available room counts per date |
| Rate push | Outbound | Room rates per rate plan per date |
| Restriction push | Outbound | CTA/CTD, min stay, stop-sell |
| Reservation pull | Inbound | Import new/modified bookings |
| Connection test | — | Validate credentials and endpoint |
| Full refresh | Both | Reconcile all data (future) |

### Sync Direction Flags

Each `OtaChannel` record stores four boolean flags:

- `sync_inventory_push`
- `sync_rate_push`
- `sync_restriction_push`
- `sync_reservation_pull`

These are configured per-channel and gated by `ProviderCapabilities`.

### Sync Lifecycle

Every sync operation writes an `OtaSyncLog` entry with:

- provider_key, direction, action
- status: `success` | `error` | `partial`
- records_processed count
- error_summary (first 2000 chars)
- details_json (structured result data)
- started_at, finished_at, duration_ms

---

## Channel Onboarding Flow

1. **Select provider** — Admin picks from available OTA providers
2. **Enter credentials** — API key, secret, hotel/property ID, endpoint
3. **Test connection** — Validates credentials via provider adapter
4. **Map room types** — Link internal room types to external codes
5. **Configure sync directions** — Enable inventory push, rate push, etc.
6. **Choose environment** — Sandbox (testing) or Live (production)
7. **Activate** — Enable the channel for sync operations

### Readiness Assessment

`assess_channel_readiness()` returns a structured checklist:

| Step | Blocking? | Description |
|------|-----------|-------------|
| Credentials | Yes | API key configured |
| Hotel ID | Yes | Property code set |
| Connection tested | Yes | Last test passed |
| Room mappings | Yes | All room types mapped |
| Sync direction | Yes | At least one enabled |
| Activated | No | Channel set to active |

### Health State Machine

```
not_configured → inactive → unknown → healthy / warning → error
```

- **not_configured**: No credentials saved
- **inactive**: Credentials present but channel disabled
- **unknown**: Active but never tested
- **healthy**: Test passed + all rooms mapped
- **warning**: Test passed + unmapped rooms
- **error**: Last connection test failed

---

## Webhook / Polling Extension Points

### Inbound Webhooks

The system provides `InboundWebhookEvent`, `verify_webhook_signature()`,
and `process_inbound_webhook()` as extension points.

To add webhook support for a provider:

1. Create a route that receives the raw POST body
2. Call `verify_webhook_signature()` with provider-specific logic
3. Normalise the payload into an `InboundWebhookEvent`
4. Pass to `process_inbound_webhook()` which handles logging and routing

Events are deduplicated via `idempotency_key` when provided.

### Polling

Reservation pull is currently polling-based via `ChannelSyncService.import_reservations()`.
A scheduled task or manual trigger can invoke this periodically.

---

## Security

- API credentials stored with hint-only display (`api_key_hint`)
- Credentials never exposed in templates, logs, or client-side state
- `settings.edit` permission required for credential changes
- `settings.view` permission required for dashboard access
- All sync operations create audit log entries
- Environment mode (`sandbox`/`live`) prevents accidental production use

---

## Current Limitations

These require real provider API credentials and specs before implementation:

- **Provider-specific payload formats** — Current push uses a generic JSON
  envelope; real Booking.com/Expedia APIs require provider-specific schemas
- **Real credential encryption** — `api_key_encrypted` stores the raw value;
  Fernet encryption should be applied before production use
- **Webhook signature verification** — Stub implementation; needs provider HMAC keys
- **Automatic sync scheduling** — Manual trigger only; needs task queue (Celery/APScheduler)
- **Rate limiting** — No per-provider rate limiting yet
- **Reservation conflict resolution** — Import pipeline scaffolded but needs
  provider-specific mapping and conflict handling

---

## How to Add a New Provider

1. Create a `ChannelProvider` subclass with appropriate `capabilities`
2. Implement `pull_reservations()`, `push_inventory()`, `test_connection()`
3. Optionally implement `push_rates()`, `push_restrictions()`
4. Register in `PROVIDER_REGISTRY` dict
5. Add provider key to `OTA_PROVIDER_KEYS` in `constants.py`
6. Add display label to `OTA_PROVIDER_LABELS`
7. Create migration to update the `provider_key` CHECK constraint
8. Add provider-specific config fields if needed via `AppSetting`
9. Write tests for the new adapter

---

## Ranked Next Steps

### P0 — Required before connecting a real provider

- Apply Fernet encryption to stored API credentials
- Implement provider-specific payload format for target OTA
- Add real `test_connection()` that validates against provider API
- Set up webhook signature verification for the target provider

### P1 — Strong next implementation step

- Automatic sync scheduling (Celery / APScheduler)
- Reservation import with conflict detection and admin review queue
- Per-provider rate limiting
- Full refresh / reconciliation flow

### P2 — Future enhancement

- Two-way modification sync (PMS changes → OTA updates)
- Channel manager intermediary support (e.g. SiteMinder, RateGain)
- Bulk mapping import/export
- Sync health dashboard with charts and alerting
