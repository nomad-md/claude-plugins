#!/usr/bin/env node
// Validates captured Segment calls (debugger copies) against the bundled
// NomadMD v2 tracking plans — offline, no token needed. Accepts a single JSON
// object, a JSON array, or NDJSON, from a file argument or stdin.
//
// Exit codes: 0 all valid, 1 at least one failure, 2 usage/input error.

import { pathToFileURL } from 'node:url';

import { readFile } from 'node:fs/promises';

import { loadBundledPlan } from './lib/bundled-plans.js';
import { parseArgs } from './lib/segment-api.js';
import { callType, findTrackRule, validateCall } from './lib/plan-validator.js';

const HELP = `Usage: node validate-events.js [file] [--plan server|browser|auto] [--json]

Validates Segment-debugger events against the bundled v2 tracking plans.
Reads from stdin when no file is given.

  --plan auto (default): an event found in only one plan validates against it;
  a dual-stream event uses context.source (server → server plan, client →
  browser plan; server when absent).
  --json: machine-readable output.
`;

export function parseInput(text) {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('Empty input');
  try {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    // NDJSON: one JSON object per non-empty line.
    return trimmed.split('\n').flatMap((line) => {
      const l = line.trim();
      return l ? [JSON.parse(l)] : [];
    });
  }
}

/** Picks which plan validates a call, per the --plan auto rules. */
export function pickPlan(plans, call, which) {
  if (which !== 'auto') return { stream: which, plan: plans[which] };
  if (callType(call) === 'track') {
    const inServer = !!findTrackRule(plans.server, call.event);
    const inBrowser = !!findTrackRule(plans.browser, call.event);
    if (inServer !== inBrowser) {
      const stream = inServer ? 'server' : 'browser';
      return { stream, plan: plans[stream] };
    }
    // In both (dual-stream) or neither (unknown): route by context.source.
  }
  const stream = call.context?.source === 'client' ? 'browser' : 'server';
  return { stream, plan: plans[stream] };
}

function describeCall(call) {
  const type = callType(call) ?? '?';
  return type === 'track' ? `track "${call.event}"` : type;
}

export async function run(argv, { log = (l) => console.log(l), stdin } = {}) {
  const args = parseArgs(argv, {
    flags: ['--json', '--help'],
    options: ['--plan'],
  });
  if (args.flags.has('--help')) {
    log(HELP);
    return { failed: 0, results: [] };
  }
  const which = args.options.get('--plan') ?? 'auto';
  if (!['server', 'browser', 'auto'].includes(which)) {
    throw new Error(`--plan must be server, browser, or auto (got "${which}")`);
  }

  let text;
  if (args.positional[0]) {
    text = await readFile(args.positional[0], 'utf8');
  } else {
    text = stdin ?? (await readFile(0, 'utf8')); // fd 0 = stdin
  }
  const calls = parseInput(text);
  // auto mode needs both plans; a pinned --plan only needs its own.
  const plans = {};
  await Promise.all(
    (which === 'auto' ? ['server', 'browser'] : [which]).map(async (s) => {
      plans[s] = await loadBundledPlan(s);
    }),
  );

  const results = calls.map((call, i) => {
    const { stream, plan } = pickPlan(plans, call, which);
    const verdict = validateCall(plan, call);
    if (verdict === null) {
      return {
        index: i,
        call: describeCall(call),
        stream,
        errors: [
          `unknown event ${JSON.stringify(call.event ?? call.type)} — not in the ` +
            `${stream} plan (legacy events and typos both land here; check the ` +
            'write key / source)',
        ],
      };
    }
    return { index: i, call: describeCall(call), stream, errors: verdict.errors };
  });

  const failed = results.filter((r) => r.errors.length > 0);
  if (args.flags.has('--json')) {
    log(JSON.stringify({ total: results.length, failed: failed.length, results }, null, 2));
  } else {
    for (const r of results) {
      if (r.errors.length === 0) {
        log(`PASS [${r.stream}] ${r.call}`);
      } else {
        log(`FAIL [${r.stream}] ${r.call}`);
        for (const e of r.errors) log(`  - ${e}`);
      }
    }
    log('');
    log(`${results.length - failed.length}/${results.length} calls valid`);
  }
  return { failed: failed.length, results };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  run(process.argv.slice(2))
    .then(({ failed }) => process.exit(failed > 0 ? 1 : 0))
    .catch((err) => {
      console.error(err.message);
      process.exit(2);
    });
}
