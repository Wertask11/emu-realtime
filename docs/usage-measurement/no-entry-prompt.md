# Anonymous measurement without an entry prompt — 2026-11-02

Founder requested removal of the entry-screen analytics permission popup. Camellia-style anonymous measurement now starts without an entry prompt, with the existing minimal event/property allowlist and no content/account/URL collection. Previously stored `emu.analytics.consent.v1=no` remains authoritative; DNT/GPC still suppress delivery. Privacy settings retain stop/restart, and stopping deletes pending events and anonymous identity. Existing contract/pass/award/Rules and the separate device-audit changes from PR #261 are untouched.

Changes: remove prompt creation from `frontend/public/emu-analytics.js`; bind settings only on privacy page; align `privacy.html` with automatic anonymous collection; update analytics unit/browser/live-delivery tests for automatic startup. Earlier explicit-opt-in implementation reports are historical; this document and current privacy page describe current behavior.

Verification: nine analytics tests pass, including prior opt-out/DNT/GPC, strict safe payload, retry/deduplication, persisted approval observation and disabled storage. Syntax/JSON/IDs/local links pass. Actual local browser at 375/390/412/768/1280 verifies no popup, feed events and stop behavior. Actual PostHog accepts four internal-only events with HTTP200/status Ok; no production user data is written.

## Where Founder views results

Open https://us.posthog.com/ using an account with access to the project already used by Camellia. In Activity / event list, filter `service = emu_for_schoolpark`. For real Production usage, also filter `environment = production` and `traffic_type = user`; this excludes Camellia and internal tests. Events such as `knowledge_list_view`, `post_publish` and `knowledge_lab_search` can then be used for trends/funnels. A project-specific dashboard URL/permissions and configured funnel have not been independently verified by this executor.

The app privacy page is for stopping/restarting measurement; it does not display operator analytics. Do not confuse https://us.i.posthog.com/ (ingestion) with https://us.posthog.com/ (dashboard).
