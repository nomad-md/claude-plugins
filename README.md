# NomadMD Claude Plugins

Claude Code plugin marketplace for NomadMD's brand-facing tooling. Currently ships one plugin:

## nomadmd-analytics (v2.2.0)

Agent-guided Segment v2 / Google Tag Manager analytics setup for NomadMD brands:

- **setup-segment-v2** — decision-matrix interview (server source / JS source / GTM, by goal), then Segment workspace configuration via the brand's own Public API token: source creation, write keys, Protocols tracking-plan import, and cloud-mode destinations with the correct `value ← revenue` mapping.
- **migrate-from-legacy** — identity strategies for the email → `mu_` userId change, the `client_profile_id` crosswalk, brand-specific warehouse crosswalk SQL, and a dual-run validation checklist.
- **setup-gtm** — container-template import (minimal vs commerce tier), ID constants, per-platform unpause, and `event_id`/`transaction_id` dedup verification in Preview mode.
- **validate-events** — validate captured events (e.g. pasted from the Segment debugger) against the bundled tracking plans.

See [plugins/nomadmd-analytics/README.md](plugins/nomadmd-analytics/README.md) for full usage. The [guardrails](plugins/nomadmd-analytics/guardrails/) directory carries the risk register and disclaimer: the skills advise and flag NomadMD-identified risks, but configurations you choose to apply are your responsibility, as described there.

## Install (Claude Code)

```bash
claude plugin marketplace add https://github.com/nomad-md/claude-plugins.git
claude plugin install nomadmd-analytics@nomadmd-plugins
```

Or add the marketplace from the `/plugin` menu inside Claude Code using the same URL.

## Install (OpenAI Codex / ChatGPT)

This repository also ships the Codex-native layout (`.agents/plugins/marketplace.json` + `.codex-plugin/`), so the same URL works there:

```bash
codex plugin marketplace add https://github.com/nomad-md/claude-plugins.git
```

Then install **NomadMD Analytics** from the plugins/marketplace section in the ChatGPT desktop app (or `codex plugin marketplace list` to confirm it registered).

## Using it outside Claude Code

The plugin content is harness-agnostic; only the `.claude-plugin/` metadata is Claude Code-specific.

- `skills/*/SKILL.md` — agent instructions in plain Markdown. Mount them in your harness's instruction mechanism (AGENTS.md-style files, custom instructions, or skill/tool registries).
- `reference/` — the event reference, legacy-migration guide, customer guide, GTM dataLayer reference, consent-token spec, two Segment Protocols tracking plans (JSON), and two importable GTM container templates.
- `scripts/` — zero-dependency Node.js (ESM) utilities for the Segment Public API. Token via the `SEGMENT_PUBLIC_API_TOKEN` env var or `--token-file`; dry-run by default.

## License & status

© NomadMD. All rights reserved. You're welcome to install and use this plugin to set up analytics for your own NomadMD-powered marketplace. Formal license terms will follow; until then, please don't redistribute modified copies. Configurations you choose to apply are your own responsibility — see the [guardrails](plugins/nomadmd-analytics/guardrails/) risk register and disclaimer.

## Provenance

This repository is a published snapshot of `plugins/nomadmd-analytics` from the NomadMD monorepo (currently v2.2.0, monorepo commit `aa7bddc1`). The `reference/` bundle is code-generated from the monorepo's canonical tracking plan — do not edit it here; updates arrive as new published snapshots.
