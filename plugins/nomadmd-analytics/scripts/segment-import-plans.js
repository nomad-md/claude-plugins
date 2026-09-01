#!/usr/bin/env node
// Imports the bundled NomadMD v2 Protocols tracking plans (reference/
// tracking-plan.{server,browser}.public.json) into the brand's workspace and
// connects them to the brand's sources. Re-running replaces the plan rules —
// idempotent by design.
//
// Always run with --dry-run first and review the request plan.

import { pathToFileURL } from 'node:url';

import { PLAN_STREAMS, loadBundledPlan } from './lib/bundled-plans.js';
import { clientFromArgs, parseArgs } from './lib/segment-api.js';

const HELP = `Usage: node segment-import-plans.js [options]

Imports the bundled v2 tracking plans and connects them to sources.

Options:
  --plan <which>              server | browser | both (default: both)
  --server-source-id <id>     connect the server plan to this source
  --browser-source-id <id>    connect the browser plan to this source
  --dry-run                   print the exact requests without sending anything
  --token-file <path>         token file (default: SEGMENT_PUBLIC_API_TOKEN)
  --help                      show this help
`;

async function listExistingPlans(client) {
  const plans = [];
  for await (const plan of client.paginate('/tracking-plans', 'trackingPlans')) {
    plans.push(plan);
  }
  return plans;
}

export async function run(argv, { log = (l) => console.log(l) } = {}) {
  const args = parseArgs(argv, {
    flags: ['--dry-run', '--help'],
    options: ['--plan', '--server-source-id', '--browser-source-id', '--token-file'],
  });
  if (args.flags.has('--help')) {
    log(HELP);
    return { plans: [] };
  }
  const which = args.options.get('--plan') ?? 'both';
  const streams = which === 'both' ? PLAN_STREAMS : [which];
  if (!streams.every((s) => PLAN_STREAMS.includes(s))) {
    throw new Error(`--plan must be server, browser, or both (got "${which}")`);
  }
  const dryRun = args.flags.has('--dry-run');
  const client = await clientFromArgs(args, { log });
  const existingPlans = await listExistingPlans(client);

  const results = [];
  for (const stream of streams) {
    const bundled = await loadBundledPlan(stream);
    const existing = existingPlans.find((p) => p.name === bundled.name) ?? null;
    let planId = existing?.id;
    if (!existing) {
      const created = await client.request('POST', '/tracking-plans', {
        name: bundled.name,
        description: bundled.description,
        type: 'LIVE',
      });
      planId = created?.trackingPlan?.id ?? `<dry-run:${stream}-plan>`;
    } else {
      log(`Plan "${bundled.name}" exists (${planId}) — replacing its rules.`);
    }
    // Replace (not append) so re-imports converge on the bundled ruleset.
    await client.request('PUT', `/tracking-plans/${planId}/rules`, {
      rules: bundled.rules,
    });

    const sourceId = args.options.get(`--${stream}-source-id`);
    if (sourceId) {
      await client.request('POST', `/tracking-plans/${planId}/sources`, {
        sourceId,
      });
    }
    results.push({ stream, planId, rules: bundled.rules.length, sourceId: sourceId ?? null });
    log(
      `[${stream}] ${dryRun ? 'planned' : 'imported'}: "${bundled.name}" ` +
        `(${bundled.rules.length} rules${sourceId ? `, connected to ${sourceId}` : ''})`,
    );
  }
  return { plans: results };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  run(process.argv.slice(2)).catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
