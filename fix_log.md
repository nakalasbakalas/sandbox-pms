# Fix Log

## Fix 1 — inline redundant notification helper
- **Files changed:**
  - `sandbox_pms_mvp/pms/services/communication_service.py`
  - `sandbox_pms_mvp/pms/services/notification_service.py` (removed)
  - `sandbox_pms_mvp/tests/test_phase11_communications.py`
- **Issue:** An internal-only helper lived in its own module even though only `communication_service.py` used it.
- **Root cause:** The email-outbox delivery logic had been split into a standalone module without any separate consumers, creating unnecessary indirection and one more file to maintain.
- **Exact remedy applied:** Moved the helper into `communication_service.py` as `_deliver_email_outbox_entry`, updated `_dispatch_email()` to call it directly, deleted the unused module, and added a focused regression test that exercises successful email delivery through a fake SMTP transport.
- **Risk level:** Low
- **Regression risk notes:** The helper logic itself was preserved verbatim, and the new regression test verifies that dispatch still marks the outbox row as `sent` and the delivery row as `delivered`.
