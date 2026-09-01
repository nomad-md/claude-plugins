---
name: validate-events
description: This skill should be used when the user asks to "validate events", "check these Segment events", "validate against the tracking plan", pastes Segment-debugger JSON and asks if it's correct, or reports events "not showing up" / "looking wrong" in a destination. Validates events offline against the bundled NomadMD v2 tracking plans. Also invoked by setup-segment-v2 (post-config smoke test) and migrate-from-legacy (dual-run checklist).
---

# Validate Segment events against the v2 tracking plan

Validate events copied from the Segment debugger (or any captured payloads) against
the bundled NomadMD v2 Protocols plans — offline, deterministic, no token needed.

## Workflow

1. Obtain the events. Debugger flow: Segment → the source → Debugger → click an event
   → copy the raw JSON. Accept a single event object, a JSON array, or NDJSON (one
   event per line).
2. Write the pasted JSON to a temp file (scratchpad), then run:

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/validate-events.js <file> [--plan server|browser|auto] [--json]
```

   `--plan auto` (default) resolves each event: an event name found in only one plan
   validates against that plan; a dual-stream event uses `context.source`
   (`server` → server plan, `client` → browser plan). `--json` emits machine-readable
   results; the human format prints per-event PASS/FAIL with error paths. Exit code 1
   means at least one event failed.

3. Interpret failures for the user — the raw errors are precise but terse:

| Error | Likely cause / next step |
| --- | --- |
| `unknown event "X"` | Not a v2 event. Legacy event names overlap v2 (e.g. `Appointment Booked` exists in both) — check the write key: is this event arriving on the v2 source or the legacy one? Typos and custom events also land here. |
| `missing required property` | Emitter bug or an event predating a schema addition. Compare against the event's entry in the reference doc; report NomadMD-side gaps to NomadMD. |
| `unexpected property` (additionalProperties) | Property typo, or an event from a newer schema than this plugin bundles — check the plugin version (2.2.x = schema 2.2) against the platform's release notes. |
| `expected integer/string/...` | Type drift — most commonly a stringified number. On money fields, confirm the source: v2 money is dollars-decimal per the reference §2.2. |
| `not in enum` | A value outside the plan's enum. If the platform genuinely emits it, the plugin bundle may be stale — same version check as above. |
| context errors (`schema_version`, `app`, `source`) | The event didn't come from the v2 emitters (wrong source, or hand-crafted test payload). Every real v2 call carries the full envelope. |

4. When validating a batch (smoke test, dual-run), summarize: n passed / n failed,
   grouped by event name and error kind — not one line per event.

## Used by the other skills

- **setup-segment-v2** step 4: post-configuration smoke test — a test booking's events
  must all pass, on the correct source.
- **migrate-from-legacy** dual-run checklist: v2-side events must pass while the brand
  reconciles counts and money against legacy. Only v2 events validate — legacy events
  will (correctly) fail as unknown; don't present that as a defect.

## Reference material

- `${CLAUDE_PLUGIN_ROOT}/reference/segment-v2-event-reference.md` — per-event
  documentation to explain any failure (conventions §2: naming, money, envelope).
- `${CLAUDE_PLUGIN_ROOT}/reference/tracking-plan.{server,browser}.public.json` — the
  plans the validator enforces.
- Example fixtures (valid and invalid): `${CLAUDE_PLUGIN_ROOT}/tests/fixtures/`.
