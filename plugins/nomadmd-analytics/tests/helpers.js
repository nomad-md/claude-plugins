/** Captures a script's log output for assertions. */
export function collector() {
  const lines = [];
  return { lines, log: (l) => lines.push(l), text: () => lines.join('\n') };
}
