# nomadmd-analytics — Claude plugin

Agent-guided Segment v2 / GTM setup for NomadMD brands. Packages the customer-facing
analytics docs corpus (`docs/analytics/`) plus deterministic Segment Public API scripts
into a plugin, so a brand's agent — or NomadMD CS internally — can determine the right
setup for that brand and configure it.

**v1 is internal-only** (CS / onboarding copilot). External distribution is a later
phase, gated on legal review of the disclaimer language (see
[guardrails/risk-register.md](guardrails/risk-register.md)) and published via CI to a
public marketplace repo — never from this directory by hand.

## Skills

| Skill | What it does |
| --- | --- |
| `setup-segment-v2` | Interviews the brand against the decision matrix (server source / JS source / GTM, by goal), then configures Segment via the brand's own Public API token: creates sources, returns write keys, imports both tracking plans, enables cloud-mode ad destinations with correct mappings. |
| `migrate-from-legacy` | Identity strategies for the email → `mu_` userId change, brand-specific warehouse crosswalk SQL, and the dual-run validation checklist. |
| `setup-gtm` | Guides container-template import (minimal vs commerce tier), the 3 ID constants, per-platform unpause, and Preview-mode dedup verification. |
| `validate-events` | Validates pasted Segment-debugger events against the bundled tracking plans. Also used by the other skills as the post-config smoke test and dual-run check. |

## Credentials

- The brand's Segment **Public API token** is supplied via the `SEGMENT_PUBLIC_API_TOKEN`
  environment variable, or an untracked file passed with `--token-file <path>`.
  **Never paste tokens into chat. Never commit them.**
- Minimal token scope: a workspace token restricted to **Source Admin** (create sources,
  read write keys), **Tracking Plan Admin** (Protocols), and **Destination Admin**
  (create/enable destinations). Do not use a Workspace Owner token.
- Ad-platform credentials for destination setup (Meta CAPI access token, TikTok access
  token, GA4 API secret) are likewise env-var only — see
  `scripts/segment-enable-destinations.js --help`.
- All Segment API calls go through the bundled scripts, which are pinned to
  `https://api.segmentapis.com` with no override. Each script has a `--dry-run` mode
  that prints the full request plan without sending anything.

## State file

Skills persist onboarding state (interview answers, chosen tier, source IDs, non-secret
write keys, and **timestamped risk acknowledgments**) in
`.claude/nomadmd-analytics.local.md` in the project where the agent runs. This makes
onboarding resumable across sessions and provides the acknowledgment audit trail.
Add `.claude/*.local.md` to that project's `.gitignore`. Schema:
[guardrails/state-file.md](guardrails/state-file.md).

## Guardrail philosophy

**Advise, never refuse.** Skills never hard-block a configuration the brand chooses.
They surface NomadMD-flagged risks, obtain explicit acknowledgment, record it with a
timestamp in the state file, and proceed. The disclaimer/liability language is DRAFT
until counsel review — legal review is an explicit gate before external distribution.
The risk register, acknowledgment wording, and draft disclaimer live in
[guardrails/risk-register.md](guardrails/risk-register.md).

## `reference/` is generated — do not edit

`reference/` is packaged from the canonical `docs/analytics/` files by
`scripts/analytics-codegen/generate.js` (run `npm run analytics:codegen` in
dispatch-api). The codegen `--check` guard (`analytics:codegen:check` in dispatch-api
and checkout-web CI) verifies the bundled copies are byte-identical to the canonical
files. Only allowlisted customer-facing files are packaged; internal artifacts
(`segment-tracking-plan.md`, `tracking-plan.json`, `implementation-plan.md`,
`datadog-rum-reference.md`) are never bundled — the allowlist lives in `generate.js`.

## Versioning

The plugin version tracks the **shipped** tracking-plan schema: `2.2.x` while schema
2.2 is what production emits. The patch digit is for plugin-only changes. Do not bump
to 2.3 (Payout Sent / Travel Fee Applied `order_id`) until that schema change ships —
it currently lives unshipped on `feat/eng-192-payment-ledger-order-id`. Statements in
the skills that depend on the current build (e.g. "server-side conversions are not
consent-gated") must be re-reviewed on every version bump.

## Install (internal v1)

From a checkout of the monorepo:

```
claude --plugin-dir /path/to/NMD-Local/plugins/nomadmd-analytics
```

or add the directory through your plugin marketplace settings. CS/employees have repo
access; there is no external distribution channel yet.

## Testing

```
cd plugins/nomadmd-analytics
node --test 'tests/*.test.js'
```

Zero dependencies — the tests exercise the scripts' `--dry-run` request plans and the
offline event validator against the bundled plans, using the fixture events in
`tests/fixtures/`.
