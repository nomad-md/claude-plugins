---
name: setup-gtm
description: This skill should be used when the user asks to "set up GTM", "import the GTM container", "configure Tag Manager", "set up pixels" (Meta Pixel, TikTok Pixel, GA4 tags), "connect Google Ads", or needs to verify browser/server conversion dedup. Guides import of the bundled NomadMD GTM container templates (minimal or commerce tier), the 3 ID constants, per-platform unpause, and Preview-mode dedup verification.
---

# Set up the brand's GTM container

Guide the brand through importing the bundled GTM container template, wiring their
platform IDs, and verifying browser↔server conversion dedup. GTM's API requires Google
OAuth, so this skill guides the brand through the GTM UI rather than writing via API —
every step below is something the brand does in their own container, with the agent
verifying outcomes.

Prerequisite: the brand's checkout is emitting the Tier-2 dataLayer stream (their
NomadMD integrations page controls it). The `setup-segment-v2` skill covers the
Segment half; this skill is only for third-party pixels.

## 1. Choose the tier

- `${CLAUDE_PLUGIN_ROOT}/reference/gtm-container-template.json` — **minimal** tier
  (default): value-only signals, no catalog data.
- `${CLAUDE_PLUGIN_ROOT}/reference/gtm-container-template.commerce.json` —
  **commerce** tier: adds item-level tags (GA4 `items`, Meta `contents`, TikTok
  `contents`) for dynamic product ads / item-level retargeting.

Choosing commerce is risk **R2** in
`${CLAUDE_PLUGIN_ROOT}/guardrails/risk-register.md` (service-catalog data flows to ad
pixels — counsel-informed choice, especially for healthcare brands). Surface it,
record the acknowledgment in the state file, and proceed with the brand's choice. The
tier must match the marketplace's `gtm_data_tier` setting in NomadMD admin — the
commerce template reads dataLayer fields (`products`, `product_id`, `price`…) that the
minimal tier never pushes.

## 2. Import the template

In the brand's GTM web container: Admin → Import Container → choose the template file
→ select (or create) a workspace → **Merge** (or Overwrite for a fresh container) →
review the change preview → Confirm. All tags in the template arrive **paused** — the
import changes nothing in production.

## 3. Set the 3 ID constants

The template's only required edits are three constant variables:

| Variable | Value |
| --- | --- |
| `GA4 Measurement ID` | `G-XXXXXXX` from GA4 Admin → Data Streams |
| `Meta Pixel ID` | numeric pixel ID from Meta Events Manager |
| `TikTok Pixel ID` | pixel code from TikTok Events Manager |

Leave a platform's constant placeholder if the brand doesn't run that platform — its
tags stay paused.

## 4. Unpause per platform

Unpause only the tag groups for platforms the brand runs (tags are named
`GA4 - *`, `Meta - *`, `TikTok - *`). For each platform: base/config tag first
(`GA4 - Google tag (config)`, `Meta - base pixel`, `TikTok - base pixel`), then the
event tags. Any ad-pixel activation for a healthcare brand requires the one-time
**R4** acknowledgment (healthcare enforcement context) if not already recorded.

## 5. Verify dedup in Preview mode

Before publishing, run GTM Preview against the brand's checkout and walk a test
booking. On the `Order Completed` dataLayer event, confirm:

- `DLV - event_id` and `DLV - order_id` resolve (both carry the order id — this is the
  dedup key).
- `Meta - Purchase (event_id dedup)` fires with `event_id` set — must equal the
  `event_id` the server sends via Meta CAPI for the same order.
- `TikTok - CompletePayment (event_id dedup)` fires with `event_id` set.
- `GA4 - purchase` fires with `transaction_id` set — GA4 dedups against the
  server-side Measurement Protocol hit ("Google Analytics 4 Cloud" destination) on
  `transaction_id`.
- `value` and `currency` resolve on all purchase tags. The dataLayer `value` is v2
  `revenue` — if the server-side destination maps value from anything else (e.g.
  `total`), the platforms see mismatched values for the same event id; flag it and fix
  the Segment destination mapping (see `setup-segment-v2` step 3c).

Then publish the workspace, and record `gtm_dedup_verified_at` in the state file.
Verify events arrive in each platform (Meta Events Manager shows "Deduplicated" on
browser+server pairs; GA4 DebugView shows one purchase).

## 6. GA4 ↔ Google Ads

Google Ads conversions come via GA4 key-event import, not a separate Ads pixel: link
GA4 to the brand's Ads account (GA4 Admin → Product links → Google Ads), mark
`purchase` as a key event, then in Google Ads: Goals → Conversions → Import → GA4 →
`purchase`. Dedup is inherited from GA4's `transaction_id` handling — nothing extra to
wire.

## Consent gating

If the brand wants the dataLayer + GTM gated on marketing consent, that is a
marketplace flag (`gtm_requires_consent`) on the NomadMD side, plus the cross-domain
consent token if their marketing site collects the consent —
`${CLAUDE_PLUGIN_ROOT}/reference/consent-token-spec.md`. Note the asymmetry recorded
as risk **R3**: this gate covers the GTM path, not server-side cloud destinations.

## Reference material

- `${CLAUDE_PLUGIN_ROOT}/reference/gtm-datalayer-reference.md` — every dataLayer
  event/field per tier, dedup design, and what is never in the dataLayer.
- `${CLAUDE_PLUGIN_ROOT}/reference/customer-v2-guide.md` — where GTM fits in the
  brand's overall choices.
