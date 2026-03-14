# Redundancy Matrix

| Item | Type | Status | Decision | Reasoning |
| --- | --- | --- | --- | --- |
| `sandbox_pms_mvp/pms/services/notification_service.py` | Duplicate/internal-only helper module | Verified | Removed | It contained a single helper and the only in-repo consumer was `communication_service.py`. |
| SMTP send logic in `communication_service.py` and `messaging_service.py` | Duplicate logic candidate | Observed | Deferred | The code paths belong to different messaging systems; safe consolidation needs subsystem review beyond this audit pass. |
| Route-only template reachability results | Dead-code candidate | Inconclusive | Retained | Simple scans do not prove templates or partials are unused, so deletion would be unsafe. |
| Broad `except Exception` blocks across app/services | Maintainability duplication/fragility | Observed | Deferred | Widespread pattern, but narrowing them safely requires subsystem-specific analysis. |
