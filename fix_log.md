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

## Fix 2 — repair release-documentation path drift
- **Files changed:**
  - `sandbox_pms_mvp/README.md`
  - `release_audit_report.md`
  - `pr_diff_assessment.md`
  - `deployment_diagnostics.md`
  - `redundancy_cleanup_matrix.md`
  - `validation_report.md`
  - `priority_actions.md`
- **Issue:** Release/audit documentation was incomplete for this task, and `sandbox_pms_mvp/README.md` contained broken markdown links pointing to a contributor's local Windows paths plus duplicated deployment guidance.
- **Root cause:** Repository documentation had accumulated environment-specific link targets and repeated deployment copy instead of sticking to repo-relative references.
- **Exact remedy applied:** Replaced the broken README links with repository-relative links, collapsed the duplicated deployment section into one canonical paragraph, and added the required root-level audit/remediation documents with evidence from CI, validation, and deployment-config inspection.
- **Risk level:** Low
- **Regression risk notes:** Documentation-only change; no runtime behavior or deployment configuration was altered.
