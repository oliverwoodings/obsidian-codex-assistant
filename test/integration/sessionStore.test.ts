import { describe, expect, it, vi } from "vitest";
import { SessionStore } from "../../src/state/sessionStore";
import type { CodexAssistantAppState } from "../../src/state/appState";
import { DEFAULT_SETTINGS } from "../../src/settings";
import { buildMessage, buildPluginData, buildSessionSummary } from "../helpers/builders";
import { createApp } from "../helpers/fakes";

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

describe("SessionStore", () => {
	it("creates and selects sessions, then appends and updates transcript messages", async () => {
		const state = createState();
		const saveSoon = vi.fn();
		const saveNow = vi.fn(async () => undefined);
		const notifyUi = vi.fn();
		const codex = {
			createSession: vi.fn(() => buildSessionSummary({ id: "session-1", label: "Session 1" })),
			listSessions: vi.fn(async () => [buildSessionSummary({ id: "session-1", label: "Session 1" })]),
			adoptSessionMetadata: vi.fn(async () => undefined),
			renameSession: vi.fn(async () => undefined),
			archiveSession: vi.fn(async () => undefined),
		};
		const store = new SessionStore({
			app: createApp(),
			state,
			codex: codex as never,
			settingsRepository: { saveSoon, saveNow } as never,
			notifyUi,
		});

		await store.createAndSelectSession();
		store.appendMessage(buildMessage({ id: "assistant-1", role: "assistant", content: "Hello" }));
		store.replaceAssistantMessage("assistant-1", "Updated");
		store.setAssistantLiveState("assistant-1", {
			traceItems: [{ id: "activity-1", kind: "reasoning", text: "Thinking" }],
		});
		store.finishAssistantMessage("assistant-1");
		store.setAssistantTurnDuration("assistant-1", 2_000);

		expect(state.activeSessionId).toBe("session-1");
		expect(state.settings.lastSessionId).toBe("session-1");
		expect(state.settings.transcripts["session-1"]).toEqual([
			expect.objectContaining({
				id: "assistant-1",
				content: "Updated",
				isStreaming: false,
				turnTrace: {
					items: [{ id: "activity-1", kind: "reasoning", text: "Thinking", activity: undefined, isDraft: undefined }],
					durationMs: 2_000,
				},
			}),
		]);
		expect(saveNow).toHaveBeenCalled();
		expect(saveSoon).toHaveBeenCalled();
		expect(notifyUi).toHaveBeenCalledWith("transcript");
	});

	it("refreshes sessions, honors last session, and ignores unmanaged activation requests", async () => {
		const state = createState({
			settings: buildPluginData({
				managedSessionIds: ["session-2", "session-1"],
				lastSessionId: "session-1",
				transcripts: {
					"session-1": [buildMessage({ role: "user", content: "Keep this session" })],
				},
			}),
		});
		const codex = {
			createSession: vi.fn(() => buildSessionSummary({ id: "session-new" })),
			listSessions: vi.fn(async () => [
				buildSessionSummary({ id: "session-1", customTitle: "Named session" }),
				buildSessionSummary({ id: "session-2", workspaceLabel: "Repo" }),
			]),
			adoptSessionMetadata: vi.fn(async () => undefined),
			renameSession: vi.fn(async () => undefined),
			archiveSession: vi.fn(async () => undefined),
		};
		const store = new SessionStore({
			app: createApp(),
			state,
			codex: codex as never,
			settingsRepository: { saveSoon: vi.fn(), saveNow: vi.fn(async () => undefined) } as never,
			notifyUi: vi.fn(),
		});

		await store.refreshSessions();
		await store.setActiveSession("missing");

		expect(state.activeSessionId).toBe("session-1");
		expect(state.sessions.map((session) => session.id)).toEqual(["session-2", "session-1"]);
		expect(store.getActiveSessionSummary()).toEqual(expect.objectContaining({ id: "session-1", title: "Named session" }));
	});

	it("adopts resolved session ids and archives sessions cleanly", async () => {
		const state = createState({
			activeSessionId: "new-session-1",
			settings: buildPluginData({
				lastSessionId: "new-session-1",
				managedSessionIds: ["new-session-1", "session-existing"],
				transcripts: {
					"new-session-1": [buildMessage({ id: "msg-1", content: "Draft" })],
					"session-existing": [buildMessage({ id: "msg-2", content: "Existing" })],
				},
			}),
			sessions: [
				buildSessionSummary({ id: "new-session-1", label: "New session" }),
				buildSessionSummary({ id: "session-existing", label: "Existing session" }),
			],
		});
		const refreshSessions = vi.fn(async () => undefined);
		const codex = {
			createSession: vi.fn(() => buildSessionSummary({ id: "session-new" })),
			listSessions: vi.fn(async () => [buildSessionSummary({ id: "session-existing" }), buildSessionSummary({ id: "session-resolved" })]),
			adoptSessionMetadata: vi.fn(async () => undefined),
			renameSession: vi.fn(async () => undefined),
			archiveSession: vi.fn(async () => undefined),
		};
		const store = new SessionStore({
			app: createApp(),
			state,
			codex: codex as never,
			settingsRepository: { saveSoon: vi.fn(), saveNow: vi.fn(async () => undefined) } as never,
			notifyUi: vi.fn(),
		});
		const originalRefresh = store.refreshSessions.bind(store);
		store.refreshSessions = vi.fn(originalRefresh);

		await store.adoptResolvedSessionId("new-session-1", "session-existing");

		expect(state.activeSessionId).toBe("session-existing");
		expect(state.settings.lastSessionId).toBe("session-existing");
		expect(state.settings.managedSessionIds).toEqual(["session-existing"]);
		expect(state.settings.transcripts["session-existing"]?.map((message) => message.id)).toEqual(["msg-2", "msg-1"]);
		expect(codex.adoptSessionMetadata).toHaveBeenCalledWith("new-session-1", "session-existing");

		await store.archiveSession("session-existing");

		expect(codex.archiveSession).toHaveBeenCalledWith("session-existing");
		expect(store.refreshSessions).toHaveBeenCalled();
	});
});
