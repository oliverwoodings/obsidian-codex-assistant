import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, createFile, createLeaf, createMarkdownView } from "../helpers/fakes";

const modelCatalog = {
	models: [
		{ id: "gpt-5.3-codex", label: "GPT-5.3", reasoningEfforts: ["low", "high"], defaultReasoningEffort: "high" },
	],
	defaultModelId: "gpt-5.3-codex",
	defaultReasoningEffort: "high",
};

const codexConstructorSpy = vi.fn();
const codexGetModelCatalogMock = vi.fn(async () => modelCatalog);
const codexCreateSessionMock = vi.fn(() => ({ id: "new-session-1", label: "New session", title: "New session" }));
const codexListSessionsMock = vi.fn(async () => [{ id: "new-session-1", label: "New session", title: "New session" }]);

vi.mock("../../src/codex/service", () => ({
	CodexService: class CodexService {
		constructor(...args: unknown[]) {
			codexConstructorSpy(...args);
		}

		getModelCatalog = codexGetModelCatalogMock;
		createSession = codexCreateSessionMock;
		listSessions = codexListSessionsMock;
		renameSession = vi.fn(async () => undefined);
		archiveSession = vi.fn(async () => undefined);
		adoptSessionMetadata = vi.fn(async () => undefined);
		cancel = vi.fn();
		run = vi.fn();
	},
}));

const skillPickerOpenMock = vi.fn();
vi.mock("../../src/ui/SkillPickerModal", () => ({
	SkillPickerModal: class SkillPickerModal {
		constructor(
			public readonly app: unknown,
			public readonly skills: unknown[],
			public readonly onChoose: (skill: unknown) => void
		) {}

		open(): void {
			skillPickerOpenMock();
		}
	},
}));

const requestRenderMock = vi.fn();
vi.mock("../../src/ui/CodexAssistantView", () => {
	class CodexAssistantView {
		requestRender = requestRenderMock;
	}

	return {
		CODEX_ASSISTANT_VIEW_TYPE: "codex-assistant-sidebar",
		CodexAssistantView,
	};
});

describe("CodexAssistantPlugin", () => {
	beforeEach(() => {
		codexConstructorSpy.mockClear();
		codexGetModelCatalogMock.mockClear();
		codexCreateSessionMock.mockClear();
		codexListSessionsMock.mockClear();
		skillPickerOpenMock.mockClear();
		requestRenderMock.mockClear();
	});

	async function createPlugin() {
		const { default: CodexAssistantPlugin } = await import("../../src/main");
		const leaf = createLeaf();
		const app = createApp({
			workspace: {
				getActiveViewOfType: vi.fn(() => createMarkdownView("Notes/Current.md")),
				ensureSideLeaf: vi.fn(async () => leaf),
				getLeavesOfType: vi.fn(() => []),
			},
		});
		const plugin = new CodexAssistantPlugin(app as never, { id: "obsidian-codex-assistant" } as never);
		plugin.loadData = vi.fn(async () => ({}));
		plugin.saveData = vi.fn(async () => undefined);
		return { plugin, app, leaf };
	}

	it("registers the view, commands, ribbon icon, setting tab, and listeners on load", async () => {
		const { plugin, app } = await createPlugin();

		await plugin.onload();

		expect(plugin.views.has("codex-assistant-sidebar")).toBe(true);
		expect(plugin.commands.map((command) => command.id)).toEqual([
			"codex-assistant-open-sidebar",
			"codex-assistant-run-skill",
			"codex-assistant-new-session",
		]);
		expect(plugin.ribbonIcons[0]?.title).toBe("Codex Assistant");
		expect(plugin.settingTabs).toHaveLength(1);
		expect(app.workspace.on).toHaveBeenCalledWith("active-leaf-change", expect.any(Function));
		expect(app.workspace.on).toHaveBeenCalledWith("file-open", expect.any(Function));
		expect(app.metadataCache.on).toHaveBeenCalledWith("changed", expect.any(Function));
	});

	it("opens the sidebar on user enable and through the explicit activateView path", async () => {
		const { plugin, app, leaf } = await createPlugin();

		await plugin.onload();
		await plugin.onUserEnable();
		await plugin.activateView();

		expect(app.workspace.ensureSideLeaf).toHaveBeenNthCalledWith(1, "codex-assistant-sidebar", "right", {
			active: false,
			reveal: false,
			split: false,
		});
		expect(app.workspace.ensureSideLeaf).toHaveBeenNthCalledWith(2, "codex-assistant-sidebar", "right", {
			active: true,
			reveal: true,
			split: false,
		});
		expect(leaf.state).toEqual({ type: "codex-assistant-sidebar", active: true });
	});

	it("routes refreshes, note tracking, and delegated run calls correctly", async () => {
		const { plugin, app } = await createPlugin();
		await plugin.onload();

		const viewLeaf = createLeaf();
		viewLeaf.view = new ((await import("../../src/ui/CodexAssistantView")).CodexAssistantView as never)();
		(app.workspace.getLeavesOfType as ReturnType<typeof vi.fn>).mockReturnValue([viewLeaf]);

		(plugin as any).refreshViews("skills");
		expect(requestRenderMock).toHaveBeenCalledWith("skills");

		app.workspace.trigger("file-open", createFile("Notes/Focused.md"));
		expect((plugin as any).state.lastFocusedNotePath).toBe("Notes/Focused.md");

		const refreshSpy = vi.spyOn(plugin as any, "refreshViews");
		app.metadataCache.on.mock.calls[0]?.[1](createFile("Notes/Focused.md"));
		expect(refreshSpy).toHaveBeenCalledWith("skills");

		const activateViewSpy = vi.spyOn(plugin, "activateView").mockResolvedValue();
		(plugin as any).runController = {
			runManualPrompt: vi.fn(async () => undefined),
			runSkill: vi.fn(async () => undefined),
		};
		await plugin.runManualPrompt("Follow up");
		await plugin.runSkill({ id: "skill-1", name: "Skill", prompt: "Prompt" });
		expect(activateViewSpy).toHaveBeenCalledTimes(2);
		expect((plugin as any).runController.runManualPrompt).toHaveBeenCalledWith("Follow up");
		expect((plugin as any).runController.runSkill).toHaveBeenCalled();
	});
});
