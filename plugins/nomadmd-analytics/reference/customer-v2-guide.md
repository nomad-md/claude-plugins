# Segment v2 for Your Brand — What's Changing and What You Get

> Audience: marketplace (brand) operators and their analytics/marketing teams.
> Status: available now (server + browser streams). Your current Segment integration keeps working
> unchanged throughout — v2 is additive until you choose to switch over.

## The short version

Today, NomadMD sends ~9 appointment-status events to your Segment workspace. The v2
integration replaces that with a full analytics stream: **the complete booking funnel,
revenue and refund accounting, membership and package activity, and provider/operations
metrics** — ~40 server-side events plus an on-site browser funnel stream (~23 events),
each on its own **new, separate source** in your workspace, so nothing you've
built breaks while you evaluate it. The complete event-by-event schema, with payload
examples, is in the [v2 Event & Schema Reference](segment-v2-event-reference.md); if
you're on the legacy integration today, start with the
[migration guide](legacy-to-v2-migration.md).

## What you'll be able to answer that you can't today

- **Conversion:** where do customers drop off — service selection, scheduling, payment?
  New vs. returning split, promo code performance, booking lead times.
- **Revenue:** booked vs. collected, refunds and adjustments as a proper ledger,
  membership and package revenue, travel fees — reconcilable line by line.
- **Retention:** repeat rate, membership starts/renewals/cancellations with reasons,
  package credit usage and remaining balances.
- **Operations:** offer-to-acceptance rates per nurse, time-to-accept, no-shows,
  provider coverage and utilization in your market.
- **Attribution:** which campaigns produce bookings — with ad-platform
  conversions deduplicated between browser and server delivery.

## What changes vs. the legacy events

| | Legacy (unchanged, still flowing) | v2 (new source) |
|---|---|---|
| Customer identity | the patient's **email address** | a stable id (`mu_…`) that survives email changes; email is a profile trait |
| Events | 9, appointment-status only | ~40 across funnel, lifecycle, money, membership, operations |
| `revenue` | equals the order total (includes tip) | **service value + travel fee; excludes tip and tax** — tip is its own field (`gratuity_amount`), the total is `total` |
| Money timing | snapshot on status changes | booked value at order time, kept honest by explicit update/cancel/refund events, plus a payment ledger for cash truth |
| Property naming | mixed camelCase | consistent `snake_case`, one documented dictionary |
| Accounts | none | `group()` calls — your brand and each provider organization, for account-level rollups |

**The two differences your team will notice first:** users in v2 are keyed by stable id
(not email), and `revenue` is defined differently — a v2 revenue chart will not match a
legacy revenue chart, *by design*. Both definitions are documented; pick v2's for new
dashboards.

## What we never send you

- **Only your brand's activity.** If a customer also books with other brands on the
  platform, you never receive that activity or any count/metric that includes it. Every
  derived number (e.g. "new customer", prior appointment counts) is computed within your
  brand only.
- **Clinical minimum.** Events carry codes, counts, booleans, and coarse geography
  (region/postal code) — never clinical notes and never a patient's full address.
  (Chart-note content remains available only via your existing opt-in flag.)
- **Browser pixels get even less.** What your GTM container receives is a separately
  scrubbed stream — see the [dataLayer reference](gtm-datalayer-reference.md). Identity
  and geography never reach it under any configuration.

## Your choices (each is a per-brand setting on your integrations page)

1. **v2 server source** — create a Node.js source in *your* Segment workspace, paste its
   write key into Integrations → Segment → "v2", enable. This starts the new stream.
2. **Browser source** — a second, JS source key for the on-site funnel events; the
   funnel starts flowing when the key is added.
3. **Ad conversions** — enable cloud-mode destinations (Meta CAPI, TikTok
   Events, GA4) in your workspace fed by the v2 source. If you also run browser pixels
   via GTM, configure them to send `event_id = order_id` (GA4: `transaction_id`) so the
   platforms deduplicate the two deliveries. Default conversion payload is value +
   currency + order id — no service/item data.
4. **GTM data tier** — `minimal` (default: value-only signals) or `commerce` (opt-in:
   item names/prices flow to your pixels — appropriate for retail-like catalogs; your
   call, with your counsel). Details in the dataLayer reference.
5. **Consent gating** — your GTM behavior is unchanged by default. If you want the
   dataLayer and GTM container gated on marketing consent, that's a flag.

## Which pieces do you need?

The components are independently optional — enable only what serves your goals:

| Your goal | v2 server source | Browser (JS) source | GTM container |
|---|---|---|---|
| Revenue, retention & ops reporting (warehouse/BI) | ✅ | — | — |
| Funnel & product analytics (drop-off, anonymous→known journeys) | ✅ | ✅ | — |
| Ad conversions (Meta / TikTok / Google) | ✅ + cloud-mode destinations | — | ✅ pixels + funnel signals |
| Dynamic product ads / item-level retargeting | ✅ | — | ✅ with the `commerce` tier |

- The **server source is the foundation** — every configuration includes it.
- The **JS source** is only needed for on-site funnel analytics and anonymous→known
  stitching. Skip it if you only run ads — that also keeps your Segment MTU count to
  customers rather than all site visitors.
- **GTM** is only for third-party pixels. Skip it if you don't run paid.
- **GA4 + Google Ads:** server → Segment's **"Google Analytics 4 Cloud"** destination;
  browser → the GA4 tags in your GTM container; link GA4 to Google Ads and import the
  `purchase` key event. Dedup via `transaction_id` is pre-wired on both paths.

## Migration timeline (no action forces you)

1. **Now → dual-run:** legacy events keep flowing untouched. The v2 source runs in
   parallel. Build/validate new dashboards against v2 at your pace; reconcile via
   `order_id`.
2. **Dashboard migration:** translate legacy charts using the mapping below.
3. **Legacy retirement:** only after you confirm v2 covers you, with notice — your flag,
   not a surprise.

### Legacy → v2 quick map

| Legacy event | v2 equivalent |
|---|---|
| `Appointment Requested` | `Appointment Requested` + `Order Completed` (the conversion) |
| `Appointment Request Pending Approval` | `Appointment Requested` with `requires_approval: true` |
| `Appointment Request Updated` | `Appointment Request Approved` / `Appointment Request Updated` (specific) |
| `Appointment Request Cancelled` / `Fulfilled` | same names, richer properties |
| `Appointment Booked` | `Appointment Booked` (fires once; visit start and resets are their own events) |
| `Appointment Updated` (catch-all) | `Appointment Rescheduled` / `Reassigned` / `Updated` + payment ledger events |
| `Appointment Cancelled` / `Completed` | same names + `Order Cancelled` / payment events for the money |
| *(nothing)* | the entire funnel, membership, package, financial-ledger, and operations catalogs |

## What we'll need from you

- A Segment workspace you control (you likely have one — the legacy source lives there).
- One or two new sources created in it (server; browser if you want the funnel); keys
  pasted into your admin page.
- Decisions on the three flags above (ads, data tier, consent) — defaults are safe.
- A point of contact for the dual-run validation window.
