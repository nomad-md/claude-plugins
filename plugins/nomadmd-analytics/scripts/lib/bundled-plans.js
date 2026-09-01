// Loads the tracking plans bundled in the plugin's reference/ dir (packaged
// from docs/analytics by the repo's analytics codegen). Single owner of the
// bundle path/filename convention.

import { readFile } from 'node:fs/promises';

export const PLAN_STREAMS = ['server', 'browser'];

/** @param {'server'|'browser'} stream */
export async function loadBundledPlan(stream) {
  const url = new URL(
    `../../reference/tracking-plan.${stream}.public.json`,
    import.meta.url,
  );
  return JSON.parse(await readFile(url, 'utf8'));
}
