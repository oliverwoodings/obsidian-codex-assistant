import { describe, expect, it, vi } from "vitest";
import { RunController } from "../../src/state/runController";
import { SessionStore } from "../../src/state/sessionStore";
import type { CodexAssistantAppState } from "../../src/state/appState";
import type { CodexRunResult } from "../../src/codex/runExecutor";
import { buildMessage, buildPluginData, buildSessionSummary, buildSkill } from "../helpers/builders";
import { createApp, createMarkdownView } from "../helpers/fakes";

interface Deferred<T> {
	promise: Promise<T>;
	resolve: (value: T) => void;
	settled: () => boolean;
}

interface RunControl {
	request: { sessionId: string };
	resolve: (result: CodexRunResult) => void;
	cancel: () => void;
}

function createDeferred<T>(): Deferred<T> {
	let resolve!: (value: T) => void;
	let settled = false;
	const promise = new Promise<T>((res) => {
		resolve = (value) => {
			settled = true;
			res(value);
		};
	});
	return { promise, resolve, settled: () => settled };
}

function createState(overrides: Partial<CodexAssistantAppState> = {}): CodexAssistantAppState {
	return {
		settings: buildPluginData(),
		sessions: [],
		activeSessionId: "",
		lastFocusedNotePath: null,
		modelCatalog: { models: [] },
		...overrides,
	};
}

function createRunExecutorMock() {
	const controls: RunControl[] = [];
	const startRun = vi.fn((request: { sessionId: string }) => {
		const deferred = createDeferred<CodexRunResult>();
		const control: RunControl = {
			request,
			resolve: deferred.resolve,
			cancel: () => {
				if (!deferred.settled()) {
					deferred.resolve({
						sessionId: request.sessionId,
						finalContent: "",
						cancelled: true,
						errorMessage: "",
					});
				}
			},
		};
		controls.push(control);
		return {
			cancel: control.cancel,
			promise: deferred.promise,
		};
	});
	return { startRun, controls };
}

async function flushMicrotasks(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
}

function createHarness(options: {
	activeSessionId?: string;
	executor?: ReturnType<typeof createRunExecutorMock>;
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
	};
	const sessionStore = new SessionStore({
		app,
		state,
		codex: codex as never,
		settingsRepository: { saveSoon, saveNow } as never,
		notifyUi,
	});
	const executor = options.executor ?? createRunExecutorMock();
	const controller = new RunController({
		app,
		state,
		runExecutor: { startRun: executor.startRun } as never,
		sessionStore,
		settingsRepository: { saveSoon, saveNow } as never,
		notifyUi,
		notifyExecutionLogUpdated,
	});
	return { app, state, codex, sessionStore, controller, saveSoon, saveNow, notifyUi, notifyExecutionLogUpdated, executor };
}

describe("RunController", () => {
	it("runs a manual prompt end-to-end and adopts the resolved session id", async () => {
		const executor = createRunExecutorMock();
		executor.startRun.mockImplementation((request: { sessionId: string }, handlers: {
			onInvocation?: (command: string, args: string[], config: unknown) => void;
			onEvent?: (event: unknown) => void;
			onLiveState?: (state: unknown) => void;
			onFinalContent?: (content: string) => void;
		}) => {
			const deferred = createDeferred<CodexRunResult>();
			handlers.onInvocation?.("codex", ["exec"], {
				transport: "codex-sdk",
				streamingProtocol: "experimental-json",
				executablePath: "codex",
				sessionStrategy: "new",
				requestedSessionId: request.sessionId,
				skipGitRepoCheck: true,
				configOverrides: {},
			});
			handlers.onEvent?.({ timestamp: 1, type: "thread.started", payload: { type: "thread.started", thread_id: "resolved-session" } });
			handlers.onLiveState?.({ traceItems: [{ id: "reason-1", kind: "reasoning", text: "Thinking" }] });
			handlers.onFinalContent?.("Final content");
			deferred.resolve({
				sessionId: "resolved-session",
				finalContent: "Final content",
				cancelled: false,
				errorMessage: "",
			});
			return {
				cancel: () => undefined,
				promise: deferred.promise,
			};
		});
		const harness = createHarness({ executor });

		await harness.controller.runManualPrompt("Summarize this");

		expect(executor.startRun).toHaveBeenCalledWith(expect.objectContaining({
			sessionId: "new-session-1",
			xmlPayload: expect.stringContaining('kind="manual"'),
			workingDirectory: "/vault",
		}), expect.any(Object));
		expect(harness.controller.isSessionRunning("resolved-session")).toBe(false);
		expect(harness.controller.getActiveSessionRunState()).toBeUndefined();
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

	it("allows background runs in different sessions but blocks a second run in the same session", async () => {
		const harness = createHarness({ activeSessionId: "session-1" });
		harness.state.settings.managedSessionIds = ["session-1", "session-2"];
		harness.state.settings.transcripts["session-1"] = [];
		harness.state.settings.transcripts["session-2"] = [];

		const firstRun = harness.controller.runManualPrompt("One");
		await flushMicrotasks();
		expect(harness.executor.startRun).toHaveBeenCalledTimes(1);
		expect(harness.controller.isSessionRunning("session-1")).toBe(true);

		await flushMicrotasks();
		await harness.sessionStore.setActiveSession("session-2");
		const secondRun = harness.controller.runManualPrompt("Two");
		await flushMicrotasks();
		expect(harness.executor.startRun).toHaveBeenCalledTimes(2);
		expect(harness.controller.isSessionRunning("session-2")).toBe(true);
		expect(harness.controller.getActiveSessionRunState()).toEqual(expect.objectContaining({ sessionId: "session-2" }));

		await expect(harness.controller.runManualPrompt("Blocked")).resolves.toBe(false);
		expect(harness.executor.startRun).toHaveBeenCalledTimes(2);

		const [firstControl, secondControl] = harness.executor.controls;
		firstControl?.resolve({
			sessionId: "session-1",
			finalContent: "First complete",
			cancelled: false,
			errorMessage: "",
		});
		secondControl?.resolve({
			sessionId: "session-2",
			finalContent: "Second complete",
			cancelled: false,
			errorMessage: "",
		});
		await expect(firstRun).resolves.toBe(true);
		await expect(secondRun).resolves.toBe(true);

		expect(harness.controller.isSessionRunning("session-1")).toBe(false);
		expect(harness.controller.isSessionRunning("session-2")).toBe(false);
	});

	it("cancels the active session run without cancelling a different session", async () => {
		const harness = createHarness({ activeSessionId: "session-1" });
		harness.state.settings.managedSessionIds = ["session-1", "session-2"];
		harness.state.settings.transcripts["session-1"] = [];
		harness.state.settings.transcripts["session-2"] = [];

		const firstRun = harness.controller.runManualPrompt("One");
		await flushMicrotasks();
		await harness.sessionStore.setActiveSession("session-2");
		const secondRun = harness.controller.runManualPrompt("Two");
		await flushMicrotasks();

		expect(harness.controller.isSessionRunning("session-1")).toBe(true);
		expect(harness.controller.isSessionRunning("session-2")).toBe(true);

		harness.controller.cancelCurrentRun();
		expect(harness.controller.isSessionRunning("session-2")).toBe(true);
		expect(harness.controller.isSessionRunning("session-1")).toBe(true);

		const firstControl = harness.executor.controls.find((control) => control.request.sessionId === "session-1");
		const secondControl = harness.executor.controls.find((control) => control.request.sessionId === "session-2");
		expect(firstControl).toBeDefined();
		expect(secondControl).toBeDefined();
		firstControl?.resolve({
			sessionId: "session-1",
			finalContent: "First complete",
			cancelled: false,
			errorMessage: "",
		});
		secondControl?.resolve({
			sessionId: "session-2",
			finalContent: "",
			cancelled: true,
			errorMessage: "",
		});

		await expect(firstRun).resolves.toBe(true);
		await expect(secondRun).resolves.toBe(true);

		expect(harness.controller.isSessionRunning("session-1")).toBe(false);
		expect(harness.controller.isSessionRunning("session-2")).toBe(false);
		expect(harness.state.settings.executionLog[0]).toEqual(expect.objectContaining({ sessionId: "session-2", status: "stopped" }));
	});

	it("cancels execution-log runs by log id even when the session is not active", async () => {
		const harness = createHarness({ activeSessionId: "session-1" });
		harness.state.settings.managedSessionIds = ["session-1", "session-2"];
		harness.state.settings.transcripts["session-1"] = [];
		harness.state.settings.transcripts["session-2"] = [];

		const firstRun = harness.controller.runManualPrompt("One");
		await flushMicrotasks();
		await harness.sessionStore.setActiveSession("session-2");
		const secondRun = harness.controller.runManualPrompt("Two");
		await flushMicrotasks();

		const [firstControl, secondControl] = harness.executor.controls;
		expect(firstControl).toBeDefined();
		expect(secondControl).toBeDefined();
		expect(harness.controller.cancelExecutionLogRun(harness.state.settings.executionLog[1]?.id ?? "")).toBe(true);
		expect(harness.controller.isSessionRunning("session-1")).toBe(true);
		expect(harness.controller.isSessionRunning("session-2")).toBe(true);

		firstControl?.resolve({
			sessionId: "session-1",
			finalContent: "First complete",
			cancelled: false,
			errorMessage: "",
		});
		secondControl?.resolve({
			sessionId: "session-2",
			finalContent: "",
			cancelled: true,
			errorMessage: "",
		});

		await expect(firstRun).resolves.toBe(true);
		await expect(secondRun).resolves.toBe(true);
	});

	it("runs a skill with overrides and records error responses", async () => {
		const harness = createHarness({
			activeSessionId: "session-1",
		});
		harness.state.settings.transcripts["session-1"] = [];
		harness.state.settings.managedSessionIds = ["session-1"];
		const skill = buildSkill({
			name: "Review note",
			prompt: "Review this note",
			reasoningEffort: "medium",
			sandboxMode: "workspace-write",
		});
		const executor = harness.executor;
		executor.startRun.mockImplementation((request: { sessionId: string }, handlers: {
			onInvocation?: (command: string, args: string[], config: unknown) => void;
			onEvent?: (event: unknown) => void;
			onLiveState?: (state: unknown) => void;
			onFinalContent?: (content: string) => void;
		}) => {
			const deferred = createDeferred<CodexRunResult>();
			handlers.onFinalContent?.("");
			deferred.resolve({
				sessionId: request.sessionId,
				finalContent: "",
				cancelled: false,
				errorMessage: "Codex failed",
			});
			return {
				cancel: () => undefined,
				promise: deferred.promise,
			};
		});

		await harness.controller.runSkill(skill, skill.reasoningEffort, skill.sandboxMode);

		expect(executor.startRun).toHaveBeenCalledWith(expect.objectContaining({
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
});
