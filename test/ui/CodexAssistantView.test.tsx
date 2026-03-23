import { screen, waitFor } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../../src/settings";
import { CodexAssistantView } from "../../src/ui/CodexAssistantView";
import { buildMessage, buildSessionSummary, buildSkill } from "../helpers/builders";
import { createApp, createLeaf } from "../helpers/fakes";
import { markdownRenderMock, notices } from "../helpers/obsidianMock";

const dictationStartMock = vi.fn(async () => undefined);
const dictationStopMock = vi.fn(async () => "Dictated transcript");
const dictationAbortMock = vi.fn(async () => undefined);

vi.mock("../../src/voice/dictationSession", () => ({
	DictationSession: class DictationSession {
		constructor(
			_publicConfig: unknown,
			private readonly handlers?: { onLevel?: (level: number) => void }
		) {}

		async start(): Promise<void> {
			this.handlers?.onLevel?.(0.5);
			await dictationStartMock();
		}

		async stopAndTranscribe(): Promise<string> {
			return await dictationStopMock();
		}

		async abort(): Promise<void> {
			await dictationAbortMock();
		}
	},
}));

function createPluginStub() {
	const app = createApp();
	const plugin = {
		app,
		settings: {
			...DEFAULT_SETTINGS,
			selectedModel: "gpt-5.3-codex",
			selectedReasoningEffort: "high",
			sandboxMode: "read-only" as const,
		},
		sessions: [
			buildSessionSummary({ id: "session-1", label: "Session 1" }),
			buildSessionSummary({ id: "session-2", label: "Session 2" }),
		],
		activeSessionId: "session-1",
		currentMessages: [
			buildMessage({ id: "user-1", role: "user", content: "User message" }),
			buildMessage({
				id: "assistant-1",
				role: "assistant",
				content: "Assistant **reply**",
				turnTrace: {
					items: [{ id: "reason-1", kind: "reasoning", text: "Thinking" }],
					durationMs: 2_000,
				},
			}),
			buildMessage({
				id: "skill-1",
				role: "skill",
				skillName: "Summarize this note",
				activeNotePath: "Notes/Current.md",
				content: "Skill prompt",
			}),
			buildMessage({ id: "error-1", role: "error", content: "Something failed" }),
		],
		currentSkills: [buildSkill({ id: "skill-a", name: "Summarize this note" })],
		getCurrentTranscript: vi.fn(() => plugin.currentMessages),
		getApplicableSkills: vi.fn(() => plugin.currentSkills),
		getActiveSessionSummary: vi.fn(() => plugin.sessions.find((session) => session.id === plugin.activeSessionId)),
		sessionRuns: new Set<string>(),
		getActiveSessionRunState: vi.fn(() => (
			plugin.sessionRuns.has(plugin.activeSessionId)
				? {
					sessionId: plugin.activeSessionId,
					assistantMessageId: "assistant-live",
					executionLogId: "run-1",
					startedAt: 1,
					cancelRequested: false,
				}
				: undefined
		)),
		isSessionRunning: vi.fn((sessionId: string) => plugin.sessionRuns.has(sessionId)),
		getMarkdownRenderSourcePath: vi.fn(() => "Notes/Current.md"),
		getExecutionLogForAssistantMessage: vi.fn(() => undefined),
		getAvailableModels: vi.fn(() => [{ id: "gpt-5.3-codex", label: "GPT-5.3", reasoningEfforts: ["low", "high"] }]),
		getReasoningOptionsForModel: vi.fn(() => ["low", "high"]),
		getAvailableSandboxModes: vi.fn(() => ["read-only", "workspace-write", "danger-full-access"]),
		setActiveSession: vi.fn(async (sessionId: string) => {
			plugin.activeSessionId = sessionId;
		}),
		runManualPrompt: vi.fn(async () => undefined),
		runSkill: vi.fn(async () => undefined),
		cancelCurrentRun: vi.fn(),
		cancelSessionRun: vi.fn(() => false),
		insertIntoActiveNote: vi.fn(async () => undefined),
		setSelectedModel: vi.fn(async (value: string) => {
			plugin.settings.selectedModel = value;
		}),
		setSelectedReasoningEffort: vi.fn(async (value: string) => {
			plugin.settings.selectedReasoningEffort = value;
		}),
		setSandboxMode: vi.fn(async (value: typeof plugin.settings.sandboxMode) => {
			plugin.settings.sandboxMode = value;
		}),
		createAndSelectSession: vi.fn(async () => undefined),
		renameSession: vi.fn(async () => undefined),
		archiveSession: vi.fn(async () => undefined),
	};
	return plugin;
}

async function renderView(plugin = createPluginStub()) {
	const leaf = createLeaf();
	const view = new CodexAssistantView(leaf, plugin as never);
	document.body.appendChild(view.contentEl);
	await view.onOpen();
	return { view, plugin };
}

describe("CodexAssistantView", () => {
	beforeEach(() => {
		dictationStartMock.mockClear();
		dictationStopMock.mockClear();
		dictationAbortMock.mockClear();
		notices.length = 0;
		markdownRenderMock.mockImplementation(async (_app, text, el) => {
			el.textContent = text;
		});
	});

	it("renders transcript content for user, assistant, skill, and error messages", async () => {
		await renderView();

		await waitFor(() => {
			expect(screen.getByText("User message")).not.toBeNull();
			expect(screen.getByText("Assistant **reply**")).not.toBeNull();
		});
		expect(screen.getAllByText("Summarize this note").length).toBeGreaterThan(0);
		expect(screen.getByText("Current")).not.toBeNull();
		expect(screen.getByText("Something failed")).not.toBeNull();
	});

	it("submits trimmed prompts, updates sessions, and rerenders when requested", async () => {
		const user = userEvent.setup();
		const { plugin, view } = await renderView();

		const sessionSelect = document.querySelector(".codex-assistant-session-select");
		if (!(sessionSelect instanceof HTMLSelectElement)) {
			throw new Error("Missing session select");
		}
		await user.selectOptions(sessionSelect, "session-2");
		expect(plugin.setActiveSession).toHaveBeenCalledWith("session-2");

		const input = screen.getByLabelText("Prompt input");
		await user.type(input, "  Follow up  ");
		await user.click(screen.getByLabelText("Send prompt"));

		expect(plugin.runManualPrompt).toHaveBeenCalledWith("Follow up");
		expect((input as HTMLTextAreaElement).value).toBe("");

		plugin.currentMessages = [buildMessage({ role: "assistant", content: "Updated reply" })];
		view.requestRender("transcript");

		await waitFor(() => {
			expect(screen.getByText("Updated reply")).not.toBeNull();
		});
	});

	it("routes internal note links through the workspace and shows stop state while running", async () => {
		const user = userEvent.setup();
		const plugin = createPluginStub();
		plugin.sessionRuns.add("session-1");
		plugin.currentMessages = [
			buildMessage({
				id: "assistant-live",
				role: "assistant",
				content: "Final [[Target note]]",
				isStreaming: true,
				turnTrace: {
					items: [{ id: "activity-1", kind: "activity", activity: { id: "activity-1", kind: "web_search", status: "running", title: "Search" } }],
				},
			}),
			buildMessage({
				id: "assistant-final",
				role: "assistant",
				content: "[[Target note]]",
			}),
		];
		markdownRenderMock.mockImplementation(async (_app, text, el) => {
			if (text.includes("[[Target note]]")) {
				const anchor = document.createElement("a");
				anchor.className = "internal-link";
				anchor.href = "#";
				anchor.dataset.href = "Target note";
				anchor.textContent = "Target note";
				el.appendChild(anchor);
				return;
			}
			el.textContent = text;
		});
		await renderView(plugin);

		expect(screen.getByText("Running", { selector: ".codex-assistant-session-status" })).not.toBeNull();
		expect(screen.getByText("Using tools")).not.toBeNull();
		expect(screen.getByLabelText("Stop run")).not.toBeNull();
		await user.click(screen.getByLabelText("Stop run"));
		expect(plugin.cancelCurrentRun).toHaveBeenCalled();

		await waitFor(() => {
			expect(document.querySelector("a.internal-link")).not.toBeNull();
		});
		const internalLink = document.querySelector("a.internal-link");
		if (!(internalLink instanceof HTMLAnchorElement)) {
			throw new Error("Missing internal link");
		}
		await user.click(internalLink);
		expect(plugin.app.workspace.openLinkText).toHaveBeenCalledWith("Target note", "Notes/Current.md", false);
	});

	it("shows the empty skill state, runs a skill, and supports dictation", async () => {
		const user = userEvent.setup();
		const plugin = createPluginStub();
		plugin.currentSkills = [];
		const rendered = await renderView(plugin);

		expect(screen.getByText("No skills for this note")).not.toBeNull();

		plugin.currentSkills = [buildSkill({ id: "skill-b", name: "Brainstorm" })];
		rendered.view.requestRender("skills");
		await waitFor(() => {
			expect(screen.getByText("Brainstorm")).not.toBeNull();
		});
		await user.click(screen.getByText("Brainstorm"));
		expect(plugin.runSkill).toHaveBeenCalledWith(expect.objectContaining({ id: "skill-b", name: "Brainstorm" }));

		await user.click(screen.getByLabelText("Start dictation"));
		expect(dictationStartMock).toHaveBeenCalled();
		expect(screen.getByText("Listening...")).not.toBeNull();

		await user.click(screen.getByLabelText("Stop dictation"));
		await waitFor(() => {
			expect(screen.getByDisplayValue("Dictated transcript")).not.toBeNull();
		});
		expect(dictationStopMock).toHaveBeenCalled();
	});

	it("copies and inserts final assistant messages", async () => {
		const user = userEvent.setup();
		const { plugin } = await renderView();
		const writeTextSpy = vi.spyOn(navigator.clipboard, "writeText");

		await user.click(screen.getByLabelText("Copy message"));
		expect(writeTextSpy).toHaveBeenCalledWith("Assistant **reply**");
		expect(notices).toContain("Assistant message copied.");

		await user.click(screen.getByLabelText("Insert at cursor"));
		await user.click(screen.getByLabelText("Append to note"));
		expect(plugin.insertIntoActiveNote).toHaveBeenNthCalledWith(1, "Assistant **reply**", "cursor");
		expect(plugin.insertIntoActiveNote).toHaveBeenNthCalledWith(2, "Assistant **reply**", "append");
	});
});
