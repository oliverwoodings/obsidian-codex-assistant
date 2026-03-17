# Codex Assistant

Codex Assistant is an Obsidian desktop-only sidebar assistant built explicitly for Codex-native workflows:

- manual chat in a dockable sidebar,
- reusable note-aware skills,
- one-shot local voice dictation via whisper.cpp,
- plugin-managed Codex sessions,
- live structured activity streaming,
- raw event logging for debugging.

## Install and run (development)

1. Copy this plugin into `<Vault>/.obsidian/plugins/obsidian-codex-assistant/`.
2. Install dependencies with `npm install`.
3. Build once with `npm run build`.
4. In Obsidian desktop, open **Settings → Community plugins** and enable **Codex Assistant**.

For watch mode during development, run `npm run dev`.

## Commands

- `Codex Assistant: Open sidebar`
- `Codex Assistant: Run skill…`
- `Codex Assistant: New session`

The ribbon icon also opens the skill picker for the current note.

## Sidebar UX

The sidebar keeps the existing low-touch flow and now exposes richer Codex state while a run is active:

- session dropdown and **New** session,
- manual chat input with **Enter** to send and **Shift+Enter** for newline,
- model, reasoning, and mode selectors,
- a voice dictation button that records first and transcribes after you stop,
- a skill-run button that lists only skills applicable to the active note,
- **Stop** to cancel an active run,
- assistant actions: **Copy**, **Insert at cursor**, **Append to note**,
- live assistant panels for:
  - reasoning summaries,
  - draft assistant text before the final response settles,
  - structured activity cards for commands, todo updates, web searches, MCP calls, file changes, and item errors.

Final assistant transcript content is derived only from completed assistant-message items, so transient agent chatter does not get prepended to the saved response unless Codex actually emits it as final content.

## Sessions

Codex Assistant keeps session isolation at the plugin level and does not expose every Codex session on disk:

- **New session** creates a plugin-owned placeholder handle.
- The first streamed run starts a real Codex thread.
- When Codex returns the real thread ID, the plugin adopts it and migrates the local transcript state.
- The session dropdown only shows session IDs created or adopted by Codex Assistant.

Session metadata is enriched from `~/.codex/sessions`, but only for IDs already managed by the plugin.

## Skills

Skills are stored in plugin settings and support:

- `name`
- `prompt`
- optional reasoning override
- optional sandbox-mode override
- optional folder-prefix rule
- optional multi-tag frontmatter rule (`OR` matching)
- manual ordering

Applicability behavior:

1. Rule-based skills must match to appear.
2. Generic skills always appear.
3. Matching rule-based skills rank ahead of generic ones.

## Voice dictation

Codex Assistant supports one-shot voice dictation in the sidebar composer:

- click the microphone button to start recording,
- while recording, the model/reasoning/mode selectors are replaced with a live audio meter,
- click the microphone button again to stop,
- the recorded audio is then transcribed once through a local whisper.cpp server and inserted into the composer for review before sending.

This path is intentionally accuracy-first rather than realtime.

Settings:

- whisper base URL,
- optional language hint,
- final transcription timeout.

By default this expects a shared local whisper runtime at `http://127.0.0.1:8080`.

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
- Voice dictation expects a local whisper.cpp HTTP server. This can be provided by the shared `whisper-local-runtime` repo or any compatible whisper.cpp server exposing `/inference`.
- Existing saved transcripts continue to load.
- Existing execution-log entries continue to load; new runs add structured event/config fields.

## Manual migration from `obsidian-quick-skills`

This rename is a clean break to the new plugin ID `obsidian-codex-assistant`.

What changes:

- the plugin folder changes from `.obsidian/plugins/obsidian-quick-skills/` to `.obsidian/plugins/obsidian-codex-assistant/`
- saved data is now read from the new plugin folder
- command IDs have changed, so hotkeys need to be rebound
- the sidebar view type has changed, so existing workspace layout will not restore the old sidebar automatically

To preserve settings and session transcripts:

1. Disable **Quick Skills** in **Settings → Community plugins**.
2. Copy or rename `.obsidian/plugins/obsidian-quick-skills/` to `.obsidian/plugins/obsidian-codex-assistant/`.
3. Make sure the old `data.json` is copied into the new plugin folder if you want to preserve settings and local session state.
4. Rebuild or replace the plugin files in the new folder.
5. Enable **Codex Assistant**.
6. Rebind any hotkeys for the renamed commands.
7. Reopen the sidebar once so Obsidian stores the new view type in workspace state.
