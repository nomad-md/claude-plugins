# Migrating from the Legacy Segment Integration to Segment v2

> **Audience:** analytics, data-engineering, and marketing-ops teams at brands currently
> receiving the legacy 9-event Segment integration who want to move to the v2 schema.
> **Companions:** [Segment v2 for Your Brand](customer-v2-guide.md) (what v2 is and why),
> the legacy integration reference (public Notion doc), and the
> [v2 Event & Schema Reference](segment-v2-event-reference.md) (the full event
> dictionary with payload examples).
> **Status:** both v2 streams are available now — the server stream, and the browser
> funnel stream (a per-brand opt-in via a second source). Your legacy integration keeps
> working unchanged until *you* retire it.

## 1. The strategy in one paragraph

v2 flows to a **new, separate Segment source** in your workspace, so migration is a
**dual-run**: enable v2 alongside legacy, validate the new stream against the old one,
rebuild dashboards and audiences on v2, then retire legacy on your schedule. The one
decision you must make **before** building anything on v2 is your **identity strategy**:
legacy identified patients by **email address**; v2 identifies them by a **stable NomadMD
user id** (`mu_…`) with email demoted to a profile trait. Nothing merges automatically —
Section 3 gives you three ways to handle it and tells you which keys to join on.

## 2. What's changing — orientation

| | Legacy | v2 |
|---|---|---|
| Segment `userId` | patient's **email address** | stable id: `mu_<id>` (account) or `cp_<id>` (record-only patient); email is a **trait** |
| Who is identified | patients only | patients **and** staff (`usr_<id>` — practitioners, admins) |
| Events | 9, appointment/request lifecycle only | ~40 server-side (lifecycle, money ledger, membership, ops) + a ~23-event browser funnel stream |
| Payload style | full-state **snapshots**, camelCase | specific events with typed properties, `snake_case`, versioned (`context.schema_version`) |
| `revenue` | equal to `total` (includes tip) | service value + travel fee, **excluding** tip and tax (see Section 6) |
| Accounts | none (filter on properties) | `group()` calls for your brand and each provider organization |
| Dedup keys | none | `order_id` on conversions (doubles as ad-platform `event_id`) |

Everything else about the plumbing is familiar: server-side delivery into a Node.js
source you create, per-marketplace write key, one-way flow.

## 3. Identity: the center of gravity of this migration

### 3.1 What changed and why

Legacy called `identify` with the patient's **email address as the Segment `userId`**, and
every track event was keyed the same way. That had four failure modes you may have already
hit: a patient who changes their email becomes a brand-new user with no history; manually
created profiles don't enforce unique emails, so two different patients sharing an email
**collapse into one Segment user**; email — PII — becomes the join key that spreads through
every downstream table; and there is no way to stitch anonymous browsing to a known user.

v2 keys every call on a **stable, namespaced NomadMD id** that never changes for the life
of the account:

| v2 `userId` | Who |
|---|---|
| `mu_<id>` | a patient with a login (one account, even if they book at several of your locations) |
| `cp_<id>` | a patient **without** a login — e.g. a care record created manually by staff |
| `usr_<id>` | staff: practitioners, dispatchers, admins (never identified in legacy) |

Email, phone, and name still arrive on every patient — as **traits** on the `identify`
call, where they belong. If a record-only patient (`cp_…`) later gets an account, v2
automatically emits `alias(cp_… → mu_…)` so the history merges with no action on your side.

### 3.2 The consequence you must plan for

**Every patient will appear in v2 as a new user.** Any destination that keys profiles on
`userId` — your warehouse `users` table, Mixpanel, Amplitude, most CDPs — will see a
distinct population of `mu_…`/`cp_…` users with no automatic connection to the legacy
email-keyed users. This is by design; the question is how much continuity you need and
where you build it.

### 3.3 The join keys v2 gives you

You never need to guess how the two populations relate — v2 carries explicit crosswalk
keys:

1. **`email` trait** — present on every v2 patient `identify`. Joins to the legacy
   `userId` directly. Fragile in exactly the ways email always is (changes over time,
   collapsed duplicates), so treat it as the convenience key.
2. **`client_profile_id` / `client_profile_ids` traits** — v2 carries the patient's
   profile id(s); legacy sent the same id as the `clientProfielId` identify trait (note
   the legacy spelling). This is the **robust key**: it survives email changes and
   disambiguates the shared-email collapse.
3. **`appointment_id` / `appointment_request_id` event properties** — both generations
   carry them (`appointmentId` → `appointment_id`, etc.), so any single event in one
   stream can be matched to its twin in the other. Use these for validation and for
   activity-level joins, independent of user identity.

### 3.4 Strategy A — clean cut (recommended for most teams)

Treat v2 as a new analytics system. Point it at a fresh source, land it in fresh
warehouse schemas/destination projects, build new dashboards against it, and keep the
legacy data as a frozen historical archive. Do **not** attempt to merge user histories in
your product-analytics tools.

- **Best when:** your primary uses are dashboards, funnels, and campaign audiences —
  where "lifetime" continuity for pre-v2 history is nice-to-have, not load-bearing.
- **Why it's recommended:** v2's own derived fields already carry the history that
  matters — `prior_appointment_count`, `is_new_customer`, `lifetime_appointments`,
  `lifetime_revenue` are computed by NomadMD **across the patient's full record**,
  including activity that predates your v2 enablement. You get "is this a repeat
  customer" correctly on day one without any identity surgery.
- **Cost:** cross-generation user journeys (one user's 2025 events next to their 2027
  events in a single Mixpanel profile) aren't available; answer those in the warehouse.

### 3.5 Strategy B — warehouse crosswalk (continuity where it's cheap and safe)

If you warehouse both sources (Snowflake, BigQuery, Redshift via Segment), build a
mapping table once and join at query time:

```sql
-- v2 identifies: one row per patient with the crosswalk keys
with v2_users as (
  select user_id as v2_user_id,          -- 'mu_123' / 'cp_456'
         email,
         client_profile_id,
         client_profile_ids
  from v2_source.identifies              -- latest row per user_id
),
legacy_users as (
  select user_id as legacy_user_id,      -- the email address
         client_profiel_id               -- legacy trait (typo is in the data)
  from legacy_source.identifies          -- latest row per user_id
)
select l.legacy_user_id, v.v2_user_id
from legacy_users l
join v2_users v
  -- prefer the stable profile-id join; fall back to email
  on l.client_profiel_id = v.client_profile_id
  or (l.client_profiel_id is null and l.legacy_user_id = v.email)
```

Notes:

- Join on **profile id first, email second**. Email-only joins silently inherit the
  legacy shared-email collapse (two patients, one email, one legacy user) and miss
  anyone who changed email between the two eras.
- One v2 account (`mu_…`) can map to **several** legacy users: legacy created one user
  per email spelling per era. That's a feature of the crosswalk — it reunites what
  legacy split — but write your models to expect 1-to-many.
- `client_profile_ids` (plural) exists because one account can hold multiple care
  records (e.g. a parent booking for family members). Legacy emitted those as separate
  email-keyed users; in v2 they are one account. Decide whether your models should
  count accounts or patients — v2 lets you do either.

### 3.6 Strategy C — profile merging in your identity layer

If you run Segment **Unify** (or a destination with its own identity resolution, e.g.
Mixpanel's identity merge), you can let it stitch the two generations into one profile:
v2's `identify` carries the same `email` trait that legacy profiles have, so an identity
graph that includes email as an identifier will connect the legacy user (whose `user_id`
*is* the email) with the v2 user (whose profile carries that email).

Go in with eyes open:

- **The merge inherits legacy's defects.** Two patients who shared an email in legacy
  become one merged profile spanning *three* identities. Audit for shared emails before
  turning this on (the crosswalk query above finds them: one email → multiple
  `client_profile_id`s).
- **Identifier priority matters.** Configure `user_id` above `email` and check your
  identity-resolution limits; a high-cardinality merge wave lands the first weeks of
  dual-run, as each returning patient's v2 identify arrives.
- **This fixes profiles, not tables.** Warehouse rows keep their original `user_id`
  values either way — you still want the Strategy-B crosswalk for SQL.

### 3.7 Identity edge cases — read before you validate

These are the cases that make dual-run numbers look "wrong" when they're actually both
right:

- **Multi-patient bookings.** Legacy sent **one event per patient** (each keyed to that
  patient's email). v2 sends lifecycle events keyed to the **booking account**, with
  group context on the payload (`is_group_appointment`, `group_id`, `group_size`).
  Event counts for group appointments will not match 1:1 between streams, and that's
  expected. The money is also different in kind: v2 `revenue`/`total` are the
  **whole-group** economics on the shared checkout, never split per member.
- **Shared-email manual profiles.** Legacy collapsed them into one user; v2 keeps them
  as distinct `cp_…`/`mu_…` users. v2's patient counts will be *higher* and *more
  correct*.
- **Email changes.** Legacy split such patients into two users; v2 keeps one. v2's
  counts will be *lower* and *more correct* for this cohort.
- **Staff users.** v2 identifies practitioners and admins (`usr_…`) — legacy never did.
  Exclude `usr_` ids from patient-facing audiences and counts (the prefix makes this a
  one-line filter). Also note legacy's infamous property quirk: the event **property**
  `userId` on legacy appointment events was the *practitioner's* profile id, unrelated
  to the identity `userId`. In v2 that data is `practitioner_profile_id` plus
  `practitioner_user_id` (`usr_…`), explicitly named.
- **Record-only patients.** Booked-by-staff patients with no login appear as `cp_…`
  users; if they later create an account, an automatic `alias` merges them into the
  `mu_…` account. Destinations that honor alias (e.g. Mixpanel) merge automatically;
  warehouse models should treat the alias table as part of the crosswalk.

### 3.8 Do / don't

- **Do** key everything you build on v2 on the `userId` (`mu_`/`cp_`), and use `email`
  only for display, messaging, and destination matching.
- **Do** build the profile-id crosswalk before the validation window — you'll want it to
  explain count differences.
- **Don't** key v2 dashboards or audiences on the `email` trait. You'd be rebuilding the
  exact fragility v2 removes.
- **Don't** reuse your legacy source's write key for v2. The streams must stay separate:
  different schema, different identity space, and you need legacy intact as the
  reference during validation.

## 4. Event mapping — legacy → v2

The 9 legacy events map as follows. "Richer" means the v2 event carries typed properties
the legacy snapshot didn't (actors, reasons, durations, money breakdowns).

| Legacy event | v2 event(s) | What to know |
|---|---|---|
| `Appointment Requested` | `Appointment Requested` + `Order Completed` | The request is now also an **ecommerce conversion** (`Order Completed`, `order_id = appointment_request_id`) so ad/analytics destinations work out of the box. |
| `Appointment Request Pending Approval` | `Appointment Requested` with `requires_approval: true`, `request_status: "pending_approval"` | Status-named event collapsed; the status is a property. |
| `Appointment Request Updated` | `Appointment Request Approved` (approval transitions) / `Appointment Request Updated` (edits, slim `change_set[]`) — plus `Order Updated` when the edit changes booked value | The legacy catch-all is **split**, not dropped. |
| `Appointment Request Cancelled` | `Appointment Request Cancelled` | Adds `cancelled_by`, reason. |
| `Appointment Request Fulfilled` | `Appointment Request Fulfilled` | Adds `time_to_fulfill_minutes`, `appointment_id`. |
| `Appointment Booked` | `Appointment Booked` — fires **once** | **Behavior change:** legacy re-emitted `Appointment Booked` when a visit started and when an appointment was reset. v2 fires it exactly once per booking; visit start is `Appointment Started`, resets are `Appointment Reset`. Booking counts on raw legacy events overcount — see Section 7. |
| `Appointment Updated` | `Appointment Rescheduled` / `Appointment Reassigned` / `Appointment Updated` (slim) + the financial ledger (`Payment Captured`, `Order Refunded`, `Order Updated`) | The legacy firehose (any edit, checkout change, or payment) becomes specific events. Anything you derived by diffing legacy snapshots is now a first-class event. |
| `Appointment Cancelled` | `Appointment Cancelled` + `Order Cancelled` (money reversal) | Adds `cancelled_by`, `lead_time_to_cancel_hours`, `refund_amount`. |
| `Appointment Completed` | `Appointment Completed` (+ `Payment Captured` for money) | Adds duration, `revenue_recognized`, full price restatement. **Chart-note bodies are never sent on v2** — a `has_chart_notes` boolean replaces them (see the FAQ). |
| *(no legacy equivalent)* | The entire booking funnel, membership/package lifecycle, payment/refund ledger, and provider-ops catalogs | Net-new — see the [v2 guide](customer-v2-guide.md). |

Two delivery-semantics upgrades worth noting: v2 events are **specific deltas plus
self-contained money restatements** (you no longer reconstruct state by diffing
snapshots), and conversions carry a **dedup key** (`order_id`) so retries and
client/server twins can be deduplicated downstream — legacy had no dedup key
at all.

## 5. Property crosswalk

Where each legacy field went. Legacy names are camelCase; v2 is `snake_case` throughout.

### Appointment / request event properties

| Legacy property | v2 location | Notes |
|---|---|---|
| `appointmentId` | `appointment_id` | |
| `appointmentRequestId` | `appointment_request_id`; also `order_id` (as a string) on order events | `order_id` is the conversion/dedup key. |
| `marketplaceId` / `marketplace` | `marketplace_id` on every event; brand name is `affiliation` on `Order Completed` and the `mkt_…` `group()` traits | |
| `organizationId` / `organization` | `organization_id` (where known); org name lives on the `org_…` `group()` traits | |
| `address` | **removed** — replaced by `location_type` (`in_home`/`in_clinic`), `service_region`, `postal_code` | Full street addresses no longer leave the platform (privacy posture). |
| `patient` (full name) | **removed from events** — the event's `userId` identifies the patient; name is an identify trait (`first_name`/`last_name`) | |
| `practitioner` (full name) / `userId` (practitioner profile id **property**) | `practitioner_profile_id` + `practitioner_user_id` (`usr_…`) | Fixes the legacy trap of a `userId` property that wasn't the identity. Names via the staff identity, not event payloads. |
| `procedures[]` (names) / `procedureId[]` | `products[]` — `{product_id, name, category, price, quantity, add_on_ids}` | Ecommerce-spec line items; `product_id` = procedure base definition id. |
| `start` / `end` | `scheduled_start_at` / `scheduled_end_at` (+ `duration_minutes`) | |
| `timeRange` (requests) | `scheduled_start_at` / window properties (`window_count`, `times_of_day` on the browser stream) + `booking_mode` | |
| `createdAt` / `updatedAt` / `cancelledAt` / `completedAt` / `fulfilledAt` | the Segment event `timestamp` of the specific v2 event | Status-timestamp props are obsolete: each transition is its own event. |
| `status` | `appointment_status` / `request_status` | Same platform vocabulary, explicit per event. |
| `cancellationReason` | `cancellation_reason` (+ `cancelled_by`) | |
| `clientHistory` (`'new'`/`'repeat'`) | `is_new_customer` + `prior_appointment_count` | Now account-grain and correctly scoped to your brand; the legacy computation undercounted multi-profile accounts. |
| `membership` | identify traits `membership_name` / `membership_status`; membership activity is its own event family | |
| `checkoutNotes` | **removed** (free-text PII) | |
| `checkout[]` (line items) / `customLineItems` | `products[]` + explicit money scalars (`discount`, `travel_fee`, `gratuity_amount`, `other_items_total`, …) | Fees/discounts are event-level scalars, never pseudo-line-items. |
| `assessment` / `intervention` | **not sent in v2** — replaced by `has_chart_notes` (on `Appointment Completed`) and the `Chart Note Saved` activity event | Bodies remain available only on the legacy event, behind `sendChartNotes` — see the FAQ. |

### Money properties (see Section 6 for definitions)

| Legacy property | v2 location | Notes |
|---|---|---|
| `procedureTotal` | ≈ `revenue` − `travel_fee` | v2 has no direct "procedures only" scalar; derive it, or sum `products[]`. |
| `travelFee` | `travel_fee` | |
| `gratuityAmount` | `gratuity_amount` | |
| `packageCredit` | `package_credit_applied` | |
| `discount` / `promoCodeDiscount` | `discount` (all discounts) + `coupon` (the code) | |
| `promoCode` | `coupon` | |
| `total` | `total` | Same meaning. |
| `revenue` (= legacy `total`) | **`total`, not v2 `revenue`** | The single most important remapping — see Section 6. |
| `paidAmount` / `balance` | the payment ledger: sum `Payment Captured` − `Order Refunded` per `appointment_id`/`order_id` | Point-in-time balances are replaced by an auditable ledger. |
| `transactionId` | `transaction_id` on `Payment Captured` (one event per payment — no more comma-joined lists) | |
| `checkoutId` | `checkout_id` | |

### Identify traits

| Legacy trait | v2 trait | Notes |
|---|---|---|
| *(userId)* + `email` | `email` | Trait only; the `userId` is now `mu_…`/`cp_…`. |
| `name` / `firstName` / `lastName` | `first_name` / `last_name` | Concatenated `name` dropped. |
| `phone` | `phone` | |
| `clientProfielId` *(sic)* | `client_profile_id` (typo fixed) + `client_profile_ids` (all records under the account) | **Your crosswalk key** — see 3.3. |
| `fullAddress` | **removed** — `service_region` + `postal_code` | Coarse geo only. |
| `birthday` / `age` / `sexAssignedAtBirth` | `birthday` / `age` / `sex_assigned_at_birth` | |
| `createdAt` | `created_at` | |
| `membership` | `membership_name` + `membership_status` | |
| *(new)* | `marketplace_group_id`, `signup_marketplace_id`, `lifetime_appointments`, `lifetime_revenue`, `package_credits_remaining`, `is_new_customer`, `marketing_sms_opt_in`, `marketing_email_opt_in` | All computed within your brand's scope only. |

## 6. Money: `revenue` is redefined — remap before you compare

Both generations send decimal dollars, but the words changed meaning:

- **Legacy:** `revenue` = `total` = everything on the checkout, **including gratuity**.
- **v2:** `revenue` = service value + travel fee, **excluding gratuity and tax**;
  `total = revenue − discount − package_credit_applied + gratuity_amount + tax`.

Practical rules:

1. **A legacy revenue chart and a v2 revenue chart will not match — by design.** When
   porting a dashboard that used legacy `revenue`, bind it to v2 `total` for like-for-like
   continuity, or adopt v2 `revenue` and accept the (better) new definition going forward.
   Don't average the two.
2. **Booked vs collected is now explicit.** Legacy money was a snapshot re-sent on every
   change; v2 states booked value at order time (`Order Completed`), keeps it honest with
   `Order Updated`/`Order Cancelled`, and records **cash truth** in the payment ledger
   (`Payment Captured`, `Order Refunded`, `Payment Collected On Site`). Finance-grade
   numbers should sum the ledger; lifecycle-event money is a denormalized convenience.
3. **Reconciliation join:** per appointment, legacy final `total` should equal v2 `total`
   on the last money restatement, and legacy `paidAmount` should equal the ledger sum.
   Join on `appointment_id`. Expect small windows of disagreement from timing (legacy
   snapshots lag payments by one event).

## 7. The migration plan

### Phase 0 — inventory (before enabling anything)

- List every consumer of the legacy source: destinations, warehouse models, dashboards,
  audiences/journeys, alerts. Flag each as *email-keyed*, *event-keyed*, or *aggregate*.
- Pick your identity strategy (Section 3). If B or C, audit for shared-email profiles
  now — they'll shape your merge expectations.
- Decide who owns the validation sign-off and what "validated" means (suggested: 2–4
  weeks of dual-run with booking counts within agreed tolerance and money reconciled).

### Phase 1 — enable the dual-run

1. Create a new **Node.js source** in your Segment workspace (do not reuse the legacy
   source). Copy its write key.
2. Enter the key in NomadMD: Integrations → Segment → v2 write key, and enable v2.
   Legacy keeps flowing to its existing source, untouched.
3. Optionally add the **browser funnel** too: create a JavaScript source and paste its
   write key as the client key — the on-site funnel events start flowing for your brand.
4. Connect the v2 source(s) to a **staging destination/schema first** if you want a look
   before production destinations receive it.

### Phase 2 — validate (the dual-run window)

- **Bookings:** count v2 `Appointment Booked` (fires once per booking) against legacy
  `Appointment Booked` **deduplicated by `appointmentId`** — the legacy event re-fires on
  visit start and reset, so raw legacy counts run high. This is the known trap.
- **Requests:** legacy `Appointment Requested` + `Appointment Request Pending Approval`
  together ≈ v2 `Appointment Requested`.
- **Money:** reconcile per Section 6.3 on a sample of appointments; confirm your remap
  of legacy `revenue` → v2 `total`.
- **Identity:** run the crosswalk; confirm the expected count differences (Section 3.7)
  explain any user-population gap.
- **Multi-patient bookings:** spot-check a group appointment end-to-end — one v2 stream
  keyed to the booking account vs legacy's per-patient copies.

### Phase 3 — rebuild on v2

- Port dashboards using the event and property crosswalks (Sections 4–5); rebind
  legacy-`revenue` charts per Section 6.
- Rebuild audiences on `userId`/traits (never on raw email).
- Point production destinations at the v2 source. If a destination can't run two sources
  side by side, cut it over during a quiet window and note the discontinuity date.

### Phase 4 — cut over and retire legacy

- Move remaining consumers off the legacy source; freeze (don't delete) historical
  legacy data in the warehouse.
- Tell NomadMD to disable the legacy integration for your marketplace. This is **your
  flag** — nothing retires automatically, and you'll get notice, not a surprise.
- Keep the crosswalk table: it's the permanent bridge to your pre-v2 history.

## 8. Destination-specific notes

- **Warehouse (Snowflake/BigQuery/Redshift):** the v2 source lands in its own schema, so
  nothing collides. Continuity = Strategy B views that `union` the eras through the
  crosswalk, with an explicit `schema_generation` column.
- **Mixpanel / Amplitude:** new users appear under `mu_…` ids. Mixpanel's identity merge
  can stitch via the shared email identifier or the `cp_→mu_` alias; Amplitude will treat
  the eras as separate users unless you run a one-time user-mapping import. For both,
  clean cut + a warehouse view for history is usually less risk than a bulk merge.
- **CRM / email tools (HubSpot, Klaviyo, etc.):** least affected — these key contacts on
  email, which still arrives as a trait on every identify. Verify your mapping reads the
  trait (not the Segment `userId`) and these keep working through the cutover.
- **Ad destinations (Meta CAPI, TikTok, GA4):** a v2-only capability — enable cloud-mode
  destinations on the v2 source; match identifiers hash from identify traits. If you run
  browser pixels via GTM today, configure `event_id = order_id` (GA4: `transaction_id`)
  so conversions dedupe against the server path once you enable the browser stream.

## 9. FAQ

**Will v2 backfill history?** No — same rule as legacy: events flow from enablement
forward. Your pre-v2 history lives in the legacy source's data; bridge with the
crosswalk. (v2's `prior_appointment_count`/`lifetime_*` fields *do* incorporate pre-v2
platform history, so "new vs repeat" is correct from day one.)

**Do I have to migrate?** No. Legacy keeps running unchanged until you ask for it to be
turned off. But net-new capabilities (funnel, ledger, memberships, ops, ad conversions)
ship on v2 only.

**Why don't my user counts match between the streams?** Four structural reasons —
shared-email collapse (legacy undercounts), email changes (legacy overcounts),
multi-profile accounts (legacy counts patients, v2 counts accounts *and* carries the
patient records), and staff identities (v2-only). Section 3.7 has the details; the
crosswalk quantifies each.

**Can I keep identifying users by email in v2?** Email arrives on every identify as a
trait, so email-keyed destinations (CRMs) keep working. But don't key analytics on it —
you'd reintroduce the exact identity fragility this migration removes.

**What about the `clientProfielId` typo?** Legacy keeps sending the misspelled trait
untouched (per its docs, any change there would be announced). v2 uses the corrected
`client_profile_id`. Map both in your crosswalk.

**Is anything in v2 still per-email?** No. Nothing in v2 uses email as an identifier —
not `userId`, not dedup, not joins.

**Does the chart-notes opt-in carry over?** No — this is the one legacy capability v2
deliberately does not reproduce. The v2 stream never carries clinical note bodies under
any configuration: `Appointment Completed` sends a `has_chart_notes` boolean, and
`Chart Note Saved` signals form activity without content. If your workflows depend on
the flag-gated `assessment`/`intervention` payloads, keep the legacy integration
enabled for that feed (it runs alongside v2 indefinitely) and talk to us about your use
case before retiring it.

**Whom do I contact?** support@nomadmd.app — and your NomadMD contact can set up the
dual-run validation window with you.
