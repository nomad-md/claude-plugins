# Warehouse crosswalk SQL templates

Templates for Strategy B (migration guide §3.5) and the dual-run reconciliation
queries (§6.3, §7 phase 2). Adapt schema names before running: `legacy_source` /
`v2_source` are the Segment-synced schemas for the brand's two sources.

Segment warehouse sync snake-cases trait/property names into columns: legacy trait
`clientProfielId` → column `client_profiel_id` (the typo is in the data — keep it),
`appointmentId` → `appointment_id`, `paidAmount` → `paid_amount`. Verify actual column
names in the brand's warehouse before shipping queries; older syncs can differ.

## Identity crosswalk — one row per (legacy user, v2 user)

Join on **profile id first, email second** (email-only joins inherit legacy's
shared-email collapse and miss email changes). Expect 1-to-many: one v2 account can
map to several legacy users.

### BigQuery / Snowflake (QUALIFY)

```sql
create or replace table analytics.nmd_identity_crosswalk as
with v2_users as (
  select user_id as v2_user_id,            -- 'mu_123' / 'cp_456'
         email,
         client_profile_id,
         client_profile_ids
  from v2_source.identifies
  qualify row_number() over (partition by user_id order by received_at desc) = 1
),
legacy_users as (
  select user_id as legacy_user_id,        -- the email address
         client_profiel_id                 -- legacy trait (typo is in the data)
  from legacy_source.identifies
  qualify row_number() over (partition by user_id order by received_at desc) = 1
)
select l.legacy_user_id, v.v2_user_id, v.client_profile_id
from legacy_users l
join v2_users v
  -- prefer the stable profile-id join; fall back to email
  on l.client_profiel_id = v.client_profile_id
  or (l.client_profiel_id is null and l.legacy_user_id = v.email);
```

### Redshift / Postgres (no QUALIFY — row_number subquery)

```sql
create table analytics.nmd_identity_crosswalk as
with v2_ranked as (
  select user_id, email, client_profile_id, client_profile_ids,
         row_number() over (partition by user_id order by received_at desc) as rn
  from v2_source.identifies
),
legacy_ranked as (
  select user_id, client_profiel_id,
         row_number() over (partition by user_id order by received_at desc) as rn
  from legacy_source.identifies
)
select l.user_id as legacy_user_id, v.user_id as v2_user_id, v.client_profile_id
from legacy_ranked l
join v2_ranked v
  on v.rn = 1
 and (l.client_profiel_id = v.client_profile_id
      or (l.client_profiel_id is null and l.user_id = v.email))
where l.rn = 1;
```

## Shared-email audit (run before Strategy C merging)

Finds legacy's shared-email collapse — one email holding several patients:

```sql
select email, count(distinct client_profile_id) as profiles
from v2_source.identifies
group by email
having count(distinct client_profile_id) > 1
order by profiles desc;
```

## Dual-run reconciliation

### Booking counts — dedupe legacy by `appointment_id`

Legacy `Appointment Booked` re-fires on visit start and reset; raw counts run high:

```sql
select
  (select count(distinct appointment_id) from legacy_source.appointment_booked
   where received_at >= :window_start) as legacy_bookings,
  (select count(*) from v2_source.appointment_booked
   where received_at >= :window_start) as v2_bookings;
```

### Money — legacy `revenue` reconciles to v2 `total`, per appointment

Legacy `revenue` = everything on the checkout including gratuity ≙ v2 `total`
(v2 `revenue` excludes gratuity/tax by design — do not compare it to legacy). Join on
`appointment_id`; take each side's **last** money statement (legacy re-sent snapshots;
v2 restates on `Order Updated` / `Appointment Completed`):

```sql
with legacy_last as (
  select appointment_id, revenue as legacy_total, paid_amount,
         row_number() over (partition by appointment_id order by received_at desc) as rn
  from legacy_source.appointment_completed
),
v2_last as (
  select appointment_id, total as v2_total,
         row_number() over (partition by appointment_id order by received_at desc) as rn
  from v2_source.appointment_completed
)
select l.appointment_id, l.legacy_total, v.v2_total,
       l.legacy_total - v.v2_total as delta
from legacy_last l
join v2_last v on v.appointment_id = l.appointment_id and v.rn = 1
where l.rn = 1
  and abs(l.legacy_total - v.v2_total) > 0.01
order by abs(l.legacy_total - v.v2_total) desc;
```

Expect small timing windows of disagreement (legacy snapshots lag payments by one
event). For finance-grade checks, compare legacy `paid_amount` to the sum of the v2
payment-ledger events (`payment_captured` minus `order_refunded`) for the same
appointment instead.

### Unmatched-user investigation

After building the crosswalk, quantify the expected gaps before treating them as
errors (guide §3.7: guests, multi-profile accounts, email changes):

```sql
select count(*) as legacy_users_unmatched
from (select distinct user_id from legacy_source.identifies) l
left join analytics.nmd_identity_crosswalk x on x.legacy_user_id = l.user_id
where x.legacy_user_id is null;
```
