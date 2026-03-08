# Quick Skills (obsidian-quick-skills)

Quick Skills is an Obsidian desktop-only sidebar assistant built explicitly for Codex-native workflows:

- manual chat in a dockable sidebar,
- reusable note-aware skills,
- plugin-managed Codex sessions,
- live structured activity streaming,
- raw event logging for debugging.

## Install and run (development)

1. Copy this plugin into `<Vault>/.obsidian/plugins/obsidian-quick-skills/`.
2. Install dependencies with `npm install`.
3. Build once with `npm run build`.
4. In Obsidian desktop, open **Settings → Community plugins** and enable **Quick Skills**.

For watch mode during development, run `npm run dev`.

## Commands

- `Quick Skills: Open Sidebar`
- `Quick Skills: Run Skill…`
- `Quick Skills: New Session`

The ribbon icon also opens the skill picker for the current note.

## Sidebar UX

The sidebar keeps the existing low-touch flow and now exposes richer Codex state while a run is active:

- session dropdown and **New** session,
- manual chat input with **Enter** to send and **Shift+Enter** for newline,
- model, reasoning, and mode selectors,
- **Stop** to cancel an active run,
- assistant actions: **Copy**, **Insert at cursor**, **Append to note**,
- live assistant panels for:
  - reasoning summaries,
  - draft assistant text before the final response settles,
  - structured activity cards for commands, todo updates, web searches, MCP calls, file changes, and item errors.

Final assistant transcript content is derived only from completed assistant-message items, so transient agent chatter does not get prepended to the saved response unless Codex actually emits it as final content.

## Sessions

Quick Skills keeps session isolation at the plugin level and does not expose every Codex session on disk:

- **New session** creates a plugin-owned placeholder handle.
- The first streamed run starts a real Codex thread.
- When Codex returns the real thread ID, the plugin adopts it and migrates the local transcript state.
- The session dropdown only shows session IDs created or adopted by Quick Skills.

Session metadata is enriched from `~/.codex/sessions`, but only for IDs already managed by the plugin.

## Skills

Skills are stored in plugin settings and support:

- `name`
- `description`
- `promptTemplate`
- optional folder-prefix and frontmatter-tag applicability rules
- favorites and manual ordering

Template variables:

- `{vault_root_path}`
- `{active_file_path}`
- `{selected_text}`

Applicability behavior:

1. Rule-based skills must match to appear.
2. Generic skills always appear.
3. Matching rule-based skills rank ahead of generic ones, with favorites boosted within each group.

## XML request packaging

Every run still sends one canonical XML payload. The prompt is embedded in `<prompt><![CDATA[...]]></prompt>`.

The payload includes:

- vault root path,
- active note path,
- open note paths,
- current editor selection,
- standardized behavior instructions.

It intentionally does not inline full note bodies or frontmatter content.

## Codex-native architecture

The runtime no longer uses a provider-agnostic backend abstraction. The plugin now talks directly to Codex through `@openai/codex-sdk`.

Key modules:

- `src/codex/service.ts`: Codex SDK integration, run lifecycle, cancellation, session creation, model catalog access.
- `src/codex/streamAccumulator.ts`: structured event accumulation for live UX and final-response extraction.
- `src/codex/sessionMetadata.ts`: managed-session enrichment from `~/.codex/sessions`.
- `src/codex/modelCatalog.ts`: model/default discovery from `~/.codex/models_cache.json` and `~/.codex/config.toml`.

Run behavior:

- new sessions call `codex.startThread(...)`,
- existing sessions call `codex.resumeThread(...)`,
- the vault root is passed as Codex `workingDirectory`,
- the mode selector maps to Codex sandbox mode,
- reasoning selection maps to Codex `model_reasoning_effort`,
- `skipGitRepoCheck` stays enabled,
- raw reasoning is enabled through Codex config overrides so reasoning items remain visible during streaming.

## Execution log browser

The **Execution log** in settings is preserved and expanded. Each run stores:

- prompt and canonical XML payload,
- equivalent Codex invocation metadata,
- resolved session id,
- Codex SDK config metadata,
- raw structured event objects for the full streamed turn,
- final response, duration, and status.

The log UI renders both pretty JSON config and a JSONL-style raw event stream so debugging stays possible without scraping CLI stdout.

## Assumptions and migration notes

- This plugin is desktop-only.
- The Codex SDK spawns the configured executable directly. If Obsidian cannot resolve `codex` from its environment, set an absolute path in settings such as `/opt/homebrew/bin/codex`.
- Existing saved transcripts continue to load.
- Existing execution-log entries continue to load; new runs add structured event/config fields.
