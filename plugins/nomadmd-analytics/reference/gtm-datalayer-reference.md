# checkout-web dataLayer Reference (GTM / Tier 2)

> What NomadMD's checkout pushes to `window.dataLayer` for brand GTM containers and the
> pixels they load. Source of truth: `.telemetry/client-architecture.md` §5–§6.
> **Status:** shipped. Active for brands with a GTM container configured (consent and
> data-tier flags apply).

## How it works

- Every push carries the **envelope**: `event` (the name below), `marketplace_id`,
  `schema_version` — plus only the fields listed in its row. Nothing else ever appears.
- **Consent:** pushes (and GTM container injection itself) are gated on marketing consent
  unless the marketplace is grandfathered (`gtm_requires_consent = false`, the default for
  existing brands — current behavior preserved). Brands collecting consent on their own
  marketing site can pass the decision across domains with a signed token, so checkout
  shows no second banner — see the
  [cross-domain consent token spec](consent-token-spec.md).
- **Scrubbed by construction:** the payload builders for this layer physically contain no
  other fields — exclusion isn't a filter that can regress (see "What is never in the
  dataLayer" below).

## Events pushed to the dataLayer

| `event` | Fires when | Payload (beyond envelope) | Typical tag mapping |
|---|---|---|---|
| `page_view` | every route change (SPA) | `route_name` (`Location`/`Services`/`Schedule`/`Confirm`/`Success`) | PageView / virtual pageview |
| `Marketplace Opened` | first route of a session for the brand | `entry_path`, `is_returning_visitor` | landing / session start |
| `Service List Viewed` | the services catalog renders | `product_count` (count only) | catalog view |
| `Service Viewed` | a service's detail dialog opens | *(none — signal only)* | ViewContent |
| `Service Added` | service added to the selection | `value` (= cart value), `currency`, `cart_size` | AddToCart |
| `Service Removed` | service removed | `value`, `currency`, `cart_size` | RemoveFromCart |
| `Checkout Started` | `/confirm` reached | `value`, `currency`, `checkout_session_id` | InitiateCheckout |
| `Checkout Step Viewed` | each checkout wizard step shown | `step` | funnel step |
| `Checkout Step Completed` | each wizard step completed | `step` | funnel step |
| `Account Created` | new account registered | *(none — signal only)* | CompleteRegistration |
| `Payment Info Entered` | payment method set | `checkout_session_id` | AddPaymentInfo |
| `Order Completed` | booking submitted successfully | `value` (= **revenue**: services + travel fee, excl. tip/tax), `currency`, `order_id`, `event_id` (= `order_id`), `checkout_session_id` | **Purchase** |

## Dedup with server-side conversions

Brands also receiving server conversions (Meta CAPI / TikTok Events API / GA4 MP from
their Segment workspace) must configure pixel tags to send **`event_id = order_id`**
(GA4: `transaction_id = order_id`) on Purchase — the platforms then dedupe the browser
and server deliveries of the same order. `value` uses the same revenue definition on
both paths, so deduped values match.

## Commerce tier — the opt-in for retail-like brands

The table above is the **`minimal`** tier, the default. Brands whose catalog is
retail-like (wellness, aesthetics) can opt into the **`commerce`** tier — a per-brand
flag on the integrations admin page (the change is logged). Everything in `minimal`,
plus catalog data:

| `event` | Commerce tier adds | Unlocks |
|---|---|---|
| `Service List Viewed` | `products[]` (`product_id`, `name`, `category`, `price`) | GA4 `view_item_list` |
| `Service Viewed` | `product_id`, `name`, `category`, `price` | real ViewContent with `content_id` — catalog/dynamic ads |
| `Service Added` / `Removed` | `product_id`, `name`, `category`, `price` | item-level AddToCart, DPA retargeting |
| `Checkout Started` | `products[]` | GA4 `begin_checkout` items |
| `Order Completed` | `products[]` (+ `quantity`) | GA4 ecommerce item reports, Meta `content_ids` for Dynamic Product Ads |
| `Membership Viewed` / `Added` | newly routed: `membership_definition_id`, `membership_name`, `membership_price` | membership upsell signals |

The opt-in is the brand's call with their counsel: it sends the service catalog
(item names/prices) to whatever pixels their container loads. What it does **not**
change is below — identity and geo are impossible in both tiers.

## What is **never** in the dataLayer — either tier

By construction — these fields do not exist in this layer's payload builders, and a CI
guard proves it on every build:

- **No identity**: no email, phone, names, user ids, anonymous ids. Pixels match via
  their own first-party cookies; richer matching happens server-side from the brand's
  Segment workspace, never here. The person×procedure combination cannot be assembled
  from this layer under any configuration.
- **No geo**: no address, region, or postal code.
- **No clinical anything** (none exists client-side at all).
- On the default `minimal` tier, additionally **no service/procedure data** — names,
  ids, categories, line items, add-ons.

## Starter container template (one-import setup)

Two pre-built GTM containers matching this reference are published alongside it —
[`gtm-container-template.json`](gtm-container-template.json) (the default `minimal`
tier) and [`gtm-container-template.commerce.json`](gtm-container-template.commerce.json)
(for brands opted into the `commerce` tier). The minimal template contains, pre-wired
to the dataLayer events above:

- **GA4** (native tags): Google tag config, `page_view`, `view_item_list`,
  `add_to_cart`, `remove_from_cart`, `begin_checkout`, `add_payment_info`, `sign_up`,
  and `purchase` with **`transaction_id = order_id`** already mapped.
- **Meta Pixel**: base code, AddToCart, InitiateCheckout, AddPaymentInfo,
  CompleteRegistration, and Purchase with **`eventID = event_id`** already mapped
  (dedupes against Conversions API from your Segment workspace).
- **TikTok Pixel**: base code plus the same funnel events, with **`event_id`** on
  CompletePayment (dedupes against Events API).

To install:

1. GTM → Admin → **Import Container** → choose the file → select (or create) a
   workspace → **Merge** (choose *Rename conflicting*) if your container already has
   tags, or *Overwrite* on a fresh container.
2. Set the three constant variables: **GA4 Measurement ID**, **Meta Pixel ID**,
   **TikTok Pixel ID** (they ship as `REPLACE_ME`).
3. **Every tag ships paused** so the import is inert. Unpause only the platform
   groups you use, after setting their IDs.
4. Validate in **Preview mode** against your booking flow before publishing: walk a
   test booking and confirm the funnel tags fire on the matching dataLayer events and
   Purchase carries `event_id`/`transaction_id`.
5. If your container already fires pixels from its own triggers, remove the duplicates
   — otherwise Purchase can double-fire (the `event_id` dedup protects Meta/TikTok/GA4,
   but funnel signals have no dedup key).

The minimal template sends **value-only signals** (no item or procedure data). The
**commerce template** is a superset: it adds the transform variables that reshape the
dataLayer's `products[]` into each platform's item format (GA4 `items[]`, Meta
`content_ids`/`contents`, TikTok `contents`), a `Service Viewed`/ViewContent trigger,
and item-level variants of the GA4/Meta/TikTok tags. Import it **only** for brands
whose `gtm_data_tier` is `commerce` — on a `minimal`-tier brand its item fields are
simply empty.

## Events deliberately NOT routed to the dataLayer

Tier-1 analytics only (the brand's Segment workspace receives them; GTM does not):
`Location Selected`, `Availability Viewed`, `Time Slot Selected`, `Waitlist Selected`,
`Sign In Started`, `Passcode Requested`, `Passcode Submitted`, `Signed In`,
`Coupon Entered`, `Coupon Applied`, `Coupon Denied`, `Membership Viewed`,
`Membership Added`, `Gratuity Added`, `Checkout Failed`.

Routing an additional event to this layer is a **code change** reviewed against
`.telemetry/client-architecture.md` §6 — not a config flip.
