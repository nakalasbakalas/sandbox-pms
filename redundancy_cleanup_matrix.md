# Redundancy Cleanup Matrix

| Item | Type | Status | Removed / Retained / Deferred | Reasoning |
| --- | --- | --- | --- | --- |
| Broken Windows-local markdown links in `sandbox_pms_mvp/README.md` | Documentation drift / obsolete path references | Verified | Removed | These links could never resolve correctly for other contributors or on GitHub. |
| Duplicated Render deployment guidance in `sandbox_pms_mvp/README.md` | Duplicate docs content | Verified | Removed | The same deployment message appeared twice with inconsistent link styles, increasing maintenance drift. |
| `sandbox_pms_mvp/pms/services/notification_service.py` | Duplicate/internal-only helper module | Historical prior finding | Removed (pre-existing change) | Already removed in a previous audit after reference tracing confirmed a single consumer. |
| SMTP send logic in `communication_service.py` and `messaging_service.py` | Duplicate logic candidate | Observed | Deferred | Shared extraction would cross subsystem boundaries and was not required for release stabilization. |
| Route-only template reachability scans | Dead-code candidate | Inconclusive | Retained | Template reachability cannot be proven safely from simple static scans alone. |
| Broad `except Exception` patterns in shared routes/services | Maintainability / resilience concern | Observed | Deferred | Narrowing them safely requires deeper subsystem-level analysis. |
