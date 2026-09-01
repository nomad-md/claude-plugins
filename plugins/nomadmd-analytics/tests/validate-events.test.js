import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { test } from 'node:test';

import { PLAN_STREAMS, loadBundledPlan } from '../scripts/lib/bundled-plans.js';
import { parseInput, pickPlan, run } from '../scripts/validate-events.js';
import { collector } from './helpers.js';

const execFileP = promisify(execFile);
const SCRIPT = new URL('../scripts/validate-events.js', import.meta.url).pathname;
const fixture = (name) =>
  new URL(`./fixtures/${name}`, import.meta.url).pathname;

test('valid fixture passes against the bundled server plan (exit 0)', async () => {
  const { stdout } = await execFileP(process.execPath, [
    SCRIPT,
    fixture('signed-in.valid.json'),
  ]);
  assert.match(stdout, /PASS \[server\] track "Signed In"/);
  assert.match(stdout, /1\/1 calls valid/);
});

test('invalid fixture reports each defect and exits 1', async () => {
  const err = await execFileP(process.execPath, [
    SCRIPT,
    fixture('signed-in.invalid.json'),
  ]).then(
    () => assert.fail('expected exit 1'),
    (e) => e,
  );
  assert.equal(err.code, 1);
  assert.match(err.stdout, /FAIL \[server\] track "Signed In"/);
  assert.match(err.stdout, /context\.schema_version.*not in enum/);
  assert.match(err.stdout, /marketplace_id: expected integer/);
  assert.match(err.stdout, /missing required property "marketplace_group_id"/);
  assert.match(err.stdout, /"magic-link" not in enum/);
  assert.match(err.stdout, /unexpected property "email"/);
});

test('NDJSON input: unknown event flagged, valid line passes', async () => {
  const { lines, log } = collector();
  const { failed, results } = await run([fixture('mixed.ndjson')], { log });
  assert.equal(results.length, 2);
  assert.equal(failed, 1);
  assert.match(lines.join('\n'), /unknown event "Totally Made Up Event"/);
});

test('--json emits machine-readable results', async () => {
  const { lines, log } = collector();
  await run([fixture('signed-in.valid.json'), '--json'], { log });
  const parsed = JSON.parse(lines.join('\n'));
  assert.equal(parsed.total, 1);
  assert.equal(parsed.failed, 0);
});

test('stdin input is accepted via the run() stdin option', async () => {
  const { log } = collector();
  const event = JSON.stringify({
    type: 'track',
    event: 'Signed In',
    properties: {
      marketplace_id: 1,
      marketplace_group_id: 1,
      method: 'apple',
    },
  });
  const { failed } = await run([], { log, stdin: event });
  assert.equal(failed, 0);
});

test('parseInput handles object, array, and NDJSON', () => {
  assert.equal(parseInput('{"a":1}').length, 1);
  assert.equal(parseInput('[{"a":1},{"b":2}]').length, 2);
  assert.equal(parseInput('{"a":1}\n\n{"b":2}\n').length, 2);
  assert.throws(() => parseInput('   '), /Empty input/);
});

test('pickPlan auto-routes: exclusive events by plan, dual-stream by context.source', async () => {
  const plans = {
    server: await loadBundledPlan('server'),
    browser: await loadBundledPlan('browser'),
  };

  // Server-only event routes to server even with client source.
  const serverOnly = {
    type: 'track',
    event: 'Payment Captured',
    context: { source: 'client' },
  };
  assert.equal(pickPlan(plans, serverOnly, 'auto').stream, 'server');

  // Browser-only funnel event routes to browser.
  const browserOnly = { type: 'track', event: 'Service Added' };
  assert.equal(pickPlan(plans, browserOnly, 'auto').stream, 'browser');

  // Dual-stream event routes by context.source.
  const dual = (source) => ({
    type: 'track',
    event: 'Order Completed',
    context: { source },
  });
  assert.equal(pickPlan(plans, dual('client'), 'auto').stream, 'browser');
  assert.equal(pickPlan(plans, dual('server'), 'auto').stream, 'server');

  // Explicit --plan wins.
  assert.equal(pickPlan(plans, browserOnly, 'server').stream, 'server');
});

test('bundled plans only use schema keywords the validator implements', async () => {
  // plan-validator.js implements a deliberate subset of JSON Schema. This
  // test turns that "the plans are generated, so the subset is closed"
  // assumption into a mechanism: if the codegen ever emits a new keyword
  // (pattern, minimum, format, ...), fail here instead of silently passing
  // events that violate the plan.
  const SUPPORTED = new Set([
    '$schema',
    'description',
    'type',
    'enum',
    'properties',
    'required',
    'additionalProperties',
    'items',
  ]);
  function assertSupported(schema, path) {
    for (const key of Object.keys(schema)) {
      assert.ok(
        SUPPORTED.has(key),
        `${path} uses schema keyword "${key}" that plan-validator.js does ` +
          'not implement — extend the validator before the plans may use it',
      );
    }
    for (const [name, sub] of Object.entries(schema.properties ?? {})) {
      if (sub && typeof sub === 'object') {
        assertSupported(sub, `${path}.${name}`);
      }
    }
    if (schema.items) assertSupported(schema.items, `${path}[]`);
  }
  for (const stream of PLAN_STREAMS) {
    const plan = await loadBundledPlan(stream);
    for (const rule of plan.rules) {
      assertSupported(rule.jsonSchema, `${stream}: ${rule.type} ${rule.key}`);
    }
  }
});
