import assert from 'node:assert/strict';
import { test, beforeEach, afterEach } from 'node:test';

import {
  SEGMENT_API_BASE_URL,
  TOKEN_ENV_VAR,
  parseArgs,
  redact,
  resolveToken,
} from '../scripts/lib/segment-api.js';
import { run as setupSources, sourceSpecs } from '../scripts/segment-setup-sources.js';
import { run as importPlans } from '../scripts/segment-import-plans.js';
import {
  DESTINATIONS,
  run as enableDestinations,
} from '../scripts/segment-enable-destinations.js';

const SECRET = 'sgp-test-secret-token-12345';
let savedEnv;

beforeEach(() => {
  savedEnv = process.env[TOKEN_ENV_VAR];
  delete process.env[TOKEN_ENV_VAR];
});

afterEach(() => {
  if (savedEnv === undefined) delete process.env[TOKEN_ENV_VAR];
  else process.env[TOKEN_ENV_VAR] = savedEnv;
});

import { collector } from './helpers.js';

test('base URL is pinned to api.segmentapis.com', () => {
  assert.equal(SEGMENT_API_BASE_URL, 'https://api.segmentapis.com');
});

test('resolveToken: helpful error when nothing configured', async () => {
  await assert.rejects(resolveToken(), new RegExp(TOKEN_ENV_VAR));
});

test('resolveToken: optional in dry-run contexts', async () => {
  assert.equal(await resolveToken({ required: false }), null);
});

test('redact strips the token from error text', () => {
  assert.equal(redact(`boom ${SECRET} boom`, SECRET), 'boom [redacted] boom');
});

test('parseArgs rejects unknown options', () => {
  assert.throws(
    () => parseArgs(['--bogus'], { flags: [], options: [] }),
    /Unknown argument: --bogus/,
  );
  assert.throws(
    () => parseArgs(['--brand'], { flags: [], options: ['--brand'] }),
    /--brand requires a value/,
  );
});

test('setup-sources dry-run plans both sources without a token', async () => {
  const { text, log } = collector();
  const { sources } = await setupSources(['--brand', 'acme', '--dry-run'], { log });
  assert.equal(sources.length, 2);
  const out = text();
  assert.match(out, /\[dry-run\] POST https:\/\/api\.segmentapis\.com\/sources/);
  assert.match(out, /"slug": "acme-nomadmd-v2-server"/);
  assert.match(out, /"slug": "acme-nomadmd-v2-browser"/);
  assert.match(out, /catalog:sources\/node/);
  assert.match(out, /catalog:sources\/javascript/);
  assert.match(out, /paste into NomadMD admin/);
});

test('setup-sources --skip-browser plans only the server source', () => {
  const specs = sourceSpecs('acme', { skipBrowser: true });
  assert.deepEqual(
    specs.map((s) => s.metadataSlug),
    ['node'],
  );
});

test('setup-sources validates the brand slug', async () => {
  const { log } = collector();
  await assert.rejects(
    setupSources(['--brand', 'Not A Slug', '--dry-run'], { log }),
    /--brand <slug> is required/,
  );
});

test('setup-sources dry-run never prints a configured token', async () => {
  process.env[TOKEN_ENV_VAR] = SECRET;
  const { text, log } = collector();
  await setupSources(['--brand', 'acme', '--dry-run'], { log });
  assert.ok(!text().includes(SECRET));
});

test('import-plans dry-run replaces rules for both plans and connects sources', async () => {
  const { text, log } = collector();
  const { plans } = await importPlans(
    ['--plan', 'both', '--server-source-id', 'src_1', '--dry-run'],
    { log },
  );
  assert.equal(plans.length, 2);
  const server = plans.find((p) => p.stream === 'server');
  assert.ok(server.rules > 40, `server plan should bundle 40+ rules, got ${server.rules}`);
  const out = text();
  assert.match(out, /POST https:\/\/api\.segmentapis\.com\/tracking-plans/);
  assert.match(out, /PUT https:\/\/api\.segmentapis\.com\/tracking-plans\/.*\/rules/);
  assert.match(out, /"sourceId": "src_1"/);
  assert.match(out, /NomadMD Segment v2 Tracking Plan — server stream/);
  assert.match(out, /NomadMD Segment v2 Tracking Plan — browser stream/);
});

test('import-plans rejects an unknown --plan value', async () => {
  const { log } = collector();
  await assert.rejects(importPlans(['--plan', 'bogus', '--dry-run'], { log }), /--plan must be/);
});

test('enable-destinations maps value from properties.revenue, never total', async () => {
  const { text, log } = collector();
  const { destinations } = await enableDestinations(
    ['--source-id', 'src_1', '--dry-run'],
    { log },
  );
  assert.equal(destinations.length, Object.keys(DESTINATIONS).length);
  const out = text();
  assert.match(out, /"value": \{\s*"@path": "\$\.properties\.revenue"/);
  assert.ok(!out.includes('$.properties.total'), 'value must never map from total');
  assert.match(out, /"transaction_id": \{\s*"@path": "\$\.properties\.order_id"/);
  assert.match(out, /"event_id": \{\s*"@path": "\$\.properties\.order_id"/);
  assert.match(out, /actions-google-analytics-4/);
  assert.match(out, /actions-facebook-conversions-api/);
  assert.match(out, /actions-tiktok-conversions/);
  // The trigger prints JSON-encoded inside the planned request body.
  assert.ok(out.includes('type = \\"track\\" and event = \\"Order Completed\\"'));
});

test('enable-destinations dry-run uses env placeholders, not values', async () => {
  process.env.META_PIXEL_ID = '999888777';
  try {
    const { text, log } = collector();
    await enableDestinations(
      ['--source-id', 'src_1', '--enable', 'meta-capi', '--dry-run'],
      { log },
    );
    // With the env var set, the real value appears in the planned request —
    // that's expected (it IS the request). Without it, a placeholder is used.
    assert.match(text(), /999888777/);
  } finally {
    delete process.env.META_PIXEL_ID;
  }
  const { text, log } = collector();
  await enableDestinations(
    ['--source-id', 'src_1', '--enable', 'meta-capi', '--dry-run'],
    { log },
  );
  assert.match(text(), /<env META_PIXEL_ID>/);
});

test('enable-destinations rejects unknown destination keys and requires --source-id', async () => {
  const { log } = collector();
  await assert.rejects(
    enableDestinations(['--source-id', 'x', '--enable', 'bogus', '--dry-run'], { log }),
    /Unknown destination "bogus"/,
  );
  await assert.rejects(enableDestinations(['--dry-run'], { log }), /--source-id/);
});
