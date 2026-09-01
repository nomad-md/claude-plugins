#!/usr/bin/env node
// Enables cloud-mode ad destinations on the brand's v2 server source with the
// NomadMD-correct conversion mappings. The critical mapping is
// value ← properties.revenue: Segment's default suggestion can pick `total`,
// but the browser/GTM path sends `revenue` — a mismatch makes the platforms
// see different values for the same event_id/transaction_id and breaks
// conversion dedup. transaction_id / event_id map from properties.order_id.
//
// Platform credentials come from env vars only (never argv — argv leaks into
// shell history and process lists). Always run with --dry-run first; after the
// live run, verify the mappings in the Segment UI per the setup-segment-v2
// skill.

import { pathToFileURL } from 'node:url';

import {
  clientFromArgs,
  findCatalogEntries,
  parseArgs,
} from './lib/segment-api.js';

const HELP = `Usage: node segment-enable-destinations.js --source-id <id> [options]

Enables cloud-mode ad destinations on the v2 server source.

Options:
  --source-id <id>     the brand's v2 server source (required)
  --enable <list>      comma-separated: ga4-cloud,meta-capi,tiktok (default: all)
  --dry-run            print the exact requests without sending anything
  --token-file <path>  token file (default: SEGMENT_PUBLIC_API_TOKEN env var)
  --help               show this help

Platform credentials (env vars; placeholders printed in --dry-run):
  ga4-cloud   GA4_MEASUREMENT_ID, GA4_API_SECRET
  meta-capi   META_PIXEL_ID, META_CAPI_ACCESS_TOKEN
  tiktok      TIKTOK_PIXEL_CODE, TIKTOK_ACCESS_TOKEN
`;

function env(name, dryRun) {
  const value = process.env[name];
  if (value) return value;
  if (dryRun) return `<env ${name}>`;
  throw new Error(`Missing env var ${name} (see --help)`);
}

// Purchase-conversion mapping shared by all three platforms. Field-by-field on
// purpose so the value←revenue choice is explicit and reviewable.
const PURCHASE_TRIGGER = 'type = "track" and event = "Order Completed"';
const VALUE_FROM_REVENUE = { '@path': '$.properties.revenue' }; // NOT total
const CURRENCY = { '@path': '$.properties.currency' };
const ORDER_ID = { '@path': '$.properties.order_id' };

export const DESTINATIONS = {
  'ga4-cloud': {
    label: 'Google Analytics 4 Cloud (the GA4 Measurement Protocol)',
    catalogSlug: 'actions-google-analytics-4',
    settings: (dryRun) => ({
      measurementId: env('GA4_MEASUREMENT_ID', dryRun),
      apiSecret: env('GA4_API_SECRET', dryRun),
    }),
    subscriptions: [
      {
        name: 'Purchase (Order Completed)',
        actionSlug: 'purchase',
        trigger: PURCHASE_TRIGGER,
        mapping: {
          // GA4 dedups browser vs server on transaction_id.
          transaction_id: ORDER_ID,
          value: VALUE_FROM_REVENUE,
          currency: CURRENCY,
        },
      },
    ],
  },
  'meta-capi': {
    label: 'Facebook Conversions API (Meta CAPI)',
    catalogSlug: 'actions-facebook-conversions-api',
    settings: (dryRun) => ({
      pixelId: env('META_PIXEL_ID', dryRun),
      token: env('META_CAPI_ACCESS_TOKEN', dryRun),
    }),
    subscriptions: [
      {
        name: 'Purchase (Order Completed)',
        actionSlug: 'purchase',
        trigger: PURCHASE_TRIGGER,
        mapping: {
          // Meta dedups the browser pixel + CAPI pair on event_id.
          event_id: ORDER_ID,
          value: VALUE_FROM_REVENUE,
          currency: CURRENCY,
        },
      },
    ],
  },
  tiktok: {
    label: 'TikTok Conversions (Events API)',
    catalogSlug: 'actions-tiktok-conversions',
    settings: (dryRun) => ({
      pixelCode: env('TIKTOK_PIXEL_CODE', dryRun),
      accessToken: env('TIKTOK_ACCESS_TOKEN', dryRun),
    }),
    subscriptions: [
      {
        name: 'CompletePayment (Order Completed)',
        actionSlug: 'reportWebEvent',
        trigger: PURCHASE_TRIGGER,
        mapping: {
          event: 'CompletePayment',
          event_id: ORDER_ID,
          value: VALUE_FROM_REVENUE,
          currency: CURRENCY,
        },
      },
    ],
  },
};

async function resolveActionId(client, metadata, actionSlug) {
  if (client.dryRun) return `<action:${metadata.slug}/${actionSlug}>`;
  const detail = await client.request('GET', `/catalog/destinations/${metadata.id}`);
  const actions = detail?.destinationMetadata?.actions ?? [];
  const action = actions.find((a) => a.slug === actionSlug);
  if (!action) {
    throw new Error(
      `Action "${actionSlug}" not found on ${metadata.slug} — the catalog may ` +
        'have changed; check the destination in the Segment UI.',
    );
  }
  return action.id;
}

export async function run(argv, { log = (l) => console.log(l) } = {}) {
  const args = parseArgs(argv, {
    flags: ['--dry-run', '--help'],
    options: ['--source-id', '--enable', '--token-file'],
  });
  if (args.flags.has('--help')) {
    log(HELP);
    return { destinations: [] };
  }
  const sourceId = args.options.get('--source-id');
  if (!sourceId) throw new Error('--source-id <id> is required');
  const keys = (args.options.get('--enable') ?? Object.keys(DESTINATIONS).join(','))
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);
  for (const key of keys) {
    if (!DESTINATIONS[key]) {
      throw new Error(
        `Unknown destination "${key}" — valid: ${Object.keys(DESTINATIONS).join(', ')}`,
      );
    }
  }
  const dryRun = args.flags.has('--dry-run');
  const client = await clientFromArgs(args, { log });
  const catalog = await findCatalogEntries(
    client,
    'destinations',
    keys.map((k) => DESTINATIONS[k].catalogSlug),
  );

  const results = [];
  for (const key of keys) {
    const spec = DESTINATIONS[key];
    const metadata = catalog.get(spec.catalogSlug);
    const created = await client.request('POST', '/destinations', {
      sourceId,
      metadataId: metadata.id,
      name: `NomadMD v2 — ${spec.label}`,
      enabled: true,
      settings: spec.settings(dryRun),
    });
    const destinationId = created?.destination?.id ?? `<dry-run:${key}>`;
    for (const sub of spec.subscriptions) {
      const actionId = await resolveActionId(client, metadata, sub.actionSlug);
      await client.request('POST', `/destinations/${destinationId}/subscriptions`, {
        name: sub.name,
        enabled: true,
        actionId,
        trigger: sub.trigger,
        settings: sub.mapping,
      });
    }
    results.push({ key, destinationId });
    log(`[${key}] ${dryRun ? 'planned' : 'enabled'}: ${spec.label}`);
  }
  log('');
  log(
    'Verify in the Segment UI that each mapping reads value from ' +
      'properties.revenue (not total) and event_id/transaction_id from ' +
      'properties.order_id — this is what keeps browser/server dedup intact.',
  );
  return { destinations: results };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  run(process.argv.slice(2)).catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
