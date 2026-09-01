---
name: migrate-from-legacy
description: This skill should be used when the user asks to "migrate from the legacy Segment integration", "move to v2 analytics", "handle the userId change" (email → mu_), "generate crosswalk SQL", "reconcile legacy and v2 events", or plans the dual-run validation window. Covers identity strategies, brand-specific warehouse crosswalk SQL, and the dual-run checklist.
---

# Migrate a brand from the legacy Segment integration to v2

Plan and execute a brand's migration from the legacy 9-event, email-keyed integration
to v2. The platform dual-runs both streams — legacy keeps flowing untouched until the
brand chooses to retire it — so migration is about identity continuity, dashboard
translation, and validation, never a cutover cliff.

The authoritative document is the bundled migration guide
(`${CLAUDE_PLUGIN_ROOT}/reference/legacy-to-v2-migration.md`); this skill operationalizes
it. Record all interview outcomes and milestones in the state file
(`${CLAUDE_PLUGIN_ROOT}/guardrails/state-file.md`).

## 1. Interview

Establish, in this order:

1. **Where does their Segment data land?** Warehouse (which dialect — BigQuery,
   Snowflake, Redshift, Postgres) vs. downstream tools only. Record
   `warehouse_dialect` — it selects the crosswalk SQL template.
2. **What do they have built on legacy?** Dashboards, audiences, attribution models —
   this sizes the translation work and decides how long the dual-run window needs to be.
3. **Do they have an identity-resolution layer?** (Segment Unify/Personas, a CDP, or
   warehouse-native identity.) This picks the identity strategy.

## 2. Identity — the center of gravity

Legacy identified users by **email** as `userId`. v2 uses stable prefixed IDs
(`mu_<id>` for customers). The two userId spaces never overlap, so pick a strategy
(migration guide §3.4–3.6):

- **Strategy A — clean cut** (recommended for most teams): treat v2 as a new keyspace;
  historical continuity lives in the warehouse only where needed.
- **Strategy B — warehouse crosswalk**: join the two keyspaces in SQL. **The crosswalk
  key is `client_profile_id` (v2) ↔ the legacy `clientProfielId` trait.** That legacy
  trait name is an intentional, shipped typo — keep the spelling exactly; do not "fix"
  it, and note that Segment warehouse schemas snake-case it to a `client_profiel_id`
  column (typo preserved). Generate the SQL from
  `references/crosswalk-sql.md` in this skill, adapted to the recorded dialect.
- **Strategy C — profile merging in their identity layer**: feed the crosswalk keys as
  external IDs into their resolution layer (Unify identifier of `client_profile_id`).

Read §3.7 of the migration guide (identity edge cases) with the brand before they
validate — guests, multi-profile accounts, and email changes all behave differently
across the two systems.

## 3. Dashboard translation

Work the legacy → v2 event map (migration guide §4) and property crosswalk (§5).
The two traps that break naive count/revenue comparisons:

- **Legacy `Appointment Booked` fires up to 3× per appointment** (booking, visit
  start re-emit, reset re-emit). v2 fires `Appointment Booked` once, with dedicated
  `Appointment Started` / `Appointment Reset` events. Any dashboard counting legacy
  bookings by event count is overcounting — translate to v2 event count, don't expect
  the numbers to match raw.
- **Money: legacy `revenue` maps to v2 `total`, not v2 `revenue`** (migration guide
  §6). v2 redefines `revenue` (excludes tip/tax; includes travel fee); v2 `total` is
  the charge amount, which is what legacy called `revenue`. Every migrated revenue
  chart must remap `revenue → total` or knowingly adopt the new definition.

## 4. Dual-run validation checklist

During the window where both streams flow (migration guide §7 phases 1–2):

1. Confirm the v2 source receives every expected event for a test booking walked
   end-to-end — validate payloads with the `validate-events` skill (legacy events will
   correctly fail as unknown; only v2 events are in scope).
2. Reconcile order-level money: same order via `order_id`, legacy `revenue` ==
   v2 `total` (not v2 `revenue`).
3. Reconcile counts with the 3×-booking correction applied.
4. If Strategy B: run the crosswalk SQL, check match rate; investigate unmatched rows
   against the §3.7 edge cases before calling them errors.
5. Sign off per-dashboard, not globally; record `dual_run_validated_at` in the state
   file when the brand accepts.

Legacy retirement (phase 4) is the brand's flag, on their timeline, after sign-off.

## Reference material

- `${CLAUDE_PLUGIN_ROOT}/reference/legacy-to-v2-migration.md` — the full guide
  (identity §3, event map §4, property crosswalk §5, money §6, plan §7, FAQ §9).
- `references/crosswalk-sql.md` (this skill) — dialect-specific crosswalk SQL
  templates and the dual-run reconciliation queries.
- `${CLAUDE_PLUGIN_ROOT}/reference/segment-v2-event-reference.md` — v2 event
  dictionary for translation questions.
