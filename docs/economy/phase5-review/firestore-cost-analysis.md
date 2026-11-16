# Firestore usage reduction and remaining limits

2026-11-16. This is an economy-path analysis, not a claim of total project billing usage. Knowledge Lab/City/Camellia product code is unchanged. No Billing change.

## Root load and correction

Old empty worker: every30s one indexed live-job existence query, three fresh readiness documents, two health writes. Minimum11,520 document reads/day and5,760 health writes/day per backend instance, plus hourly cleanup and all app/user traffic. Completed history was already excluded.

New background worker: durable HTTP submission wakes immediately (including awaiting payment confirmation). Busy cycles coalesce one wake, identical job replays do not multiply wakes. Empty queue watchdog backs off60/120/240/300s. Fresh readiness plus health remains once/minute, 90s health validity unchanged, active recovery remains30s. Restart starts a scan immediately; lost/other-instance wake recovery is bounded by5min. Quota failure closes intake and waits60/120/240/300s with no additional DB requests during that wait. Public status is memory-only. No new listener, queue product, scheduled cloud service or paid infrastructure.

24h fake-clock experiment: **290 queue scans,1,440 readiness refreshes →4,610 minimum reads;1,730 health writes**. About60% fewer empty reads and70% fewer health writes. Startup, indexed hourly retention cleanup, paid jobs, real identity/permission/source queries, index-entry billing, transaction retries and other app traffic are excluded. Per-instance totals multiply across instances.

`worker.activity` exposes process-local queueScans/readinessRefreshes/wakeups/nextQueueCheckInMs. `errorStage` is a fixed queue_health/queue/heartbeat/readiness/cleanup label; no private IDs/errors. Counts reset on restart and are not an authoritative Firestore billing meter. Quote/payment/work still independently read current permissions and safety; no stale entitlement cache was added to save reads.

## Payment paths

Reproduce locally: `node tools/economy-tests/read-cost-profile.cjs`. The script exclusively uses the fake fixture and never connects to production.

| Path | Minimum document reads | Write requests | Queries |
| --- | ---: | ---: | ---: |
| quote | 7 | 2 | 0 |
| payment submission | 37 | 11 | 1 |
| generation/settlement cycle including first cleanup | 57 | 13 | 12 |
| own history, one completed result | 2 | 0 | 1 |
| same request key replay | 3 | 0 | 0 |
| 100 public status requests | 0 | 0 | 0 |

These are lower-bound fixture operations, not real project costs. Real source adapters and identity/entitlement reads are explicitly absent from this fixture. Security/financial rereads were retained deliberately. Queries for history/active states/expiry are bounded; no completed-history sweep was introduced. Frontend progress polls only owned active jobs, for at most3min; the 1s identity comparison does no DB read unless identity changes. Other app listeners/refreshes need separate project-level monitoring and are not silently modified here.

## Production original reconciliation

At2026-11-16 15:25 JST, one bounded existing Founder receipt audit succeeded: only four known historical jobs, original5 EMUER debit verified from spent rewards/change, completed job/fulfilled order, original result/artifact hashes unchanged, quote/fingerprint uniqueness1, no active job. New consumption0. No new request, generation, write probe, refund or balance grant. Detailed private identity links remain in memory, not in this report.

The prior transient Google quota errors are real observations; metric/usage/complete cause was not returned by the APIs. Reduced baseline load and a successful snapshot do not guarantee the whole shared free database never reaches quota. Console usage/quotas or authorized project metrics are needed for actual remaining quota. Status and the fixed errorStage let operators separate current health from a historical quota incident. Do not repeatedly audit production or turn Billing on to hide failures.

The actual trial expired2026-11-14 15:48:46.671 JST. Production now correctly reports TRIAL_NOT_ACTIVE with healthy worker and wallet OFF. No deadline was changed. Disabled/expired intake also bypasses the three product/provider readiness reads; explicit later reconfiguration re-reads every gate. Queue/refund processing is never skipped for trial expiry.
