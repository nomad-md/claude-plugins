# NomadMD-flagged risk register

Policy: **advise, never refuse.** No skill in this plugin hard-blocks a configuration.
When a brand chooses a flagged configuration, surface the relevant entry below, obtain
explicit acknowledgment, and record it — with a timestamp — in the plugin state file
(`.claude/nomadmd-analytics.local.md`, see [state-file.md](state-file.md)). The
recorded acknowledgment is the audit trail; a chat exchange alone is not sufficient.

Entries marked **current-build-dependent** describe the NomadMD platform as built
today. Re-verify each of them against the platform before every plugin version bump —
they may become stale.

## R1 — Device-mode ad destinations on the Segment JS source

**Trigger:** the brand asks to enable a device-mode (browser-bundled) ad destination —
Meta Pixel, TikTok Pixel, GA4 gtag, etc. — on their Segment JavaScript source.

**Risk:** device-mode destinations receive the **full v2 browser payload, including
catalog data** (service names, categories, prices) on every event they subscribe to.
There is no tier scrubbing on the Segment JS path — tiering exists only on the
GTM/dataLayer path.

**Recommended path:** run browser pixels through the GTM container instead, fed by the
scrubbed Tier-2 dataLayer stream (minimal tier by default). Keep the Segment JS source
cloud-mode only.

**Acknowledgment key:** `device-mode-full-payload`

## R2 — Commerce GTM tier sends catalog data to ad pixels

**Trigger:** the brand selects the `commerce` GTM tier
(`gtm-container-template.commerce.json`) or flips their marketplace `gtm_data_tier` to
`commerce`.

**Risk:** the commerce tier deliberately forwards service-catalog data (item names,
categories, prices) to third-party ad pixels. For healthcare brands especially, service
names can be sensitive; this is a counsel-informed choice, not a default.

**Recommended path:** start on `minimal` (value-only signals); adopt `commerce` only
for retail-like catalogs after the brand's counsel has reviewed what their service
names reveal.

**Acknowledgment key:** `gtm-commerce-catalog`

## R3 — Server-side ad conversions are not consent-gated *(current-build-dependent)*

**Trigger:** the brand enables cloud-mode ad destinations (Meta CAPI, TikTok Events,
GA4 Cloud) on the v2 server source.

**Risk:** per the bundled consent-token spec, the consent gate in the current build
applies to the GTM/dataLayer path. Server-emitted events flow to cloud-mode ad
destinations regardless of the visitor's marketing-consent state. If the brand operates
under a consent regime (GDPR, or their own policy), server-side conversions need
consent handling in their own stack (e.g. destination filters keyed on a consent trait)
until platform-side gating exists.

**Recommended path:** brands with consent obligations should confirm their obligations
cover server-side conversions before enabling, and consider Segment destination filters
as an interim gate.

**Acknowledgment key:** `server-conversions-consent`

## R4 — Healthcare tracking-technology enforcement context

**Trigger:** any ad-pixel or ad-conversion configuration for a brand delivering
healthcare services (most NomadMD brands).

**Risk:** regulators and plaintiffs have been active on tracking technologies in
healthcare — OCR's online-tracking guidance and the Meta-pixel litigation wave against
health systems. The v2 design keeps identity, geo, and clinical data out of the ad
paths by construction, but *what the brand enables* (especially R1/R2 configurations)
changes their exposure. NomadMD provides the tooling; the brand's counsel owns the
judgment.

**Recommended path:** share this entry with the brand's counsel whenever ads are in
scope. This acknowledgment is required once per brand before any ad destination or
pixel is enabled through this plugin.

**Acknowledgment key:** `healthcare-enforcement-context`

## Recording an acknowledgment

Append an entry to the `acknowledgments` list in the state-file frontmatter at the
moment the brand confirms — not at the end of the session:

```yaml
acknowledgments:
  - risk: gtm-commerce-catalog
    acknowledged_by: "Dana Smith, Head of Growth, Acme Wellness"
    channel: "live session with NomadMD CS"
    at: "2026-07-12T21:14:00Z"
    note: "Counsel reviewed service-name list 2026-07-01; approved commerce tier."
```

`acknowledged_by` must name a person and role at the brand, not just "the brand".
Record the acknowledgment even when the brand chooses the recommended path after
hearing the risk — decline entries use `declined: true` and document that the risky
configuration was *not* enabled.

## Disclaimer language — DRAFT, pending counsel review

> **DRAFT — not yet reviewed by counsel. Do not distribute externally, and do not
> present as a binding agreement, until legal sign-off. External distribution of this
> plugin is gated on that review.**
>
> The configurations described and applied by this tool are selected by you, the
> brand. NomadMD flags known risks and recommends conservative defaults, but you are
> responsible for the configurations you choose, including their compliance with laws
> and regulations applicable to your business (privacy, advertising, and
> health-information rules among them). By acknowledging a flagged risk and directing
> the configuration to proceed, you accept responsibility for that configuration and
> release NomadMD from liability arising from it. NomadMD does not provide legal
> advice; consult your counsel.

Skills present this text when the first risk acknowledgment of an engagement is
recorded, and record `disclaimer_presented_at` in the state file.
