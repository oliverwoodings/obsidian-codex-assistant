import { describe, expect, it, vi } from "vitest";
import { RunController } from "../../src/state/runController";
import { SessionStore } from "../../src/state/sessionStore";
import type { CodexAssistantAppState } from "../../src/state/appState";
import { DEFAULT_SETTINGS } from "../../src/settings";
import { buildMessage, buildPluginData, buildSessionSummary, buildSkill } from "../helpers/builders";
import { createApp, createMarkdownView } from "../helpers/fakes";

function createState(overrides: Partial<CodexAssistantAppState> = {}): CodexAssistantAppState {
	return {
		settings: buildPluginData(),
		sessions: [],
		activeSessionId: "",
		isRunning: false,
		currentAssistantMessageId: null,
		currentRunLogId: null,
		cancelRequested: false,
		lastFocusedNotePath: null,
		modelCatalog: { models: [] },
		...overrides,
	};
}

function createHarness(options: {
	runImpl?: Parameters<RunController["constructor"]>[0]["codex"]["run"];
	activeSessionId?: string;
} = {}) {
	const app = createApp({
		workspace: {
			getActiveViewOfType: vi.fn(() => createMarkdownView("Notes/Active.md", "Selected text")),
			getLeavesOfType: vi.fn(() => []),
		},
		vault: {
			adapter: { basePath: "/vault" },
		},
	});
	const state = createState({
		activeSessionId: options.activeSessionId ?? "",
		settings: buildPluginData({
			selectedModel: "gpt-5.3-codex",
			selectedReasoningEffort: "high",
			sandboxMode: "read-only",
		}),
	});
	const saveSoon = vi.fn();
	const saveNow = vi.fn(async () => undefined);
	const notifyUi = vi.fn();
	const notifyExecutionLogUpdated = vi.fn();
	const codex = {
		createSession: vi.fn(() => buildSessionSummary({ id: "new-session-1", label: "New session" })),
		listSessions: vi.fn(async () => [buildSessionSummary({ id: "new-session-1", label: "New session" })]),
		adoptSessionMetadata: vi.fn(async () => undefined),
		renameSession: vi.fn(async () => undefined),
		archiveSession: vi.fn(async () => undefined),
		cancel: vi.fn(),
		run: options.runImpl ?? vi.fn(async (_request, handlers) => {
			handlers.onInvocation?.("codex", ["exec"], {
				transport: "codex-sdk",
				streamingProtocol: "experimental-json",
				executablePath: "codex",
				sessionStrategy: "new",
				requestedSessionId: "new-session-1",
				skipGitRepoCheck: true,
				configOverrides: {},
			});
			handlers.onEvent?.({ timestamp: 1, type: "thread.started", payload: { type: "thread.started", thread_id: "resolved-session" } });
			handlers.onLiveState?.({ traceItems: [{ id: "reason-1", kind: "reasoning", text: "Thinking" }] });
			handlers.onFinalContent?.("Final content");
			return {
				sessionId: "resolved-session",
				finalContent: "Final content",
				cancelled: false,
				errorMessage: "",
			};
		}),
	};
	const sessionStore = new SessionStore({
		app,
		state,
		codex: codex as never,
		settingsRepository: { saveSoon, saveNow } as never,
		notifyUi,
	});
	const controller = new RunController({
		app,
		state,
		codex: codex as never,
		sessionStore,
		settingsRepository: { saveSoon, saveNow } as never,
		notifyUi,
		notifyExecutionLogUpdated,
	});
	return { app, state, codex, sessionStore, controller, saveSoon, saveNow, notifyUi, notifyExecutionLogUpdated };
}

describe("RunController", () => {
	it("runs a manual prompt end-to-end and adopts the resolved session id", async () => {
		const harness = createHarness();

		await harness.controller.runManualPrompt("Summarize this");

		expect(harness.codex.run).toHaveBeenCalledWith(expect.objectContaining({
			sessionId: "new-session-1",
			xmlPayload: expect.stringContaining('kind="manual"'),
			workingDirectory: "/vault",
		}), expect.any(Object));
		expect(harness.state.isRunning).toBe(false);
		expect(harness.state.currentRunLogId).toBeNull();
		expect(harness.state.activeSessionId).toBe("resolved-session");
		expect(harness.state.settings.executionLog[0]).toEqual(expect.objectContaining({
			status: "success",
			response: "Final content",
			sessionId: "resolved-session",
		}));
		expect(harness.state.settings.transcripts["resolved-session"]).toEqual([
			expect.objectContaining({ role: "user", content: "Summarize this" }),
			expect.objectContaining({
				role: "assistant",
				content: "Final content",
				isStreaming: false,
				turnTrace: expect.objectContaining({
					items: [{ id: "reason-1", kind: "reasoning", text: "Thinking", activity: undefined, isDraft: undefined }],
				}),
			}),
		]);
		expect(harness.saveNow).toHaveBeenCalled();
		expect(harness.notifyExecutionLogUpdated).toHaveBeenCalled();
	});

	it("runs a skill with overrides and records error responses", async () => {
		const harness = createHarness({
			activeSessionId: "session-1",
			runImpl: vi.fn(async (request, handlers) => {
				handlers.onFinalContent?.("");
				return {
					sessionId: request.sessionId,
					finalContent: "",
					cancelled: false,
					errorMessage: "Codex failed",
				};
			}),
		});
		harness.state.settings.transcripts["session-1"] = [];
		harness.state.settings.managedSessionIds = ["session-1"];
		const skill = buildSkill({
			name: "Review note",
			prompt: "Review this note",
			reasoningEffort: "medium",
			sandboxMode: "workspace-write",
		});

		await harness.controller.runSkill(skill, skill.reasoningEffort, skill.sandboxMode);

		expect(harness.codex.run).toHaveBeenCalledWith(expect.objectContaining({
			sessionId: "session-1",
			reasoningEffort: "medium",
			sandboxMode: "workspace-write",
			xmlPayload: expect.stringContaining('kind="skill"'),
		}), expect.any(Object));
		expect(harness.state.settings.executionLog[0]).toEqual(expect.objectContaining({
			requestKind: "skill",
			skillName: "Review note",
			status: "error",
			errorMessage: "Codex failed",
		}));
		expect(harness.state.settings.transcripts["session-1"]).toEqual([
			expect.objectContaining({ role: "skill", skillName: "Review note", activeNotePath: "Notes/Active.md" }),
			expect.objectContaining({ role: "assistant", content: "", isStreaming: false }),
			expect.objectContaining({ role: "error", content: "Codex failed" }),
		]);
	});

	it("cancels the current run and clears control state", async () => {
		const harness = createHarness({ activeSessionId: "session-1" });
		harness.state.isRunning = true;
		harness.state.currentAssistantMessageId = "assistant-1";
		harness.state.currentRunLogId = "run-1";
		harness.state.settings.transcripts["session-1"] = [
			buildMessage({ id: "assistant-1", role: "assistant", isStreaming: true }),
		];

		expect(harness.controller.cancelExecutionLogRun("other")).toBe(false);

		const cancelled = harness.controller.cancelExecutionLogRun("run-1");

		expect(cancelled).toBe(true);
		expect(harness.codex.cancel).toHaveBeenCalled();
		expect(harness.state.isRunning).toBe(false);
		expect(harness.state.currentAssistantMessageId).toBeNull();
		expect(harness.state.settings.transcripts["session-1"]?.[0]).toEqual(expect.objectContaining({ isStreaming: false }));
		expect(harness.notifyUi).toHaveBeenCalledWith("controls");
	});
});
