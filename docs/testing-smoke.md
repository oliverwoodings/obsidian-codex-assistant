# Codex Assistant manual smoke checklist

Use this checklist before cutting a release. It covers the Obsidian wiring that is intentionally not fully automated in the repo test suite.

1. Enable **Codex Assistant** from **Settings -> Community plugins**.
2. Confirm the **Codex Assistant** settings tab appears and can be opened.
3. Run the `Codex Assistant: Open sidebar` command.
4. Confirm the sidebar appears in the right dock and renders the current session.
5. Switch between notes and confirm the skill menu updates for the active note.
6. Run a manual prompt and verify streamed progress, stop control, and final response rendering.
7. Run a skill and verify the skill pill, note context label, and final response.
8. Click internal note links in assistant output and confirm the target note opens without a transcript scroll jump.
9. Use the copy, insert, and append actions on a final assistant response.
10. Rename a session, archive a session, and create a new session.
11. Disable and re-enable the plugin and confirm commands remain available and the sidebar can be reopened.
12. If dictation is configured, run a dictation pass against a local whisper runtime and confirm transcription inserts into the composer.
