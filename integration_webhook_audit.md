# Integration and Webhook Audit

| Webhook / integration name | Endpoint / source | Auth / signature verification status | Retry / idempotency status | Failure handling status | Logging status | Risks | Fixes made |
|---|---|---|---|---|---|---|---|
| Hosted payment provider webhook | `/webhooks/payments/<provider_name>` in `sandbox_pms_mvp/pms/app.py`; processing in `sandbox_pms_mvp/pms/services/payment_integration_service.py` | Route exists and delegates to provider-specific processing. Payment architecture is present and intended for authenticated provider callbacks. | Designed for idempotent processing through provider event tracking, but remains a high-risk path because duplicate delivery and concurrency behavior are financially sensitive. | Centralized service processing reduces drift, but this path still needs careful live-provider validation. | Payment events and audit-style records exist in the service layer. | Duplicate provider delivery, ordering assumptions, and live-provider credential misconfiguration remain material production risks until validated against a real provider. | No direct code change in this pass |
| Hosted payment checkout / return flow | Public payment handoff routes in `sandbox_pms_mvp/pms/app.py`; provider adapter logic in `payment_integration_service.py` | Configuration-aware payment provider selection exists. | Request reuse and state transitions exist, but production safety still depends on provider-side behavior and webhook confirmation. | Guest-facing return flow is present; operational follow-through relies on webhook state updates. | Existing architecture documents and reconciliation surfaces are present. | Risk of stale payment state if provider callbacks fail or are delayed. | No direct code change in this pass |
| Notification email dispatch | Queue and dispatch logic in `sandbox_pms_mvp/pms/services/communication_service.py` | Internal service flow, not an externally signed webhook. | Uses delivery state tracking and dedupe-oriented keys. | Failed deliveries are represented in queue state. | Delivery history querying exists. | External SMTP/provider behavior still needs live credential validation. | No direct code change in this pass |
| External calendar sync | `sandbox_pms_mvp/pms/services/ical_service.py`; CLI-triggered sync | Pull-based sync, not inbound signed webhook. | Operationally depends on repeated safe sync runs. | Failure visibility depends on CLI execution and logs. | Sync service exists; audit did not perform live external validation. | Invalid feeds, network failures, and duplicate block reconciliation need live-environment validation. | No direct code change in this pass |
| Internal operational notifications | Notification queue/history in `communication_service.py` and staff surfaces | Internal auth boundaries already enforced in staff routes. | Queueing model supports duplicate suppression by dedupe key. | Failed send states are stored. | Query surfaces for notification history are present. | Scheduled-job overlap still needs broader duplicate-run tests. | No direct code change in this pass |

## Audit notes

- Live third-party validation was **not** possible in this environment because no production credentials or provider callbacks were available.
- The most actionable operational issue repaired in this pass was not a webhook bug, but an **RBAC regression** that blocked housekeeping staff from a redacted reservation-detail view needed for operations.
- Before production payment cutover, this repo still needs a dedicated live validation pass for:
  - provider webhook signatures
  - duplicate webhook delivery handling
  - delayed / replayed event handling
  - failed provider callbacks and reconciliation workflow
