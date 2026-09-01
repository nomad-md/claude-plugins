# NomadMD Segment Integration v2 — Event & Schema Reference

> **Support:** support@nomadmd.app
> **Audience:** analytics, data-engineering, and marketing-ops teams receiving the
> NomadMD v2 Segment stream.
> **Companions:** [Segment v2 for Your Brand](customer-v2-guide.md) (overview and setup),
> [Migrating from the Legacy Integration](legacy-to-v2-migration.md) (if you use the
> legacy 9-event integration today), and the [GTM dataLayer
> reference](gtm-datalayer-reference.md) (the separate browser-pixel stream).
> The machine-readable **Segment Protocols tracking plans** matching this document are
> published alongside it, one per source:
> [`tracking-plan.server.public.json`](tracking-plan.server.public.json) for the
> server (Node.js) source and
> [`tracking-plan.browser.public.json`](tracking-plan.browser.public.json) for the
> browser (JavaScript) source. Protocols customers can import each into its matching
> source via Segment's Public API to get schema validation; everyone else can use them
> as JSON Schema references for codegen and QA.

This is the complete dictionary of every call NomadMD makes to your Segment workspace on
the v2 integration: `identify`, `group`, `alias`, and every `track` event, with property
tables and example payloads.

## 1. At a glance

| | |
|---|---|
| **Direction** | One-way. NomadMD sends to Segment; nothing flows back. |
| **What's sent** | ~40 server-side `track` events (booking lifecycle, orders, payments ledger, memberships, provider operations), plus `identify`, `group`, and `alias` calls — and a browser-side funnel stream (~23 more events) that activates per brand ([Section 7](#7-browser-events-checkout-web)). |
| **Scope** | Per marketplace (brand). Your workspace receives only your brand's activity — see [Section 10](#10-data-protection). |
| **Sources** | A **Node.js source** you create for the server stream; a **JavaScript source** for the browser stream — it activates when you add its write key. Never reuse your legacy source. |
| **Identity** | Stable NomadMD ids (`mu_…`, `cp_…`, `usr_…`) — never email. Email/phone/name arrive as `identify` traits. |
| **Schema governance** | Every call carries `context.schema_version` (currently `"2.0"`). Additive changes bump the minor version; breaking changes are announced. |

## 2. Conventions

### 2.1 Naming

- **Events:** `Object Action`, past tense, Title Case — `Appointment Booked`,
  `Order Completed`. Consumer-funnel events follow Segment's
  [V2 E-Commerce spec](https://segment.com/docs/connections/spec/ecommerce/v2/) so
  ecommerce-aware destinations work without mapping.
- **Properties and traits:** `snake_case`.
- **Ids:** suffixed `_id`, always a stable surrogate key — never a name or an email.
- **Booleans:** prefixed `is_` / `has_`. **Timestamps:** ISO-8601 strings suffixed `_at`
  (the event's own time is Segment's standard `timestamp`, not a property).

### 2.2 Money

All monetary values are **decimal dollars** (never cents), always accompanied by
`currency: "USD"` where an order is described.

- **`revenue`** = gross service value (the procedure line items, pre-discount) **plus
  `travel_fee`**. It **never** includes gratuity or tax.
- **`total`** = `revenue − discount − package_credit_applied + gratuity_amount + tax` —
  what the customer owes for the order.
- **Booked vs collected:** `revenue`/`total` on order events are the **booked value** at
  order time; no cash necessarily moves then. Cash truth is the payments ledger
  ([Section 6.5](#65-payments--the-money-ledger)) — reconcile via `order_id` /
  `appointment_id`. Sum the ledger for finance-grade numbers; money on lifecycle events
  is a denormalized convenience.

> Migrating from legacy? Legacy `revenue` equaled `total` (gratuity included). The v2
> like-for-like field for legacy `revenue` is **`total`**. See the
> [migration guide](legacy-to-v2-migration.md), Section 6.

### 2.3 The envelope — context on every call

Every call (`track`, `identify`, `group`, `alias`, and the browser stream's `page`)
carries:

| Context field | Type | Description |
|---|---|---|
| `schema_version` | string | Schema version of this payload. Currently `"2.0"`. |
| `app.name` | string | Emitting application: `dispatch-api`, `consumer-api`, `checkout-web`. |
| `app.version` | string | Build identifier (git SHA) of the emitter. |
| `source` | string enum (`server`, `client`) | Which stream produced the call. Use it to pick the server row for money and the client row for attribution on dual-stream events ([Section 8](#8-dual-stream-events--deduplication)). |

A complete `track` message looks like:

```json
{
  "type": "track",
  "event": "Appointment Booked",
  "userId": "mu_412",
  "timestamp": "2026-05-26T22:04:11.093Z",
  "properties": { "appointment_id": 874, "…": "…" },
  "context": {
    "schema_version": "2.0",
    "app": { "name": "dispatch-api", "version": "6e96d400" },
    "source": "server"
  }
}
```

Segment adds its own envelope fields (`messageId`, `sentAt`, `receivedAt`, …) on top.

### 2.4 Shared property blocks

Several property groups recur across events. They are defined once here; event tables
below reference them by name.

**`products[]` — order line items.** One entry per procedure on the order:

| Field | Type | Description |
|---|---|---|
| `product_id` | string | The procedure's catalog id (procedure base definition id). |
| `name` | string | Procedure name, e.g. `"Recover"`. |
| `category` | string, optional | Catalog category. |
| `price` | number | Unit price in dollars. |
| `quantity` | integer | |
| `add_on_ids` | string[], optional | Selected add-on procedure ids. `Order Completed` / `Checkout Started` line items only. |

Fees and discounts are **never** folded into `products[]` as pseudo-line-items; they are
event-level scalars (below), per the ecommerce spec.

**Price breakdown** — the full money restatement. Wherever an event carries this block,
the order's current economics are self-contained (no joins needed):

| Field | Type | Description |
|---|---|---|
| `discount` | number | All discounts applied (positive number). |
| `tax` | number | |
| `gratuity_amount` | number | Tip. In `total`, never in `revenue`. |
| `travel_fee` | number | In `revenue` (part of the priced service). |
| `other_items_total` | number | Non-standard line items. |
| `package_credit_applied` | number | Credit value applied (positive number). |
| `total` | number | See [Section 2.2](#22-money). |
| `coupon` | string, optional | Promo code applied, if any. |

**Geo block** — coarse location, on appointment-anchored events (all optional):

| Field | Type | Description |
|---|---|---|
| `location_type` | string enum (`in_home`, `in_clinic`) | Care setting. |
| `service_region` | string | Coarse region — **never a street address**. |
| `postal_code` | string | |

**Group context** — present when the order/appointment belongs to a group booking (one
shared checkout serving several patients). All optional; absent means solo:

| Field | Type | Description |
|---|---|---|
| `is_group_appointment` | boolean | `true` when >1 patient shares the checkout. |
| `group_id` | string (UUID), nullable | Shared by the group's appointments; `null` for solo. |
| `group_size` | integer | Patients on the shared checkout (`1` for solo). |

> **Money on group bookings is whole-group.** `revenue`/`total` describe the single
> shared checkout — they are never split per member.

**Split-payment context** — payment events only (all optional):

| Field | Type | Description |
|---|---|---|
| `is_split_payment` | boolean | `true` when the checkout has more than one payment link. |
| `payment_link_id` | integer, nullable | The payment link this charge settled (link-collected charges only). |
| `active_payment_link_count` | integer | Payment links currently on the checkout. |

### 2.5 The worked example

Examples throughout this document follow **one booking end to end** — the same
appointment used in the legacy integration reference, so migrating teams can compare
payloads side by side: Jane Doe (`mu_412`) books *Recover* ($199) with two IV add-ons
($33 each) at the **IV Demo** marketplace (id 5), served by **Coconut | Miami, FL**
(org 15), practitioner Alex Rivera (profile 65). Travel fee $59, discount $36.75, $25
deposit. So: `revenue` = 265 + 59 = **324.00**, `total` = 324 − 36.75 = **287.25**.
Request 24382 → appointment 874, checkout 4201. Per-event examples show the
`properties` object only; the envelope is always as in [Section 2.3](#23-the-envelope--context-on-every-call).
Values are illustrative — the authoritative schema is the property tables, and the most
reliable view of your own data is the Segment debugger on your v2 source.

## 3. Identity — `identify` and `alias`

### 3.1 `userId` formats

The Segment `userId` on every call is a stable, namespaced NomadMD id. It never changes
for the life of the account, and it is never an email address.

| Format | Who | Notes |
|---|---|---|
| `mu_<id>` | A patient with a login. | One account per person — the same `mu_` id even if they interact with several of your locations. |
| `cp_<id>` | A patient **without** a login (a care record created by staff, e.g. a manual booking). | Merged into `mu_` automatically if they later get an account — see [`alias`](#34-alias). |
| `usr_<id>` | Staff: practitioners, dispatchers, admins. | New in v2 — legacy never identified staff. Filter on the prefix to keep staff out of patient audiences. |

On events that reference a practitioner, note the two distinct id spaces:
`practitioner_profile_id` is the provider's **staff-profile id** (one per organization
they work for), while `practitioner_user_id` is their **identity id** (`usr_…`). Events
carry both so you can join to the staff identity without any external mapping.

### 3.2 When `identify` fires

On sign-in, sign-up, profile update, and the first server-side touch of a known user.
Traits like `lifetime_appointments` are refreshed on the relevant lifecycle events.

### 3.3 Patient traits

| Trait | Type | Presence | Description |
|---|---|---|---|
| `email` | string | required | A trait — **not** the `userId`. |
| `phone` | string | optional | |
| `first_name` / `last_name` | string | required | |
| `created_at` | datetime | required | Account creation. |
| `marketplace_group_id` | integer | required | The account umbrella the login belongs to. |
| `signup_marketplace_id` | integer | optional | Brand first signed up through — set once. |
| `client_profile_id` | integer | optional | Primary care record id. |
| `client_profile_ids` | integer[] | optional | All care records under the account (e.g. family members). |
| `birthday` | datetime | optional | |
| `age` | integer | optional | |
| `sex_assigned_at_birth` | string | optional | Sensitive attribute — confirm it fits your privacy posture before routing downstream. |
| `service_region` | string | optional | Coarse geo — never a full address. |
| `postal_code` | string | optional | |
| `membership_status` | string | optional | |
| `membership_name` | string | optional | |
| `package_credits_remaining` | number | optional | Current unexpired credit balance — point-in-time state for segmentation. The auditable ledger is the credit events ([Section 6.6](#66-memberships--packages)). |
| `lifetime_appointments` | integer | optional | Account-grain lifetime count, **within your brand only**. Includes activity predating your v2 enablement. |
| `lifetime_revenue` | number | optional | Same scoping. |
| `is_new_customer` | boolean | optional | Point-in-time: no prior appointment yet. Becomes `false` the moment a first booking exists. For "was this customer new at appointment X", use the **event** properties `is_new_customer` / `prior_appointment_count`, which are anchored before that appointment. |
| `marketing_sms_opt_in` / `marketing_email_opt_in` | boolean | optional | |

```json
{
  "type": "identify",
  "userId": "mu_412",
  "traits": {
    "email": "jane.doe@example.com",
    "phone": "+13055550142",
    "first_name": "Jane",
    "last_name": "Doe",
    "created_at": "2025-11-02T16:21:07.000Z",
    "marketplace_group_id": 1,
    "signup_marketplace_id": 5,
    "client_profile_id": 8891,
    "client_profile_ids": [8891],
    "birthday": "1992-03-14T00:00:00.000Z",
    "age": 34,
    "service_region": "Miami, FL",
    "postal_code": "33131",
    "membership_status": "active",
    "membership_name": "Hydration Club",
    "package_credits_remaining": 0,
    "lifetime_appointments": 3,
    "lifetime_revenue": 861.75,
    "is_new_customer": false,
    "marketing_sms_opt_in": true,
    "marketing_email_opt_in": true
  }
}
```

### 3.4 Staff traits

| Trait | Type | Presence | Description |
|---|---|---|---|
| `email` | string | required | |
| `first_name` / `last_name` | string | required | |
| `role_scope` | string enum (`root`, `organization`, `marketplace`) | required | |
| `organization_id` | integer | optional | |
| `is_practitioner` | boolean | required | |
| `accepts_appointments` | boolean | optional | |
| `profile_ids` | integer[] | optional | All staff-profile ids under this user (one per organization) — the reverse of `practitioner_profile_id` on events. |

```json
{
  "type": "identify",
  "userId": "usr_31",
  "traits": {
    "email": "alex.rivera@coconut.example.com",
    "first_name": "Alex",
    "last_name": "Rivera",
    "role_scope": "organization",
    "organization_id": 15,
    "is_practitioner": true,
    "accepts_appointments": true,
    "profile_ids": [65]
  }
}
```

### 3.5 `alias`

When a record-only patient (`cp_…`) is linked to an account, NomadMD automatically
emits an `alias` so their history merges — no action needed on your side. Destinations
that honor alias (e.g. Mixpanel) merge the profiles; warehouse users can treat the
aliases table as a mapping table.

```json
{
  "type": "alias",
  "previousId": "cp_8891",
  "userId": "mu_412"
}
```

On the browser stream, sign-in additionally emits `alias(anonymousId → mu_…)`,
stitching the pre-auth funnel to the known user.

## 4. Accounts — `group`

v2 maintains two account types via Segment `group()` calls. Every `track` event also
carries `marketplace_id` / `organization_id` as plain properties, so day-to-day
filtering needs no join — the `group` traits are for account-level rollups (B2B
analytics, account views in your CDP).

`group()` fires on account creation and whenever traits change.

### 4.1 Marketplace (your brand) — `groupId: mkt_<id>`

| Trait | Type | Presence | Description |
|---|---|---|---|
| `name` | string | required | |
| `marketplace_group_id` / `marketplace_group_name` | integer / string | required | The umbrella the brand belongs to. |
| `region` / `timezone` | string | optional | |
| `booking_mode` | string enum (`specific_time`, `window`) | required | The brand's scheduling model. |
| `requires_approval` | boolean | required | Whether bookings need dispatch/practitioner approval. |
| `payment_collection_method` | string enum (`collect_on_site`, `collect_deposit`, `collect_on_confirmation`) | required | |
| `live_organization_count` | integer | optional | Provider organizations currently serving the brand. |
| `created_at` | datetime | required | |

```json
{
  "type": "group",
  "userId": "mu_412",
  "groupId": "mkt_5",
  "traits": {
    "name": "IV Demo",
    "marketplace_group_id": 1,
    "marketplace_group_name": "NomadMD",
    "region": "Miami, FL",
    "timezone": "America/New_York",
    "booking_mode": "specific_time",
    "requires_approval": true,
    "payment_collection_method": "collect_deposit",
    "live_organization_count": 3,
    "created_at": "2024-08-19T14:00:00.000Z"
  }
}
```

### 4.2 Organization (provider group) — `groupId: org_<id>`

| Trait | Type | Presence | Description |
|---|---|---|---|
| `name` | string | required | |
| `marketplace_ids` | integer[] | required | Brands the organization serves. |
| `active_practitioner_count` | integer | optional | |
| `service_region_count` | integer | optional | From the org's service areas. |
| `payments_enabled` | boolean | optional | Payment account approved. |
| `created_at` | datetime | required | |

```json
{
  "type": "group",
  "userId": "usr_31",
  "groupId": "org_15",
  "traits": {
    "name": "Coconut | Miami, FL",
    "marketplace_ids": [5],
    "active_practitioner_count": 12,
    "service_region_count": 2,
    "payments_enabled": true,
    "created_at": "2024-09-30T18:12:00.000Z"
  }
}
```

## 5. Properties on every event

In addition to its own properties and the [envelope](#23-the-envelope--context-on-every-call),
every `track` event carries (where known):

| Property | Type | Presence | Description |
|---|---|---|---|
| `marketplace_id` | integer | required | The brand. |
| `marketplace_group_id` | integer | required | |
| `organization_id` | integer | optional | The serving provider organization, where known. |

These are omitted from the per-event tables and examples below to avoid repetition.

**Event `userId`:** patient-facing events (orders, appointments, memberships) are keyed
to the patient (`mu_`/`cp_`); provider/ops events are keyed to the acting staff user
(`usr_`), except where noted (e.g. `Appointment Offered` is keyed to the requesting
patient).

## 6. Server events (available now)

### 6.1 Authentication & accounts

#### Signed In

Auth success. Streams: server + browser (the browser emission triggers the client
`identify` + `alias`).

| Property | Type | Presence | Description |
|---|---|---|---|
| `method` | string enum (`passcode`, `password`, `google`, `apple`) | required | |

```json
{ "method": "passcode" }
```

#### Account Created

A new patient account is registered. Fires exactly one account-scoped `identify`.
Streams: server + browser.

| Property | Type | Presence | Description |
|---|---|---|---|
| `method` | string enum (`passcode`, `password`, `google`, `apple`) | required | |

```json
{ "method": "passcode" }
```

### 6.2 Orders & checkout

#### Order Completed

**The canonical conversion.** Fires when a booking is successfully submitted — the
moment the customer commits. Money is **booked value** ([Section 2.2](#22-money)); it is
kept honest downstream by `Order Updated` / `Order Cancelled`, and cash truth is the
payments ledger.

Also emitted for **standalone membership/package purchases and renewals**, with
`order_id` `membership_<id>` / `package_<id>` and a single line item — never doubled
when a membership/package is bundled inside a booking checkout.

Streams: server + browser — deduplicate on `order_id`
([Section 8](#8-dual-stream-events--deduplication)).

| Property | Type | Presence | Description |
|---|---|---|---|
| `order_id` | string | required | `= appointment_request_id` (or `membership_<id>` / `package_<id>`). The client↔server dedup key **and** the ad-platform `event_id`. |
| `created_via` | string enum (`consumer_checkout`, `dispatch_admin`, `mobile_field`, `api`) | required | Surface the order was created on. |
| `created_by` | string enum (`patient`, `practitioner`, `admin`, `system`) | required | Actor type. |
| `created_by_user_id` | integer | optional | Staff user id when staff-created; omitted for patient self-serve. |
| `checkout_session_id` | string | required, nullable | Joins the browser funnel to the order. `null` when the order didn't come through the browser funnel (staff-created orders, or brands without the browser source). |
| `checkout_id` | integer | required | Server-generated at order creation. |
| `appointment_id` | integer | required, nullable | `null` while the request is pending approval. |
| `affiliation` | string | required | Brand name (ecommerce-spec field). |
| `revenue` | number | required | Booked value — see [Section 2.2](#22-money). |
| `amount_due_now` | number | required | What checkout displayed as due at booking. |
| `collection_method` | string enum (`collect_on_site`, `collect_deposit`, `collect_on_confirmation`) | required | |
| `currency` | string | required | `"USD"`. |
| `payment_method` | string enum (`card`, `apple_pay`, `saved_card`, `cash`, `payment_link`) | optional | |
| `booking_mode` | string enum (`specific_time`, `window`) | required | |
| `requires_approval` | boolean | required | |
| `appointment_status` | string enum (`pending`, `booked`, `completed`, `cancelled`, `noshow`) | required | |
| `is_new_customer` | boolean | required | Anchored **before** this order; brand-scoped. |
| `prior_appointment_count` | integer | required | Brand-scoped. |
| `membership_purchased` | boolean | required | |
| `products[]` | array | required | See [Section 2.4](#24-shared-property-blocks). |

Also includes: **price breakdown**, **group context**, **geo block** ([Section 2.4](#24-shared-property-blocks)).

```json
{
  "order_id": "24382",
  "created_via": "consumer_checkout",
  "created_by": "patient",
  "checkout_session_id": "3f1c9d3a-4a5b-4a83-9a4e-2d1f0a6b7c88",
  "checkout_id": 4201,
  "appointment_id": null,
  "affiliation": "IV Demo",
  "revenue": 324.00,
  "discount": 36.75,
  "tax": 0.00,
  "gratuity_amount": 0.00,
  "travel_fee": 59.00,
  "other_items_total": 0.00,
  "package_credit_applied": 0.00,
  "total": 287.25,
  "amount_due_now": 25.00,
  "collection_method": "collect_deposit",
  "currency": "USD",
  "coupon": "MIAMI10",
  "payment_method": "card",
  "booking_mode": "specific_time",
  "requires_approval": true,
  "appointment_status": "pending",
  "is_new_customer": false,
  "prior_appointment_count": 3,
  "membership_purchased": false,
  "products": [
    { "product_id": "137", "name": "Recover", "category": "IV Therapy", "price": 199.00, "quantity": 1 },
    { "product_id": "154", "name": "Diphenhydramine (IV)", "category": "Add-on", "price": 33.00, "quantity": 1 },
    { "product_id": "155", "name": "Famotidine (IV)", "category": "Add-on", "price": 33.00, "quantity": 1 }
  ],
  "location_type": "in_home",
  "service_region": "Miami, FL",
  "postal_code": "33131"
}
```

#### Checkout Failed

Booking submission errored. Streams: server + browser.

| Property | Type | Presence | Description |
|---|---|---|---|
| `checkout_session_id` | string | required, nullable | `null` when the failure didn't originate in the browser funnel. |
| `error_code` | string | required | |
| `error_stage` | string enum (`payment`, `scheduling`, `validation`) | required | |
| `is_payment_declined` | boolean | required | |

```json
{ "checkout_session_id": null, "error_code": "card_declined", "error_stage": "payment", "is_payment_declined": true }
```

### 6.3 Appointment requests

The pre-scheduling order. Statuses flow `pending_approval → pending → fulfilled` (or
`cancelled`). Event names say **what happened**; the `request_status` property says
**where the request landed** afterward.

#### Appointment Requested

Request created (with or without an approval gate).

| Property | Type | Presence | Description |
|---|---|---|---|
| `appointment_request_id` | integer | required | |
| `request_status` | string enum (`pending_approval`, `pending`) | required | Status **after** this event. |
| `created_via` | string enum (`consumer_checkout`, `dispatch_admin`, `mobile_field`, `api`) | required | |
| `created_by` | string enum (`patient`, `practitioner`, `admin`, `system`) | required | |
| `created_by_user_id` | integer | optional | Staff user id when staff-created. |
| `booking_mode` | string enum (`specific_time`, `window`) | required | |
| `requires_approval` | boolean | required | |
| `products[]` | array | required | |
| `scheduled_start_at` | datetime | optional | Absent in window mode. |
| `value` | number | required | Booked value of the request. |

Also includes: **geo block**.

```json
{
  "appointment_request_id": 24382,
  "request_status": "pending_approval",
  "created_via": "consumer_checkout",
  "created_by": "patient",
  "booking_mode": "specific_time",
  "requires_approval": true,
  "products": [
    { "product_id": "137", "name": "Recover", "category": "IV Therapy", "price": 199.00, "quantity": 1 },
    { "product_id": "154", "name": "Diphenhydramine (IV)", "category": "Add-on", "price": 33.00, "quantity": 1 },
    { "product_id": "155", "name": "Famotidine (IV)", "category": "Add-on", "price": 33.00, "quantity": 1 }
  ],
  "scheduled_start_at": "2026-05-28T20:00:00.000Z",
  "value": 324.00,
  "location_type": "in_home",
  "service_region": "Miami, FL",
  "postal_code": "33131"
}
```

#### Appointment Request Approved

An approval-gated request passes review (`pending_approval → pending`).

| Property | Type | Presence | Description |
|---|---|---|---|
| `appointment_request_id` | integer | required | |
| `request_status` | string enum (`pending`) | required | |
| `time_to_approval_minutes` | number | required | Minutes from request creation to approval. |
| `approved_by` | string enum (`patient`, `practitioner`, `admin`, `system`) | required | |

```json
{ "appointment_request_id": 24382, "request_status": "pending", "time_to_approval_minutes": 88, "approved_by": "admin" }
```

#### Appointment Request Updated

A pending request is edited before fulfillment. If the edit changes the order's booked
value (procedures, location/travel fee), an `Order Updated` is emitted alongside with
the repriced amounts.

| Property | Type | Presence | Description |
|---|---|---|---|
| `appointment_request_id` | integer | required | |
| `request_status` | string enum (`pending_approval`, `pending`) | required | |
| `change_set` | string[] | required | Which fields changed (names only): `procedures`, `time_constraints`, `practitioner_constraints`, `organization_constraints`, `patient`, `location`. |

Also includes: **geo block**.

```json
{ "appointment_request_id": 24382, "request_status": "pending", "change_set": ["time_constraints"] }
```

#### Appointment Request Cancelled

| Property | Type | Presence | Description |
|---|---|---|---|
| `appointment_request_id` | integer | required | |
| `request_status` | string enum (`cancelled`) | required | |
| `cancellation_reason` | string | optional | Free text. |
| `cancelled_by` | string enum (`patient`, `practitioner`, `admin`, `system`) | required | |

```json
{ "appointment_request_id": 24382, "request_status": "cancelled", "cancellation_reason": "Schedule conflict", "cancelled_by": "patient" }
```

#### Appointment Request Fulfilled

The request becomes a scheduled appointment.

| Property | Type | Presence | Description |
|---|---|---|---|
| `appointment_request_id` | integer | required | |
| `request_status` | string enum (`fulfilled`) | required | |
| `appointment_id` | integer | required | |
| `time_to_fulfill_minutes` | number | required | End-to-end from request creation, **including** any approval wait (subtract `time_to_approval_minutes` for post-approval time). |
| `revenue` | number | required | |

```json
{ "appointment_request_id": 24382, "request_status": "fulfilled", "appointment_id": 874, "time_to_fulfill_minutes": 142, "revenue": 324.00 }
```

### 6.4 Appointments

#### Appointment Booked

The appointment reaches `booked`. **Fires exactly once per booking** — visit start and
resets are their own events (`Appointment Started`, `Appointment Reset`), so this event
is safe to count as bookings.

| Property | Type | Presence | Description |
|---|---|---|---|
| `appointment_id` | integer | required | |
| `appointment_request_id` | integer | optional | Absent for staff-created manual bookings. |
| `created_via` | string enum (`consumer_checkout`, `dispatch_admin`, `mobile_field`, `api`) | required | Inherited from the request where one exists. |
| `created_by` | string enum (`patient`, `practitioner`, `admin`, `system`) | required | |
| `created_by_user_id` | integer | optional | |
| `practitioner_profile_id` | integer | required | |
| `practitioner_user_id` | string | optional | `usr_…` identity of the practitioner; `null` when the profile has no login. |
| `scheduled_start_at` / `scheduled_end_at` | datetime | required | |
| `duration_minutes` | number | required | |
| `products[]` | array | required | |
| `revenue` | number | required | |
| `is_new_customer` | boolean | required | Anchored before this appointment; brand-scoped. |
| `prior_appointment_count` | integer | required | Brand-scoped. |
| `lead_time_days` | number | required | Booking → appointment. |

Also includes: **price breakdown**, **group context**, **geo block**.

```json
{
  "appointment_id": 874,
  "appointment_request_id": 24382,
  "created_via": "consumer_checkout",
  "created_by": "patient",
  "practitioner_profile_id": 65,
  "practitioner_user_id": "usr_31",
  "scheduled_start_at": "2026-05-28T20:00:00.000Z",
  "scheduled_end_at": "2026-05-28T20:45:00.000Z",
  "duration_minutes": 45,
  "products": [
    { "product_id": "137", "name": "Recover", "category": "IV Therapy", "price": 199.00, "quantity": 1 },
    { "product_id": "154", "name": "Diphenhydramine (IV)", "category": "Add-on", "price": 33.00, "quantity": 1 },
    { "product_id": "155", "name": "Famotidine (IV)", "category": "Add-on", "price": 33.00, "quantity": 1 }
  ],
  "revenue": 324.00,
  "discount": 36.75,
  "tax": 0.00,
  "gratuity_amount": 0.00,
  "travel_fee": 59.00,
  "other_items_total": 0.00,
  "package_credit_applied": 0.00,
  "total": 287.25,
  "coupon": "MIAMI10",
  "is_new_customer": false,
  "prior_appointment_count": 3,
  "lead_time_days": 2.0,
  "location_type": "in_home",
  "service_region": "Miami, FL",
  "postal_code": "33131"
}
```

#### Appointment Rescheduled

| Property | Type | Presence | Description |
|---|---|---|---|
| `appointment_id` | integer | required | |
| `old_start_at` / `new_start_at` | datetime | required | |
| `rescheduled_by` | string enum (`patient`, `practitioner`, `admin`, `system`) | required | |

```json
{ "appointment_id": 874, "old_start_at": "2026-05-28T20:00:00.000Z", "new_start_at": "2026-05-29T17:00:00.000Z", "rescheduled_by": "patient" }
```

#### Appointment Reassigned

| Property | Type | Presence | Description |
|---|---|---|---|
| `appointment_id` | integer | required | |
| `old_practitioner_profile_id` / `new_practitioner_profile_id` | integer | required | |
| `old_practitioner_user_id` / `new_practitioner_user_id` | string | optional | `usr_…` ids; `null` when a profile has no login. |
| `reassigned_by` | string enum (`patient`, `practitioner`, `admin`, `system`) | required | |

```json
{ "appointment_id": 874, "old_practitioner_profile_id": 65, "new_practitioner_profile_id": 71, "old_practitioner_user_id": "usr_31", "new_practitioner_user_id": "usr_44", "reassigned_by": "admin" }
```

#### Appointment Updated

Other edits (location, notes). Reschedules, reassignments, and payment activity fire
their own events — this is deliberately **not** a catch-all.

| Property | Type | Presence | Description |
|---|---|---|---|
| `appointment_id` | integer | required | |
| `change_set` | string[] | required | Names of the fields that changed — values omitted. |

```json
{ "appointment_id": 874, "change_set": ["location"] }
```

#### Appointment Started

The visit begins.

| Property | Type | Presence | Description |
|---|---|---|---|
| `appointment_id` | integer | required | |
| `practitioner_profile_id` | integer | required | |
| `practitioner_user_id` | string | optional | |
| `minutes_from_scheduled` | number | required | Positive = started late. |

```json
{ "appointment_id": 874, "practitioner_profile_id": 65, "practitioner_user_id": "usr_31", "minutes_from_scheduled": 3 }
```

#### Appointment Completed

The revenue-recognition moment: carries the procedures actually delivered and the full
realized money breakdown, so "what was delivered and for what" needs no joins.

| Property | Type | Presence | Description |
|---|---|---|---|
| `appointment_id` | integer | required | |
| `practitioner_profile_id` | integer | required | |
| `practitioner_user_id` | string | optional | |
| `actual_duration_minutes` | number | required | |
| `revenue_recognized` | number | required | |
| `has_chart_notes` | boolean | required | Whether clinical notes were recorded. **Note bodies are never sent on the v2 stream** — see [Section 10](#10-data-protection). |
| `gratuity_amount` | number | required | |
| `products[]` | array | required | As delivered. |

Also includes: the remaining **price breakdown** fields (`discount`, `tax`,
`travel_fee`, `other_items_total`, `package_credit_applied`, `total`, `coupon`),
**group context**, **geo block**.

```json
{
  "appointment_id": 874,
  "practitioner_profile_id": 65,
  "practitioner_user_id": "usr_31",
  "actual_duration_minutes": 44,
  "revenue_recognized": 324.00,
  "has_chart_notes": true,
  "gratuity_amount": 45.00,
  "products": [
    { "product_id": "137", "name": "Recover", "category": "IV Therapy", "price": 199.00, "quantity": 1 },
    { "product_id": "154", "name": "Diphenhydramine (IV)", "category": "Add-on", "price": 33.00, "quantity": 1 },
    { "product_id": "155", "name": "Famotidine (IV)", "category": "Add-on", "price": 33.00, "quantity": 1 }
  ],
  "discount": 36.75,
  "tax": 0.00,
  "travel_fee": 59.00,
  "other_items_total": 0.00,
  "package_credit_applied": 0.00,
  "total": 332.25,
  "coupon": "MIAMI10",
  "location_type": "in_home",
  "service_region": "Miami, FL",
  "postal_code": "33131"
}
```

#### Appointment Cancelled

| Property | Type | Presence | Description |
|---|---|---|---|
| `appointment_id` | integer | required | |
| `cancellation_reason` | string | optional | Free text. |
| `cancelled_by` | string enum (`patient`, `practitioner`, `admin`, `system`) | required | |
| `lead_time_to_cancel_hours` | number | required | Hours before the scheduled start. |
| `refund_amount` | number | optional | Cash refunded for **this** cancellation. On a partial group cancel, the group's overpayment after voiding this member's items — not the whole-checkout refund. |
| `is_partial_group_cancel` | boolean | optional | `true` when at least one group sibling survives, so the shared checkout is reduced rather than torn down. |

Also includes: **group context**, **geo block**. An `Order Cancelled`
([Section 6.5](#65-payments--the-money-ledger)) accompanies this event to reverse the
booked value.

```json
{ "appointment_id": 874, "cancellation_reason": "Feeling better", "cancelled_by": "patient", "lead_time_to_cancel_hours": 26.5, "refund_amount": 25.00 }
```

#### Appointment Reset

The appointment returns to `booked` (typically `completed → booked`, an operational
correction). `Appointment Booked` is **not** re-fired. Status-derivation dashboards
should treat the latest lifecycle event as current status.

| Property | Type | Presence | Description |
|---|---|---|---|
| `appointment_id` | integer | required | |
| `previous_status` | string enum (`completed`, `cancelled`) | required | |
| `reset_by` | string enum (`patient`, `practitioner`, `admin`, `system`) | required | |

```json
{ "appointment_id": 874, "previous_status": "completed", "reset_by": "admin" }
```

#### Appointment No Showed

| Property | Type | Presence | Description |
|---|---|---|---|
| `appointment_id` | integer | required | |
| `no_show_by` | string enum (`patient`, `practitioner`) | required | |
| `charged_amount` | number | optional | No-show fee charged, if any. |

Also includes: **geo block**.

```json
{ "appointment_id": 874, "no_show_by": "patient", "charged_amount": 50.00 }
```

### 6.5 Payments & the money ledger

Money moves at different times than lifecycle transitions (a refund weeks after
completion, cash collected on site), so cash is a **separate event ledger**. Rollup
keys differ by event family: **payment events** (`Payment Captured`, `Payment Failed`,
`Payment Collected On Site`) are anchored on the checkout being charged
(`checkout_id` and/or `appointment_id`), while **order events** (`Order Refunded`,
`Order Updated`, `Order Cancelled`) carry `order_id` directly. A checkout maps 1:1 to
its order, and `Order Completed` carries **both** `order_id` and `checkout_id` — use
it as the crosswalk row when rolling payments up to orders. Since plan 2.2, payment
events also carry an optional `order_id` directly; the crosswalk remains for earlier
history and the rare cases where the order can't be resolved at capture time. **Finance
should sum this ledger** — money snapshots on lifecycle events are a convenience, not
for summing.

#### Payment Captured

A charge is accepted.

| Property | Type | Presence | Description |
|---|---|---|---|
| `payment_id` | integer | required | |
| `order_id` | string | optional | Direct rollup to the order (plan 2.2+); omitted when unresolvable — fall back to the `checkout_id` crosswalk. |
| `checkout_id` | integer | required | |
| `appointment_id` | integer | required, nullable | |
| `amount` | number | required | This charge only. |
| `processor` | string | required | `"finix"`. |
| `payment_method` | string enum (`card`, `apple_pay`, `saved_card`, `cash`, `payment_link`) | required | |
| `is_deposit` | boolean | required | |
| `transaction_id` | string | required | Processor transaction reference. |

Also includes: **group context**, **split-payment context**.

```json
{ "order_id": "24382", "payment_id": 9310, "checkout_id": 4201, "appointment_id": 874, "amount": 25.00, "processor": "finix", "payment_method": "card", "is_deposit": true, "transaction_id": "TRg169xL37F4RiSx2yR9UUdB" }
```

#### Payment Failed

| Property | Type | Presence | Description |
|---|---|---|---|
| `payment_id` | integer | required | |
| `order_id` | string | optional | Direct rollup to the order (plan 2.2+); omitted when unresolvable — fall back to the `checkout_id` crosswalk. |
| `checkout_id` | integer | required | |
| `appointment_id` | integer | required, nullable | |
| `amount` | number | required | |
| `failure_reason` | string | optional | |

```json
{ "order_id": "24382", "payment_id": 9311, "checkout_id": 4201, "appointment_id": 874, "amount": 262.25, "failure_reason": "insufficient_funds" }
```

#### Order Refunded

Ecommerce-spec refund event.

| Property | Type | Presence | Description |
|---|---|---|---|
| `order_id` | string | required | |
| `payment_id` | integer | required | |
| `appointment_id` | integer | required, nullable | |
| `refund_amount` | number | required | |
| `refund_type` | string enum (`full`, `full_minus_deposit`, `custom`) | required | |
| `reason` | string | optional | |

Also includes: **group context** (`is_group_appointment`, `group_id`).

```json
{ "order_id": "24382", "payment_id": 9310, "appointment_id": 874, "refund_amount": 25.00, "refund_type": "full", "reason": "Cancelled >24h ahead" }
```

#### Order Updated

The order's booked value changed after `Order Completed` — services changed on site,
line items edited, or a pending request repriced. Carries the resulting basket and full
breakdown (a self-contained restatement), plus the previous amounts.

| Property | Type | Presence | Description |
|---|---|---|---|
| `order_id` | string | required | |
| `appointment_id` | integer | required, nullable | |
| `checkout_id` | integer | required | |
| `revenue` / `total` | number | required | New amounts. |
| `previous_revenue` / `previous_total` | number | required | |
| `change_set` | string[] | required | What changed. |
| `products[]` | array | required | The new basket. |

Also includes: the remaining **price breakdown** fields, **group context**.

```json
{
  "order_id": "24382", "appointment_id": 874, "checkout_id": 4201,
  "revenue": 357.00, "total": 320.25, "previous_revenue": 324.00, "previous_total": 287.25,
  "change_set": ["procedures"],
  "products": [
    { "product_id": "137", "name": "Recover", "category": "IV Therapy", "price": 199.00, "quantity": 1 },
    { "product_id": "154", "name": "Diphenhydramine (IV)", "category": "Add-on", "price": 33.00, "quantity": 1 },
    { "product_id": "155", "name": "Famotidine (IV)", "category": "Add-on", "price": 33.00, "quantity": 1 },
    { "product_id": "161", "name": "Zofran (IV)", "category": "Add-on", "price": 33.00, "quantity": 1 }
  ],
  "discount": 36.75, "tax": 0.00, "gratuity_amount": 0.00, "travel_fee": 59.00,
  "other_items_total": 0.00, "package_credit_applied": 0.00, "coupon": "MIAMI10"
}
```

#### Order Cancelled

The order is terminally cancelled before delivery (request rejected or cancelled, or
appointment cancelled) — reverses the booked value. A replacement booking is always a
**new** order (new `order_id`, new `Order Completed`).

| Property | Type | Presence | Description |
|---|---|---|---|
| `order_id` | string | required | |
| `appointment_id` | integer | optional, nullable | |
| `revenue` | number | required | Booked value being reversed. Whole-group total on a full group cancel; the departing member's subtotal on a partial one. |
| `cancellation_stage` | string enum (`request`, `appointment`) | required | |
| `reason` | string | optional | |

Also includes: **group context** (`is_group_appointment`, `group_id`).

```json
{ "order_id": "24382", "appointment_id": 874, "revenue": 324.00, "cancellation_stage": "appointment", "reason": "Feeling better" }
```

#### Payment Collected On Site

Cash or payment link collected at the visit.

| Property | Type | Presence | Description |
|---|---|---|---|
| `appointment_id` | integer | required | |
| `order_id` | string | optional | Direct rollup to the order (plan 2.2+); omitted when unresolvable — fall back to the `checkout_id` crosswalk. |
| `amount` | number | required | |
| `payment_method` | string enum (`cash`, `payment_link`) | required | |

Also includes: **group context**, **split-payment context**.

```json
{ "order_id": "24382", "appointment_id": 874, "amount": 307.25, "payment_method": "payment_link" }
```

#### Travel Fee Applied

| Property | Type | Presence | Description |
|---|---|---|---|
| `appointment_id` | integer | required | |
| `checkout_id` | integer | required | |
| `travel_fee` | number | required | |
| `distance_band` | string | optional | |

```json
{ "appointment_id": 874, "checkout_id": 4201, "travel_fee": 59.00, "distance_band": "10-20mi" }
```

#### Payout Sent

Provider/organization payout. Keyed at the organization level.

| Property | Type | Presence | Description |
|---|---|---|---|
| `payout_id` | integer | required | |
| `organization_id` | integer | required | |
| `amount` | number | required | |
| `status` | string | required | |

```json
{ "payout_id": 512, "organization_id": 15, "amount": 4180.00, "status": "sent" }
```

### 6.6 Memberships & packages

Membership lifecycle events anchor on the **account's status transitions** (what state
the membership is in), while money stays anchored on charges. Standalone purchases and
renewals also emit an ecommerce `Order Completed` (`order_id` `membership_<id>` /
`package_<id>`) so subscription revenue reaches ad and analytics destinations —
memberships bought inside a booking checkout stay line items on that booking's order.

#### Membership Started

The membership becomes active on the account — regardless of charge outcome (an admin
can assign a membership with a balance owed; `charged_at_start` tells you which case).

| Property | Type | Presence | Description |
|---|---|---|---|
| `membership_id` | integer | required | |
| `membership_definition_id` | integer | required | |
| `membership_name` | string | required | |
| `membership_period` | string enum (`monthly`, `quarterly`, `yearly`) | required | |
| `price` | number | required | |
| `is_first_membership` | boolean | required | |
| `charged_at_start` | boolean | required | `false` for admin assignment with deferred payment. |
| `created_via` | string enum (`consumer_checkout`, `dispatch_admin`, `mobile_field`, `api`) | required | |
| `package_id` | integer | optional | The credit package granted by this cycle, where the membership grants credits. |
| `credits_granted` | number | optional | |
| `credits_expire_at` | datetime | optional | |

```json
{
  "membership_id": 208, "membership_definition_id": 12,
  "membership_name": "Hydration Club", "membership_period": "monthly",
  "price": 99.00, "is_first_membership": true, "charged_at_start": true,
  "created_via": "consumer_checkout",
  "package_id": 3301, "credits_granted": 100, "credits_expire_at": "2026-06-26T00:00:00.000Z"
}
```

#### Membership Renewed

A recurring charge succeeds; the cycle's credits (if any) are granted. The grant is
fulfillment of the membership charge — it never emits `Package Purchased` or a second
order.

| Property | Type | Presence | Description |
|---|---|---|---|
| `membership_id` | integer | required | |
| `renewal_number` | integer | required | |
| `amount` | number | required | |
| `package_id` | integer | optional | |
| `credits_granted` | number | optional | |
| `credits_expire_at` | datetime | optional | |

```json
{ "membership_id": 208, "renewal_number": 2, "amount": 99.00, "package_id": 3388, "credits_granted": 100, "credits_expire_at": "2026-07-26T00:00:00.000Z" }
```

#### Membership Charge Failed

| Property | Type | Presence | Description |
|---|---|---|---|
| `membership_id` | integer | required | |
| `attempt` | integer | required | Dunning attempt number. |
| `failure_reason` | string | optional | |

```json
{ "membership_id": 208, "attempt": 1, "failure_reason": "card_expired" }
```

#### Membership Cancelled

Any transition to cancelled/expired — customer cancel, admin cancel, dunning
exhaustion, expiry.

| Property | Type | Presence | Description |
|---|---|---|---|
| `membership_id` | integer | required | |
| `cancelled_by` | string enum (`patient`, `practitioner`, `admin`, `system`) | required | `system` = dunning/expiry. |
| `reason` | string | optional | |
| `tenure_days` | integer | required | |

```json
{ "membership_id": 208, "cancelled_by": "system", "reason": "dunning_exhausted", "tenure_days": 117 }
```

#### Package Purchased

A prepaid credit package is bought (standalone; membership-granted credits ride the
membership events instead).

| Property | Type | Presence | Description |
|---|---|---|---|
| `package_id` | integer | required | |
| `credits` | number | required | |
| `amount` | number | required | |

```json
{ "package_id": 3402, "credits": 500, "amount": 450.00 }
```

#### Package Credit Redeemed

Credit applied to a checkout — the burn side of the credit ledger.

| Property | Type | Presence | Description |
|---|---|---|---|
| `package_id` | integer | required | |
| `credits_used` | number | required | |
| `credits_remaining` | number | required | |

```json
{ "package_id": 3402, "credits_used": 100, "credits_remaining": 400 }
```

### 6.7 Provider & operations

The supply-side funnel: a pending request is **offered** to candidate practitioners,
who **accept** or **decline**; acceptance **assigns** the appointment. `Appointment
Offered` is keyed to the requesting patient; `Accepted`/`Declined` are keyed to the
responding practitioner (`usr_…`).

#### Appointment Offered

A pending request is dispatched to candidate practitioners. Fires **once per dispatch
round** (each escalation wave is a new round). No-response is the absence of a response
before the round closes — there is no separate "no response" event.

| Property | Type | Presence | Description |
|---|---|---|---|
| `appointment_request_id` | integer | required | |
| `request_status` | string enum (`pending`) | required | |
| `dispatch_round` | integer | required | 1-based wave counter per request. |
| `rank` | integer | optional | Provider rank tier targeted this wave, where rank-based dispatch is used. |
| `offer_count` | integer | required | Candidate practitioners offered this round. |
| `practitioner_profile_ids` | integer[] | required | The candidate pool — the per-practitioner denominator for accept/decline rates. |
| `practitioner_user_ids` | string[] | optional | `usr_…` per candidate, position-aligned with `practitioner_profile_ids` (`null` where a profile has no login). |
| `organization_count` | integer | optional | Distinct organizations in the pool. |

```json
{
  "appointment_request_id": 24382, "request_status": "pending",
  "dispatch_round": 1, "rank": 1, "offer_count": 3,
  "practitioner_profile_ids": [65, 71, 88],
  "practitioner_user_ids": ["usr_31", "usr_44", null],
  "organization_count": 2
}
```

#### Appointment Request Accepted

A practitioner accepts. Keyed to the practitioner.

| Property | Type | Presence | Description |
|---|---|---|---|
| `appointment_request_id` | integer | required | |
| `practitioner_profile_id` | integer | required | |
| `dispatch_round` | integer | optional | The wave this acceptance belongs to. |
| `time_to_accept_minutes` | number | required | Minutes from the offer reaching providers to acceptance. |

```json
{ "appointment_request_id": 24382, "practitioner_profile_id": 65, "dispatch_round": 1, "time_to_accept_minutes": 54 }
```

#### Appointment Request Declined

Fires per declining practitioner. Keyed to the practitioner.

| Property | Type | Presence | Description |
|---|---|---|---|
| `appointment_request_id` | integer | required | |
| `practitioner_profile_id` | integer | required | |
| `offers_outstanding` | integer | required | Candidate offers still pending **after** this decline; `0` = the round is exhausted. |
| `dispatch_round` | integer | optional | |
| `reason` | string | optional | |

```json
{ "appointment_request_id": 24382, "practitioner_profile_id": 88, "offers_outstanding": 2, "dispatch_round": 1, "reason": "outside service area" }
```

#### Appointment Assigned

| Property | Type | Presence | Description |
|---|---|---|---|
| `appointment_id` | integer | required | |
| `practitioner_profile_id` | integer | required | |
| `practitioner_user_id` | string | optional | |
| `assigned_by` | string enum (`patient`, `practitioner`, `admin`, `system`) | required | |

```json
{ "appointment_id": 874, "practitioner_profile_id": 65, "practitioner_user_id": "usr_31", "assigned_by": "practitioner" }
```

#### Chart Note Saved

An assessment or intervention form is saved during a visit. **Carries no clinical
content** — it is an activity signal only.

| Property | Type | Presence | Description |
|---|---|---|---|
| `appointment_id` | integer | required | |
| `form_type` | string enum (`assessment`, `intervention`) | required | |
| `has_content` | boolean | required | |

```json
{ "appointment_id": 874, "form_type": "assessment", "has_content": true }
```

#### Availability Updated

Any practitioner availability create/edit/delete.

| Property | Type | Presence | Description |
|---|---|---|---|
| `practitioner_profile_id` | integer | required | |
| `organization_id` | integer | required | |
| `change_type` | string enum (`added`, `removed`, `modified`) | required | |
| `hours_added` | number | required | |
| `hours_removed` | number | required | |
| `is_recurring` | boolean | required | |
| `repeat_until_at` | datetime | optional, nullable | End of the recurrence — present only when `is_recurring` is `true`; `null` = repeats indefinitely. |
| `effective_from_at` | datetime | required | |

```json
{ "practitioner_profile_id": 65, "organization_id": 15, "change_type": "added", "hours_added": 8, "hours_removed": 0, "is_recurring": true, "repeat_until_at": "2026-09-01T00:00:00.000Z", "effective_from_at": "2026-06-01T13:00:00.000Z" }
```

### 6.8 Configuration

Admin/catalog changes on your marketplace. Keyed to the acting staff user.

#### Promo Code Created

| Property | Type | Presence | Description |
|---|---|---|---|
| `coupon_id` | string | required | |
| `discount_type` | string | required | |
| `value` | number | required | |

```json
{ "coupon_id": "MIAMI10", "discount_type": "percent", "value": 10 }
```

#### Integration Updated

A marketplace integration setting changed — including this Segment integration itself,
so your workspace has an audit trail of its own configuration.

| Property | Type | Presence | Description |
|---|---|---|---|
| `integration` | string | required | |
| `enabled` | boolean | required | |
| `changed_by` | string | required | |

```json
{ "integration": "segment", "enabled": true, "changed_by": "admin@ivdemo.example.com" }
```

#### Procedure Published

| Property | Type | Presence | Description |
|---|---|---|---|
| `product_id` | string | required | |
| `is_active` | boolean | required | |
| `price` | number | required | |

```json
{ "product_id": "161", "is_active": true, "price": 33.00 }
```

## 7. Browser events (checkout-web)

The browser stream instruments the **on-site booking funnel** in checkout-web. It flows
to a **second, JavaScript source** in your workspace (separate write key) and carries
the same conventions, envelope (`context.source: "client"`), and identity model. The
pre-auth funnel fires under an `anonymousId`; sign-in stitches it to the `mu_…` identity
via `identify` + `alias`.

> The browser stream is **per-brand opt-in**: create the JavaScript source in your
> workspace and add its write key in your NomadMD integration settings. Until the key
> is set, no browser events are emitted for your brand.

### 7.1 `page`

Fires on each funnel route change.

| Property | Type | Presence | Description |
|---|---|---|---|
| `name` | string enum (`Location`, `Services`, `Schedule`, `Confirm`, `Success`) | required | |
| `marketplace_id` | integer | required | |

### 7.2 Funnel events

**About `checkout_session_id`:** the browser mints a UUID when the confirmation step
loads and stamps it on every checkout event; it is passed through booking submission,
so the server `Order Completed` carries the same value — joining the anonymous funnel
to the money.

#### Marketplace Opened

First route hit for your brand in a session.

| Property | Type | Presence | Description |
|---|---|---|---|
| `entry_path` | string | required | |
| `referrer` | string | optional | |
| `utm_source` / `utm_medium` / `utm_campaign` / `utm_term` / `utm_content` | string | optional | |
| `is_returning_visitor` | boolean | required | |

```json
{ "entry_path": "/services?utm_source=meta", "referrer": "https://m.facebook.com/", "utm_source": "meta", "utm_medium": "paid_social", "utm_campaign": "summer-hydration", "is_returning_visitor": false }
```

#### Service List Viewed — *(ecommerce: Product List Viewed)*

| Property | Type | Presence | Description |
|---|---|---|---|
| `list_id` | string | required | Always `"services"`. |
| `products[]` | array | required | `product_id`, `name`, `category`, `price` per item. |
| `product_count` | integer | required | |

```json
{ "list_id": "services", "product_count": 14, "products": [ { "product_id": "137", "name": "Recover", "category": "IV Therapy", "price": 199.00 } ] }
```

#### Location Selected

| Property | Type | Presence | Description |
|---|---|---|---|
| `location_type` | string enum (`in_home`, `in_clinic`) | required | |
| `service_region` | string | optional | |
| `postal_code` | string | optional | |
| `was_skipped` | boolean | required | |

```json
{ "location_type": "in_home", "service_region": "Miami, FL", "postal_code": "33131", "was_skipped": false }
```

#### Service Viewed — *(ecommerce: Product Viewed)*

| Property | Type | Presence | Description |
|---|---|---|---|
| `product_id` | string | required | |
| `name` | string | required | |
| `category` | string | optional | |
| `price` | number | required | |
| `add_on_count` | integer | optional | |

```json
{ "product_id": "137", "name": "Recover", "category": "IV Therapy", "price": 199.00, "add_on_count": 6 }
```

#### Service Added — *(ecommerce: Product Added)*

| Property | Type | Presence | Description |
|---|---|---|---|
| `product_id` | string | required | |
| `name` | string | required | |
| `category` | string | optional | |
| `price` | number | required | |
| `quantity` | integer | required | |
| `add_on_ids` | string[] | optional | |
| `cart_value` | number | required | Selection value after the add. |
| `cart_size` | integer | required | |

```json
{ "product_id": "137", "name": "Recover", "category": "IV Therapy", "price": 199.00, "quantity": 1, "add_on_ids": ["154", "155"], "cart_value": 265.00, "cart_size": 1 }
```

#### Service Removed — *(ecommerce: Product Removed)*

| Property | Type | Presence | Description |
|---|---|---|---|
| `product_id` | string | required | |
| `cart_value` | number | required | |
| `cart_size` | integer | required | |

```json
{ "product_id": "137", "cart_value": 0.00, "cart_size": 0 }
```

#### Availability Viewed

Slots load on the scheduling step. `has_availability: false` rows are your supply-gap
signal.

| Property | Type | Presence | Description |
|---|---|---|---|
| `product_ids` | string[] | required | |
| `date_range_start_at` | datetime | optional | |
| `slot_count` | integer | required | |
| `has_availability` | boolean | required | |

```json
{ "product_ids": ["137", "154", "155"], "date_range_start_at": "2026-05-27T00:00:00.000Z", "slot_count": 22, "has_availability": true }
```

#### Time Slot Selected

Specific-time booking mode.

| Property | Type | Presence | Description |
|---|---|---|---|
| `booking_mode` | string | required | Always `"specific_time"`. |
| `scheduled_start_at` | datetime | required | |
| `lead_time_days` | number | required | |

```json
{ "booking_mode": "specific_time", "scheduled_start_at": "2026-05-28T20:00:00.000Z", "lead_time_days": 2.0 }
```

#### Waitlist Selected

Window booking mode.

| Property | Type | Presence | Description |
|---|---|---|---|
| `booking_mode` | string | required | Always `"window"`. |
| `window_count` | integer | required | |
| `times_of_day` | string[] | required | |

```json
{ "booking_mode": "window", "window_count": 2, "times_of_day": ["morning", "afternoon"] }
```

#### Checkout Started — *(ecommerce)*

The confirmation step is reached; `checkout_session_id` is minted here.

| Property | Type | Presence | Description |
|---|---|---|---|
| `checkout_session_id` | string (UUID) | required | |
| `value` | number | required | |
| `products[]` | array | required | |
| `product_count` | integer | required | |
| `currency` | string | required | `"USD"`. |
| `booking_mode` | string enum (`specific_time`, `window`) | required | |

```json
{
  "checkout_session_id": "3f1c9d3a-4a5b-4a83-9a4e-2d1f0a6b7c88",
  "value": 265.00,
  "products": [
    { "product_id": "137", "name": "Recover", "category": "IV Therapy", "price": 199.00, "quantity": 1, "add_on_ids": ["154", "155"] }
  ],
  "product_count": 1,
  "currency": "USD",
  "booking_mode": "specific_time"
}
```

#### Checkout Step Viewed / Checkout Step Completed — *(ecommerce)*

| Property | Type | Presence | Description |
|---|---|---|---|
| `checkout_session_id` | string | required | |
| `step` | integer | required | |
| `step_name` | string | required | |

```json
{ "checkout_session_id": "3f1c9d3a-4a5b-4a83-9a4e-2d1f0a6b7c88", "step": 2, "step_name": "payment" }
```

#### Sign In Started / Passcode Requested / Passcode Submitted

Auth flow signals.

| Event | Properties |
|---|---|
| `Sign In Started` | `method_options` (string[], required) |
| `Passcode Requested` | `method` (string, required — always `"passcode"`) |
| `Passcode Submitted` | `method` (string, required), `succeeded` (boolean, required) |

```json
{ "method": "passcode", "succeeded": true }
```

#### Coupon Entered / Coupon Applied / Coupon Denied — *(ecommerce)*

| Event | Properties |
|---|---|
| `Coupon Entered` | `checkout_session_id`, `coupon_id` (both required) |
| `Coupon Applied` | + `discount` (number, required) |
| `Coupon Denied` | + `reason` (string, required) |

```json
{ "checkout_session_id": "3f1c9d3a-4a5b-4a83-9a4e-2d1f0a6b7c88", "coupon_id": "MIAMI10", "discount": 36.75 }
```

#### Membership Viewed / Membership Added

The membership upsell shown / selected into the order.

| Property | Type | Presence | Description |
|---|---|---|---|
| `membership_definition_id` | integer | required | |
| `membership_name` | string | required | |
| `membership_price` | number | required | |
| `membership_period` | string enum (`monthly`, `quarterly`, `yearly`) | required | |

```json
{ "membership_definition_id": 12, "membership_name": "Hydration Club", "membership_price": 99.00, "membership_period": "monthly" }
```

#### Gratuity Added

| Property | Type | Presence | Description |
|---|---|---|---|
| `gratuity_type` | string enum (`percent`, `custom`) | required | |
| `gratuity_value` | number | required | The percent or the custom amount entered. |
| `gratuity_amount` | number | required | Resulting dollars. |

```json
{ "gratuity_type": "percent", "gratuity_value": 15, "gratuity_amount": 45.00 }
```

#### Payment Info Entered — *(ecommerce)*

| Property | Type | Presence | Description |
|---|---|---|---|
| `checkout_session_id` | string | required | |
| `payment_method` | string enum (`card`, `apple_pay`, `saved_card`) | required | |
| `is_saved_instrument` | boolean | required | |

```json
{ "checkout_session_id": "3f1c9d3a-4a5b-4a83-9a4e-2d1f0a6b7c88", "payment_method": "card", "is_saved_instrument": false }
```

#### Client emissions of dual-stream events

`Signed In`, `Account Created`, `Order Completed`, and `Checkout Failed` are also
emitted from the browser, with the same property shapes as their server
twins ([Section 6](#6-server-events-available-now)) and `context.source: "client"`. The
client `Order Completed` carries a non-null `checkout_session_id`. See Section 8 for
how to combine the two copies.

### 7.3 Your marketing site & cross-domain attribution

Most brands run a separate marketing site that links into the booking flow. Three
mechanisms cover attribution, and they solve different problems:

- **Campaign attribution — built in.** `Marketplace Opened` captures `entry_path`,
  `referrer`, and all `utm_*` parameters (analytics.js also records UTMs in
  `context.campaign`). Tag your links into the booking flow and campaign reporting
  works with no additional setup. Note that UTMs attribute the *visit* to a
  campaign — they do not merge sessions.
- **Session-level stitching.** `anonymousId` is a first-party value. If your
  marketing site and the booking flow are subdomains of the same registered domain
  and your marketing site also runs Segment analytics.js, the `ajs_anonymous_id`
  cookie is shared automatically and the ids simply match. Across *different*
  registered domains, decorate outbound booking links with `ajs_aid=<anonymousId>`
  from your marketing site's analytics.js — the booking flow's analytics.js adopts
  the id, and the two sources join on `anonymousId` downstream.
- **Person-level stitching.** Sign-in emits `identify(mu_…)` +
  `alias(anonymousId → mu_…)`, so once a visitor authenticates, their pre-auth
  funnel joins their identity regardless of where the session started. Email-keyed
  resolution (Segment Unify, or your warehouse) bridges to your marketing site's
  own identified users.

You do **not** install NomadMD's tracker on your marketing site — it is built into
the booking flow and keyed per marketplace. Instrument your marketing site with your
own analytics.js source in the same workspace and stitch as above. Ad-platform
attribution is independent of all of this: pixels use their own cookies and click
ids (`fbclid`, `gclid`, `ttclid`) via GTM, and server conversions deduplicate on
`order_id`.

## 8. Dual-stream events & deduplication

Four events arrive on **both** streams when the browser stream is enabled:
`Order Completed`, `Checkout Failed`, `Signed In`, `Account Created`.

- Both copies of an order event carry the same **`order_id`** — the dedup key.
- Use `context.source` to pick a side per concern: the **server** row for money (exact,
  authoritative) and the **client** row for attribution (device, UTM, anonymousId).
- For **ad platforms**: `order_id` doubles as the conversion `event_id` on every
  delivery path (Meta CAPI ↔ pixel, TikTok, GA4 `transaction_id`), so browser and
  server deliveries of the same conversion deduplicate at the platform. Standalone
  membership/package orders have no browser twin — they reach ad platforms via the
  server path only.
- **Segment catalog naming for Google:** the server-side GA4 destination is listed as
  **"Google Analytics 4 Cloud"** — that is the Measurement Protocol delivery. For
  **Google Ads**, the default path is your GA4 ↔ Google Ads link (import the
  `purchase` key event); the browser copy of the purchase carries the session/click
  context Google's attribution needs. Segment's separate "Google Ads Conversions"
  destination is an optional upgrade that additionally requires click-id (`gclid`) or
  enhanced-conversions identifier configuration.

## 9. Delivery semantics

- **Near real time, server-side.** Events are emitted as state changes occur, batched
  by the Segment SDK, with retries handled by Segment's standard delivery behavior.
- **Ordering is not guaranteed** across events. Use Segment's `timestamp` (and the
  explicit lifecycle events) rather than arrival order.
- **Duplicates are possible but rare** (at-least-once delivery). Order events carry
  `order_id` for exact dedup; other events dedup acceptably on
  (`event`, primary id, `timestamp`).
- **No backfill.** Events flow from enablement forward; there is no replay of history.
  Note that the derived fields (`prior_appointment_count`, `lifetime_*`,
  `is_new_customer`) **do** incorporate platform history from before your enablement,
  so newness/repeat analysis is correct from day one.
- **Misconfiguration fails safe.** If v2 is disabled or the write key is missing, events
  are silently dropped (not queued).

## 10. Data protection

- **Your brand's activity only.** Your workspace never receives another brand's events,
  and every derived metric (`prior_appointment_count`, `lifetime_appointments`,
  `lifetime_revenue`, `is_new_customer`) is computed **within your brand only**. This
  isolation is enforced structurally in the emitting code, not by a filter.
- **PII lives in `identify` traits only** (email, phone, name, birthday). Track-event
  payloads carry codes, ids, booleans, counts, and money — plus **coarse geography
  only** (`service_region`, `postal_code`; never a street address).
- **No clinical content, ever, on the v2 stream.** `Appointment Completed` carries a
  `has_chart_notes` boolean and `Chart Note Saved` carries form type and a
  `has_content` flag — never note bodies, form values, or any PHI free text. (The
  legacy integration's flag-gated chart-note export is a legacy-only capability.)
- **Free-text fields are minimized.** Cancellation reasons are the main free-text
  property; treat them as potentially patient-provided text.
- **Browser ad pixels belong in your GTM container, not on the Segment source.** The
  Segment JS source carries the full analytics payload; enabling *device-mode* ad
  destinations (Meta Pixel, TikTok Pixel, gtag) directly on it would deliver that
  full payload — including catalog data — to those platforms. Route browser pixels
  through GTM, which receives the separately scrubbed stream
  ([dataLayer reference](gtm-datalayer-reference.md)); treat any device-mode ad
  destination as the same counsel-informed decision as the `commerce` data tier.
- Once events land in your workspace, handling is governed by **your** BAA coverage and
  destination configuration — review connected destinations accordingly.

---

*Questions, help importing the tracking plan, or a dual-run validation window:
support@nomadmd.app.*
