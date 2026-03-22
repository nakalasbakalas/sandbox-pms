# Stale Branch Cleanup Checklist

> **Created:** 2026-03-22  
> **Purpose:** Inventory of merged and abandoned branches from prior agent work that are safe to delete after this PR is merged.

The repository accumulated 50+ branches from prior `copilot/`, `claude/`, and `codex/` agent work across 72 merged PRs. These branches serve no ongoing purpose and clutter the remote ref namespace.

---

## 1. Safe-to-delete: confirmed merged branches

All branches below appear in `git log --all` as merged via a merge-commit PR. They can be deleted without losing any work:

```bash
# claude/* branches (3 confirmed merged)
git push origin --delete claude/compact-dashboard-interfaces
git push origin --delete claude/full-repo-audit-and-fix
git push origin --delete claude/redesign-ui-for-density

# codex/* branches (3 confirmed merged)
git push origin --delete codex/launch-hardening-followup
git push origin --delete codex/outstandinservices
git push origin --delete codex/review-and-continue-execution-plan

# copilot/* branches — merged (confirmed via PR history)
git push origin --delete copilot/add-digital-pre-check-in-module
git push origin --delete copilot/add-employee-user-accounts
git push origin --delete copilot/add-employee-user-accounts-again
git push origin --delete copilot/add-employee-user-accounts-another-one
git push origin --delete copilot/add-phase-3-smoke-test-plan
git push origin --delete copilot/audit-and-upgrade-agent-system
git push origin --delete copilot/audit-correctness-and-efficiency
git push origin --delete copilot/audit-debug-fix-new-prs
git push origin --delete copilot/audit-fix-checkin-completion-flow
git push origin --delete copilot/audit-rbac-permissions-structure
git push origin --delete copilot/audit-upgrade-core-reservation-layer
git push origin --delete copilot/check-and-debug
git push origin --delete copilot/create-execution-plan-for-pms
git push origin --delete copilot/disable-quality-gates-workflow
git push origin --delete copilot/fix-deployments
git push origin --delete copilot/fix-deployments-again
git push origin --delete copilot/fix-max-content-length-config
git push origin --delete copilot/full-operational-audit-fix
git push origin --delete copilot/full-release-readiness-recovery
git push origin --delete copilot/full-site-audit-and-refinements
git push origin --delete copilot/improve-check-in-check-out
git push origin --delete copilot/improve-front-desk-board-presentation
git push origin --delete copilot/insert-new-sandbox-hotel-logo
git push origin --delete copilot/refactor-booking-dashboard-again
git push origin --delete copilot/refactor-navbar-header-structure
git push origin --delete copilot/refactor-planning-board-operations
git push origin --delete copilot/refactor-ui-for-responsive-design
git push origin --delete copilot/remove-duplicate-render-config
git push origin --delete copilot/scan-pr-resolve-conflicts
git push origin --delete copilot/sub-pr-63-again
git push origin --delete copilot/sub-pr-67
git push origin --delete copilot/unified-guest-messaging-hub
git push origin --delete copilot/update-codex-guardrails-yml
git push origin --delete copilot/update-layout-to-be-more-compact
git push origin --delete copilot/update-pms-workflow-analysis
git push origin --delete copilot/upgrade-dashboards-and-reports
git push origin --delete copilot/upgrade-front-desk-planning-board
git push origin --delete copilot/upgrade-payment-integration-layer-again
git push origin --delete copilot/upgrade-realtime-housekeeping-sync
git push origin --delete copilot/upgrade-unified-guest-messaging-hub
git push origin --delete copilot/vscode-mmogkcwi-v9b6
git push origin --delete copilot/vscode-mmohtjdh-ipif
git push origin --delete copilot/vscode-mmt34blq-ct9g
git push origin --delete copilot/vscode-mmydsytx-fd97
git push origin --delete copilot/wcag-2-2-fixes-and-upgrades
```

### Bulk delete script

Save as `/tmp/prune-stale-branches.sh` and run once you have confirmed all PRs are merged:

```bash
#!/usr/bin/env bash
# Bulk-delete merged agent branches. Run from repo root after verifying no
# open PRs remain for any branch in this list.
set -euo pipefail

BRANCHES=(
  claude/compact-dashboard-interfaces
  claude/full-repo-audit-and-fix
  claude/redesign-ui-for-density
  codex/launch-hardening-followup
  codex/outstandinservices
  codex/review-and-continue-execution-plan
  copilot/add-digital-pre-check-in-module
  copilot/add-employee-user-accounts
  copilot/add-employee-user-accounts-again
  copilot/add-employee-user-accounts-another-one
  copilot/add-phase-3-smoke-test-plan
  copilot/audit-and-upgrade-agent-system
  copilot/audit-correctness-and-efficiency
  copilot/audit-debug-fix-new-prs
  copilot/audit-fix-checkin-completion-flow
  copilot/audit-rbac-permissions-structure
  copilot/audit-upgrade-core-reservation-layer
  copilot/check-and-debug
  copilot/create-execution-plan-for-pms
  copilot/disable-quality-gates-workflow
  copilot/fix-deployments
  copilot/fix-deployments-again
  copilot/fix-max-content-length-config
  copilot/full-operational-audit-fix
  copilot/full-release-readiness-recovery
  copilot/full-site-audit-and-refinements
  copilot/improve-check-in-check-out
  copilot/improve-front-desk-board-presentation
  copilot/insert-new-sandbox-hotel-logo
  copilot/refactor-booking-dashboard-again
  copilot/refactor-navbar-header-structure
  copilot/refactor-planning-board-operations
  copilot/refactor-ui-for-responsive-design
  copilot/remove-duplicate-render-config
  copilot/scan-pr-resolve-conflicts
  copilot/sub-pr-63-again
  copilot/sub-pr-67
  copilot/unified-guest-messaging-hub
  copilot/update-codex-guardrails-yml
  copilot/update-layout-to-be-more-compact
  copilot/update-pms-workflow-analysis
  copilot/upgrade-dashboards-and-reports
  copilot/upgrade-front-desk-planning-board
  copilot/upgrade-payment-integration-layer-again
  copilot/upgrade-realtime-housekeeping-sync
  copilot/upgrade-unified-guest-messaging-hub
  copilot/vscode-mmogkcwi-v9b6
  copilot/vscode-mmohtjdh-ipif
  copilot/vscode-mmt34blq-ct9g
  copilot/vscode-mmydsytx-fd97
  copilot/wcag-2-2-fixes-and-upgrades
)

for branch in "${BRANCHES[@]}"; do
  if git ls-remote --exit-code --heads origin "$branch" > /dev/null 2>&1; then
    echo "Deleting origin/$branch..."
    git push origin --delete "$branch"
  else
    echo "Already gone: $branch"
  fi
done

echo "Done."
```

---

## 2. Check before deleting — active or uncertain branches

The following branches were open or in-flight at the time this document was written. **Do not delete without confirming the PR is merged or the branch is abandoned:**

| Branch | Reason to check |
|--------|----------------|
| `copilot/update-audit-execution-plan-phase-3` | This is the current PR — delete after merging |

---

## 3. Branches to always keep

| Branch | Reason |
|--------|--------|
| `main` | Production default branch — never delete |

---

## 4. After cleanup

Once all stale branches are deleted, run:

```bash
git fetch --prune origin
git branch -vv | grep ': gone]'
```

The second command lists any local tracking branches that now point to deleted remotes. Remove them with:

```bash
git branch -d <branch-name>
```

---

## 5. Future hygiene

- Merge and delete feature branches within the same PR workflow.
- GitHub's "Delete branch after merging" auto-delete setting (`Settings → General → Automatically delete head branches`) prevents future accumulation.
