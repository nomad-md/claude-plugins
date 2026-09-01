# Plugin state file — `.claude/nomadmd-analytics.local.md`

All four skills read and write one state file in the project where the agent runs:
`.claude/nomadmd-analytics.local.md`. It makes onboarding resumable across sessions and
holds the timestamped risk-acknowledgment audit trail. It must be gitignored
(`.claude/*.local.md`) — it contains brand-specific detail, though never secrets.

**Never store secrets here.** Write keys are publishable identifiers and are fine;
Public API tokens, CAPI/TikTok access tokens, and GA4 API secrets are not — those stay
in env vars or untracked token files.

At the start of any skill run, read this file if it exists and resume from recorded
state instead of re-interviewing. Update it at every milestone (interview complete,
sources created, plans imported, destinations enabled, GTM verified), not only at the
end of a session.

## Template

```markdown
---
brand_name: "Acme Wellness"
brand_slug: acme-wellness
status: in_progress            # in_progress | live | paused
updated_at: "2026-07-12T21:30:00Z"

# Interview outcomes (decision matrix)
goals: [ads, funnel]           # any of: reporting, funnel, ads, retargeting
components:
  server_source: true          # always true — the foundation
  browser_source: true
  gtm_container: true
gtm_tier: minimal              # minimal | commerce
consent_gating: false          # marketplace gtm_requires_consent flag
warehouse_dialect: bigquery    # for migrate-from-legacy crosswalk SQL; null if n/a
migrating_from_legacy: true

# Segment workspace objects (IDs and write keys are non-secret)
segment:
  workspace_slug: acme-wellness
  server_source_id: null
  server_write_key: null
  browser_source_id: null
  browser_write_key: null
  server_plan_id: null
  browser_plan_id: null
  destinations: []             # e.g. [{catalog: ga4-cloud, id: "...", enabled: true}]

# Verification milestones
keys_pasted_into_nomadmd_admin: false
smoke_test_passed_at: null
gtm_dedup_verified_at: null
dual_run_validated_at: null

# Risk acknowledgment audit trail — see guardrails/risk-register.md
disclaimer_presented_at: null
acknowledgments: []
---

# Onboarding notes

Free-form session notes: who was on the call, open questions, links to the brand's
dashboards, anything the next session should know.
```

## Field notes

- `goals` drives the decision matrix in the customer guide ("Which pieces do you
  need?"); `components` is the concluded configuration.
- `acknowledgments` entries follow the exact shape in
  [risk-register.md](risk-register.md#recording-an-acknowledgment): `risk`,
  `acknowledged_by` (person + role), `channel`, `at` (ISO-8601 UTC), optional `note`,
  optional `declined: true`.
- Timestamps are ISO-8601 UTC. `updated_at` is touched on every write.
- When resuming, treat recorded Segment IDs as claims to verify cheaply (a `--dry-run`
  list or a UI check), not gospel — the brand may have changed their workspace between
  sessions.
