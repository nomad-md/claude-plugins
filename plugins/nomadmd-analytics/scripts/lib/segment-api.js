// Minimal Segment Public API client for the nomadmd-analytics bundled scripts.
// Zero dependencies; Node >= 20 (global fetch).
//
// The base URL is pinned by design: these scripts run with the brand's own
// credentials, and pinning guarantees those credentials are only ever sent to
// Segment. There is deliberately no env var or flag to redirect it.
export const SEGMENT_API_BASE_URL = 'https://api.segmentapis.com';

export const TOKEN_ENV_VAR = 'SEGMENT_PUBLIC_API_TOKEN';

/**
 * Resolves the brand's Public API token from the environment or an untracked
 * token file. Tokens are never echoed and must never be committed or pasted
 * into chat. In --dry-run no token is needed (nothing is sent).
 */
export async function resolveToken({ tokenFile, required = true } = {}) {
  const fromEnv = process.env[TOKEN_ENV_VAR];
  if (fromEnv && fromEnv.trim()) return fromEnv.trim();
  if (tokenFile) {
    const { readFile } = await import('node:fs/promises');
    const contents = await readFile(tokenFile, 'utf8');
    const token = contents.trim();
    if (token) return token;
  }
  if (!required) return null;
  throw new Error(
    `No Segment token: set ${TOKEN_ENV_VAR} or pass --token-file <path>. ` +
      'Never paste the token into chat or commit it.',
  );
}

/** Strips any occurrence of the token from text destined for logs/errors. */
export function redact(text, token) {
  if (!token) return text;
  return String(text).split(token).join('[redacted]');
}

export class SegmentClient {
  /**
   * @param {object} opts
   * @param {string|null} opts.token
   * @param {boolean} [opts.dryRun] plan requests instead of sending them
   * @param {(line: string) => void} [opts.log]
   */
  constructor({ token, dryRun = false, log = (line) => console.log(line) }) {
    this.token = token;
    this.dryRun = dryRun;
    this.log = log;
    /** Requests planned in dry-run mode: {method, path, body}. */
    this.planned = [];
  }

  /**
   * Performs one Public API request. In dry-run: records and prints the exact
   * request (method, URL, body) and returns null — callers substitute
   * placeholders for anything they needed from the response.
   */
  async request(method, apiPath, body = undefined) {
    if (!apiPath.startsWith('/')) {
      throw new Error(`API path must start with '/': ${apiPath}`);
    }
    if (this.dryRun) {
      this.planned.push({ method, path: apiPath, body });
      this.log(`[dry-run] ${method} ${SEGMENT_API_BASE_URL}${apiPath}`);
      if (body !== undefined) {
        this.log(indent(JSON.stringify(body, null, 2)));
      }
      return null;
    }
    const res = await fetch(`${SEGMENT_API_BASE_URL}${apiPath}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(
        `Segment API ${method} ${apiPath} → HTTP ${res.status}: ` +
          redact(text, this.token),
      );
    }
    const json = text ? JSON.parse(text) : {};
    // Public API responses wrap the payload in {data: {...}}.
    return json.data ?? json;
  }

  /**
   * Iterates a paginated list endpoint (`?pagination.cursor=`), yielding items
   * from `listKey` on each page. Yields nothing in dry-run.
   */
  async *paginate(apiPath, listKey) {
    if (this.dryRun) {
      this.log(`[dry-run] GET ${SEGMENT_API_BASE_URL}${apiPath} (paginated)`);
      return;
    }
    let cursor;
    do {
      const sep = apiPath.includes('?') ? '&' : '?';
      const page = await this.request(
        'GET',
        `${apiPath}${sep}pagination.count=200` +
          (cursor ? `&pagination.cursor=${encodeURIComponent(cursor)}` : ''),
      );
      for (const item of page?.[listKey] ?? []) yield item;
      cursor = page?.pagination?.next;
    } while (cursor);
  }
}

/**
 * Resolves catalog entries by slug in ONE pagination pass (the catalogs are
 * hundreds of entries — one scan per lookup would multiply round-trips).
 * @param {SegmentClient} client
 * @param {'sources'|'destinations'} kind
 * @param {string[]} slugs
 * @returns {Promise<Map<string, object>>} slug → catalog metadata. Dry-run
 * returns placeholders so the planned request bodies stay readable.
 */
export async function findCatalogEntries(client, kind, slugs) {
  const wanted = new Set(slugs);
  const found = new Map();
  if (client.dryRun) {
    for (const slug of wanted) {
      found.set(slug, { id: `<catalog:${kind}/${slug}>`, slug });
    }
    return found;
  }
  for await (const md of client.paginate(`/catalog/${kind}`, `${kind}Catalog`)) {
    if (wanted.has(md.slug)) {
      found.set(md.slug, md);
      if (found.size === wanted.size) break;
    }
  }
  const missing = [...wanted].filter((s) => !found.has(s));
  if (missing.length > 0) {
    throw new Error(
      `Catalog entr${missing.length > 1 ? 'ies' : 'y'} not found in ` +
        `${kind}: ${missing.join(', ')}`,
    );
  }
  return found;
}

/**
 * Shared CLI boot: token from env/--token-file (optional under --dry-run,
 * where nothing is sent), then a client in the requested mode.
 */
export async function clientFromArgs(args, { log } = {}) {
  const dryRun = args.flags.has('--dry-run');
  const token = await resolveToken({
    tokenFile: args.options.get('--token-file'),
    required: !dryRun,
  });
  return new SegmentClient({ token, dryRun, log });
}

function indent(text) {
  return text
    .split('\n')
    .map((l) => `  ${l}`)
    .join('\n');
}

/** Tiny argv parser: --flag, --key value; returns {flags:Set, options:Map, positional:[]}. */
export function parseArgs(argv, { flags = [], options = [] } = {}) {
  const flagSet = new Set(flags);
  const optionSet = new Set(options);
  const out = { flags: new Set(), options: new Map(), positional: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (flagSet.has(arg)) {
      out.flags.add(arg);
    } else if (optionSet.has(arg)) {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${arg} requires a value`);
      out.options.set(arg, value);
    } else if (arg.startsWith('--')) {
      throw new Error(`Unknown argument: ${arg} (see --help)`);
    } else {
      out.positional.push(arg);
    }
  }
  return out;
}
