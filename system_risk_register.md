# System Risk Register

## Critical

| Risk | Business impact | Production risk |
|---|---|---|
| Payment webhook duplicate or replay handling defects | Can create incorrect deposit/payment state, reconciliation pain, or money loss | High until validated against live provider delivery behavior |

## High

| Risk | Business impact | Production risk |
|---|---|---|
| Reservation/inventory state drift across booking, modification, and room assignment flows | Can oversell rooms or leave staff with incorrect availability | High because booking and operations logic spans multiple shared services |
| RBAC regressions on staff operational surfaces | Can block critical staff workflows or expose data to wrong roles | High; one such regression was reproduced and fixed in this pass |
| Check-in / checkout guard failures | Can cause incorrect room occupancy state or balance handling | High because these routes combine operational and financial side effects |

## Medium

| Risk | Business impact | Production risk |
|---|---|---|
| Scheduled notification / reminder overlap | Can spam guests or produce inconsistent staff follow-up | Medium without broader duplicate-run testing |
| External calendar sync failures | Can leave room blocks stale or missing | Medium until live feeds are exercised and monitored |
| Live-query reporting load or permission drift | Can mislead staff dashboards or cause access confusion | Medium |

## Low

| Risk | Business impact | Production risk |
|---|---|---|
| Documentation drift between architecture docs and code | Slows incident response and maintenance | Low immediate runtime risk, but worth keeping current |

## Implemented mitigation in this pass

- Restored housekeeping access to the reservation detail page while preserving:
  - payment summary restriction
  - mutation endpoint protection
  - template-level action hiding
