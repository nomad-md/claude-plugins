#!/usr/bin/env node
// Creates the brand's NomadMD v2 Segment sources (Node.js server source, and
// the JavaScript browser source unless --skip-browser) and prints the write
// keys the brand pastes into NomadMD admin. Runs against the brand's own
// workspace via their Public API token — see ../README.md for scopes.
//
// Always run with --dry-run first and review the request plan.

import { pathToFileURL } from 'node:url';

import {
  clientFromArgs,
  findCatalogEntries,
  parseArgs,
} from './lib/segment-api.js';

const HELP = `Usage: node segment-setup-sources.js --brand <brand-slug> [options]

Creates the NomadMD v2 sources in the brand's Segment workspace.

Options:
  --brand <slug>       brand slug used in source slugs/names (required)
  --skip-browser       create only the Node.js server source
  --dry-run            print the exact requests without sending anything
  --token-file <path>  read the Public API token from an untracked file
                       (default: SEGMENT_PUBLIC_API_TOKEN env var)
  --help               show this help
`;

export function sourceSpecs(brand, { skipBrowser = false } = {}) {
  const specs = [
    {
      kind: 'server',
      metadataSlug: 'node',
      slug: `${brand}-nomadmd-v2-server`,
      name: `${brand} — NomadMD v2 (server)`,
      adminField: 'Integrations → Segment → v2 write key',
    },
  ];
  if (!skipBrowser) {
    specs.push({
      kind: 'browser',
      metadataSlug: 'javascript',
      slug: `${brand}-nomadmd-v2-browser`,
      name: `${brand} — NomadMD v2 (browser)`,
      adminField: 'Integrations → Segment → v2 browser source key',
    });
  }
  return specs;
}

export async function run(argv, { log = (l) => console.log(l) } = {}) {
  const args = parseArgs(argv, {
    flags: ['--skip-browser', '--dry-run', '--help'],
    options: ['--brand', '--token-file'],
  });
  if (args.flags.has('--help')) {
    log(HELP);
    return { sources: [] };
  }
  const brand = args.options.get('--brand');
  if (!brand || !/^[a-z0-9][a-z0-9-]*$/.test(brand)) {
    throw new Error('--brand <slug> is required (lowercase kebab-case)');
  }
  const dryRun = args.flags.has('--dry-run');
  const client = await clientFromArgs(args, { log });

  const specs = sourceSpecs(brand, {
    skipBrowser: args.flags.has('--skip-browser'),
  });
  const catalog = await findCatalogEntries(
    client,
    'sources',
    specs.map((s) => s.metadataSlug),
  );

  const results = [];
  for (const spec of specs) {
    const metadata = catalog.get(spec.metadataSlug);
    const created = await client.request('POST', '/sources', {
      slug: spec.slug,
      name: spec.name,
      enabled: true,
      metadataId: metadata.id,
    });
    let source = created?.source;
    if (!dryRun && source && !(source.writeKeys ?? []).length) {
      source = (await client.request('GET', `/sources/${source.id}`))?.source;
    }
    results.push({
      kind: spec.kind,
      slug: spec.slug,
      adminField: spec.adminField,
      id: source?.id ?? '<dry-run>',
      writeKey: source?.writeKeys?.[0] ?? '<dry-run>',
    });
  }

  log('');
  log(dryRun ? 'Planned sources (dry-run — nothing created):' : 'Sources created:');
  for (const r of results) {
    log(`  [${r.kind}] ${r.slug}`);
    log(`    source id: ${r.id}`);
    log(`    write key: ${r.writeKey}`);
    log(`    paste into NomadMD admin: ${r.adminField}`);
  }
  log('');
  log(
    'Record the source ids and write keys in .claude/nomadmd-analytics.local.md ' +
      '(write keys are non-secret).',
  );
  return { sources: results };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  run(process.argv.slice(2)).catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
