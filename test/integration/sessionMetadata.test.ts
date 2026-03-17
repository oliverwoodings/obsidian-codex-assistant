import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

async function loadSessionMetadataModule(sessionRoot: string) {
	vi.resetModules();
	process.env.CODEX_ASSISTANT_SESSION_ROOT = sessionRoot;
	return await import("../../src/codex/sessionMetadata");
}

describe("sessionMetadata", () => {
	let homePath = "";
	let sessionRoot = "";

	beforeEach(async () => {
		homePath = await mkdtemp(join(tmpdir(), "codex-assistant-home-"));
		sessionRoot = join(homePath, ".codex", "sessions");
		await mkdir(sessionRoot, { recursive: true });
	});

	afterEach(() => {
		vi.resetModules();
		delete process.env.CODEX_ASSISTANT_SESSION_ROOT;
	});

	it("lists known sessions, prefers the latest rollout, and respects overrides", async () => {
		const sessionId = "019cc05f-1234-1234-1234-123456789abc";
		const secondSessionId = "019cc05f-9999-1234-1234-123456789abc";
		const nested = join(sessionRoot, "workspace", "nested");
		await mkdir(nested, { recursive: true });
		await writeFile(join(nested, `rollout-${sessionId}.jsonl`), `${JSON.stringify({
			payload: {
				timestamp: "2026-03-12T13:00:00.000Z",
				cwd: "/Users/test/project-alpha",
				originator: "codex-assistant",
			},
		})}\n`);
		await writeFile(join(nested, `rollout-${secondSessionId}.jsonl`), "not json\n");
		await writeFile(join(sessionRoot, "codex-assistant-session-overrides.json"), JSON.stringify({
			version: 1,
			sessions: {
				[sessionId]: { name: "Renamed session", updatedAt: 123 },
				[secondSessionId]: { archived: true },
			},
		}));
		const mod = await loadSessionMetadataModule(sessionRoot);

		const sessions = await mod.listKnownCodexSessions();

		expect(sessions).toHaveLength(1);
		expect(sessions[0]).toEqual(expect.objectContaining({
			id: sessionId,
			title: "Renamed session",
			customTitle: "Renamed session",
			workspaceLabel: "project-alpha",
			tooltip: expect.stringContaining("Origin: codex-assistant"),
		}));
	});

	it("writes rename and archive overrides and moves metadata between ids", async () => {
		const mod = await loadSessionMetadataModule(sessionRoot);

		await mod.renameCodexSession("session-1", "  My title  ");
		await mod.archiveCodexSession("session-2");
		await mod.moveCodexSessionMetadata("session-1", "session-3");

		const overridesPath = join(sessionRoot, "codex-assistant-session-overrides.json");
		const overrides = JSON.parse(await readFile(overridesPath, "utf8")) as {
			sessions: Record<string, { name?: string; archived?: boolean }>;
		};

		expect(overrides.sessions["session-1"]).toBeUndefined();
		expect(overrides.sessions["session-2"]).toEqual(expect.objectContaining({ archived: true }));
		expect(overrides.sessions["session-3"]).toEqual(expect.objectContaining({ name: "My title" }));
	});

	it("recovers safely from malformed overrides", async () => {
		await writeFile(join(sessionRoot, "codex-assistant-session-overrides.json"), "{bad json");
		const mod = await loadSessionMetadataModule(sessionRoot);

		await expect(mod.listKnownCodexSessions()).resolves.toEqual([]);
	});
});
