import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsRepository } from "../../src/state/settingsRepository";
import { DEFAULT_SETTINGS } from "../../src/settings";
import { MAX_EXECUTION_LOG_ENTRIES } from "../../src/state/constants";

describe("SettingsRepository", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("normalizes partial and invalid persisted data", async () => {
		const repository = new SettingsRepository({
			loadData: async () => ({
				codexBinaryPath: "",
				extraPathEntries: ["/opt/homebrew/bin", " ", "/opt/homebrew/bin", 42],
				globalInstructions: 42,
				sandboxMode: "bad-mode",
				whisperBaseUrl: "   ",
				whisperLanguage: 99,
				whisperRequestTimeoutMs: 2_000,
				lastSessionId: "missing",
				managedSessionIds: ["session-1", "session-1", " ", 42],
				transcripts: {
					"session-1": [],
				},
				skills: [
					{ name: "Legacy prompt", promptTemplate: "Use legacy prompt" },
					{ name: "", prompt: "missing name" },
					{
						id: "skill-1",
						name: "Rules",
						prompt: "Prompt",
						sandboxMode: "workspace-write",
						rules: {
							frontmatterTags: ["#Team", "team", ""],
							folderPrefix: "Projects/",
						},
					},
				],
				executionLog: [
					{ id: "bad-entry" },
					{
						id: "run-1",
						timestamp: 1,
						sessionId: "session-1",
						requestKind: "manual",
						prompt: "Prompt",
						xmlPayload: "<xml />",
						command: "codex",
						commandArgs: ["exec"],
						processOutput: "",
						rawEvents: [{ type: "ok", timestamp: 1, payload: { type: "thread.started" } }, null],
						codexConfig: {
							transport: "codex-sdk",
							streamingProtocol: "experimental-json",
							executablePath: "codex",
							sessionStrategy: "resume",
							requestedSessionId: "session-1",
							skipGitRepoCheck: true,
							configOverrides: [],
						},
						response: "",
						errorMessage: "",
						durationMs: 1_000,
						status: "running",
					},
				],
			}),
			saveData: async () => undefined,
		});

		const loaded = await repository.load();

		expect(loaded.codexBinaryPath).toBe("codex");
		expect(loaded.extraPathEntries).toEqual(["/opt/homebrew/bin"]);
		expect(loaded.globalInstructions).toBe(DEFAULT_SETTINGS.globalInstructions);
		expect(loaded.sandboxMode).toBe("read-only");
		expect(loaded.whisperBaseUrl).toBe(DEFAULT_SETTINGS.whisperBaseUrl);
		expect(loaded.whisperLanguage).toBe(DEFAULT_SETTINGS.whisperLanguage);
		expect(loaded.whisperRequestTimeoutMs).toBe(5_000);
		expect(loaded.managedSessionIds).toEqual(["session-1"]);
		expect(loaded.lastSessionId).toBe("session-1");
		expect(loaded.skills).toEqual([
			expect.objectContaining({
				name: "Legacy prompt",
				prompt: "Use legacy prompt",
			}),
			expect.objectContaining({
				id: "skill-1",
				name: "Rules",
				sandboxMode: "workspace-write",
				rules: {
					frontmatterTags: ["Team"],
					folderPrefix: "Projects/",
				},
			}),
		]);
		expect(loaded.executionLog).toEqual([
			expect.objectContaining({
				id: "bad-entry",
				status: "error",
			}),
			expect.objectContaining({
				id: "run-1",
				status: "error",
				rawEvents: [{ type: "ok", timestamp: 1, payload: { type: "thread.started" } }],
				codexConfig: expect.objectContaining({ configOverrides: {} }),
			}),
		]);
	});

	it("falls back to transcript keys for managed sessions and caps execution logs", async () => {
		const entries = Array.from({ length: MAX_EXECUTION_LOG_ENTRIES + 5 }, (_, index) => ({
			id: `run-${index}`,
			timestamp: index,
			sessionId: "session-1",
			requestKind: "manual",
			prompt: "Prompt",
			xmlPayload: "<xml />",
			command: "codex",
			commandArgs: [],
			processOutput: "",
			rawEvents: [],
			response: "",
			errorMessage: "",
			durationMs: 0,
			status: "success",
		}));
		const repository = new SettingsRepository({
			loadData: async () => ({
				managedSessionIds: [],
				transcripts: {
					"session-1": [],
					"session-2": [],
				},
				executionLog: entries,
			}),
			saveData: async () => undefined,
		});

		const loaded = await repository.load();

		expect(loaded.managedSessionIds).toEqual(["session-1", "session-2"]);
		expect(loaded.executionLog).toHaveLength(MAX_EXECUTION_LOG_ENTRIES);
		expect(loaded.executionLog[0]?.id).toBe("run-0");
	});

	it("debounces saveSoon and flushes pending writes", async () => {
		const saveData = vi.fn(async () => undefined);
		const repository = new SettingsRepository({
			loadData: async () => ({}),
			saveData,
		});
		const settings = { ...DEFAULT_SETTINGS };

		repository.saveSoon(settings);
		repository.saveSoon({ ...settings, codexBinaryPath: "other" });
		expect(saveData).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(100);
		expect(saveData).toHaveBeenCalledTimes(1);
		expect(saveData).toHaveBeenLastCalledWith(settings);

		repository.saveSoon(settings);
		await repository.flush(settings);
		expect(saveData).toHaveBeenCalledTimes(2);

		repository.saveSoon(settings);
		await repository.saveNow(settings);
		expect(saveData).toHaveBeenCalledTimes(3);
	});
});
