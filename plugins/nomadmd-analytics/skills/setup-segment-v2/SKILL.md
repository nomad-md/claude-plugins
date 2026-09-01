---
name: setup-segment-v2
description: This skill should be used when the user asks to "set up Segment", "set up Segment v2", "configure analytics for a brand", "onboard a brand to v2 analytics", "create Segment sources", "import the tracking plan", "enable ad conversions" (Meta CAPI, TikTok Events, GA4), or asks which analytics components a brand needs. Interviews the brand against the decision matrix, then configures their Segment workspace via their own Public API token.
---

# Set up Segment v2 for a brand

Determine which pieces of the NomadMD Segment v2 integration a brand needs, then
configure their Segment workspace using the brand's own Public API token via the
bundled scripts. NomadMD never holds the brand's credentials — the token stays in the
brand's environment (env var or untracked file) and every API call goes through the
pinned, dry-run-capable scripts in `${CLAUDE_PLUGIN_ROOT}/scripts/`.

Read `${CLAUDE_PLUGIN_ROOT}/guardrails/risk-register.md` before the first flagged
configuration comes up, and follow its advise-never-refuse policy: surface risks,
record acknowledgments in the state file, and proceed with what the brand chooses.

## 0. Resume from state

Check for `.claude/nomadmd-analytics.local.md` (schema:
`${CLAUDE_PLUGIN_ROOT}/guardrails/state-file.md`). If present, summarize recorded
progress to the user and continue from the first incomplete milestone instead of
re-interviewing. If absent, create it after the interview concludes.

## 1. Interview — the decision matrix

Ask what the brand wants their analytics to do. Map answers onto the matrix from the
customer guide (`${CLAUDE_PLUGIN_ROOT}/reference/customer-v2-guide.md`, "Which pieces
do you need?"):

| Goal | v2 server source | Browser (JS) source | GTM container |
| --- | --- | --- | --- |
| Revenue, retention & ops reporting (warehouse/BI) | ✅ | — | — |
| Funnel & product analytics (drop-off, anonymous→known) | ✅ | ✅ | — |
| Ad conversions (Meta / TikTok / Google) | ✅ + cloud-mode destinations | — | ✅ pixels + funnel signals |
| Dynamic product ads / item-level retargeting | ✅ | — | ✅ with `commerce` tier |

Points to make while interviewing:

- The **server source is the foundation** — every configuration includes it.
- Skip the JS source if the brand only runs ads — that also keeps their Segment MTU
  count to customers rather than all site visitors.
- GTM is only for third-party pixels; skip it if they don't run paid.
- GA4 + Google Ads: server → the **"Google Analytics 4 Cloud"** destination (that
  catalog entry IS the GA4 Measurement Protocol); browser → GA4 tags in GTM; link GA4
  to Google Ads and import the `purchase` key event.
- If the brand is coming off the legacy integration, plan the migration with the
  `migrate-from-legacy` skill — capture `migrating_from_legacy: true` in state now.

Record `goals`, `components`, `gtm_tier`, and `consent_gating` in the state file.

## 2. Risk review before configuring

Consult the risk register and record acknowledgments for whichever apply:

- Ad destinations on the server source → **R3** (server conversions not
  consent-gated) and **R4** (healthcare enforcement context — required once per brand
  before any ad configuration).
- Brand wants device-mode destinations on the JS source → **R1**; recommend the GTM
  path, but configure device-mode if they acknowledge and insist.
- `commerce` GTM tier → **R2** (handled again in `setup-gtm` if that skill runs the
  import).

Present the draft disclaimer from the risk register with the first acknowledgment and
set `disclaimer_presented_at`.

## 3. Configure — scripts, dry-run first

Token: `SEGMENT_PUBLIC_API_TOKEN` env var or `--token-file <path>`. Never ask the
brand to paste the token into chat; have them export it in the shell that runs the
scripts. Minimal scopes are in the plugin README.

Run each script with `--dry-run` first, show the printed request plan to the user, and
only then run live. All scripts live in `${CLAUDE_PLUGIN_ROOT}/scripts/` and support
`--help`.

**3a. Create sources** (Node.js server source; JS browser source if in scope):

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/segment-setup-sources.js --brand <brand-slug> [--skip-browser] --dry-run
```

The live run prints each source's ID and **write key**. Record IDs and write keys in
the state file (write keys are non-secret). The brand then pastes the keys into
NomadMD admin — Integrations → Segment → "v2" for the server key, the "v2 Browser
Source" field for the JS key. Set `keys_pasted_into_nomadmd_admin` when confirmed.

**3b. Import both Protocols tracking plans** and connect them to the sources:

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/segment-import-plans.js --plan both \
  --server-source-id <id> --browser-source-id <id> --dry-run
```

The plans come from the bundled `${CLAUDE_PLUGIN_ROOT}/reference/` copies (schema
2.2). Re-running replaces the plan rules — safe and idempotent.

**3c. Enable cloud-mode ad destinations** (only the ones in scope):

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/segment-enable-destinations.js \
  --source-id <server-source-id> --enable ga4-cloud,meta-capi,tiktok --dry-run
```

Platform credentials come from env vars (`GA4_MEASUREMENT_ID`, `GA4_API_SECRET`,
`META_PIXEL_ID`, `META_CAPI_ACCESS_TOKEN`, `TIKTOK_PIXEL_CODE`, `TIKTOK_ACCESS_TOKEN`)
— same rule as the Segment token.

**The mapping that must be verified by hand: `value ← properties.revenue`.** Segment's
default suggestion for an event's monetary value can pick `total`; the browser/GTM
path sends `revenue`; if the cloud path sends `total` while the pixel path sends
`revenue`, the platforms see mismatched values for the same `event_id`/
`transaction_id` and conversion dedup breaks. The script sets the mapping explicitly,
but after the live run, open each destination's mapping in the Segment UI and confirm
value/currency read from `properties.revenue` / `properties.currency` and
`event_id` (GA4: `transaction_id`) reads from `properties.order_id`.

## 4. Smoke test

Use the `validate-events` skill as the post-config check: have the brand trigger a
test booking (or use the NomadMD sandbox), copy the resulting events from the Segment
debugger, and validate them against the bundled plan. Passing events + the events
visibly landing in the debugger of the correct source = configured. Record
`smoke_test_passed_at`.

If GTM is in scope, continue with the `setup-gtm` skill.

## Reference material

- `${CLAUDE_PLUGIN_ROOT}/reference/customer-v2-guide.md` — the decision matrix and
  per-brand settings, in customer language.
- `${CLAUDE_PLUGIN_ROOT}/reference/segment-v2-event-reference.md` — the full event
  dictionary (worked example included).
- `${CLAUDE_PLUGIN_ROOT}/reference/tracking-plan.{server,browser}.public.json` — the
  importable Protocols plans (what 3b imports).
- `${CLAUDE_PLUGIN_ROOT}/reference/consent-token-spec.md` — consent-gating behavior
  backing risk R3.
- `${CLAUDE_PLUGIN_ROOT}/guardrails/risk-register.md`,
  `${CLAUDE_PLUGIN_ROOT}/guardrails/state-file.md`.
