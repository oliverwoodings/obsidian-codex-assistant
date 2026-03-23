import { MarkdownView, Notice, Plugin, TFile } from "obsidian";
import { DEFAULT_REASONING_EFFORTS } from "./codex/constants";
import { CodexRunExecutor } from "./codex/runExecutor";
import { CodexService } from "./codex/service";
import { getActiveMarkdownView, getFrontmatterTags } from "./services/context";
import { resolveApplicableSkills } from "./services/skillApplicability";
import { DEFAULT_SETTINGS } from "./settings";
import type {
	ChatMessage,
	ModelOption,
	PluginData,
	SandboxMode,
	SkillDefinition
} from "./types";
import type { CodexAssistantAppState } from "./state/appState";
import { RunController } from "./state/runController";
import { SessionStore } from "./state/sessionStore";
import { SettingsRepository } from "./state/settingsRepository";
import type { AppViewUpdate } from "./state/uiChange";
import { CodexAssistantSettingTab } from "./ui/CodexAssistantSettingTab";
import { SkillPickerModal } from "./ui/SkillPickerModal";
import { CODEX_ASSISTANT_VIEW_TYPE, CodexAssistantView } from "./ui/CodexAssistantView";

const AVAILABLE_SANDBOX_MODES: SandboxMode[] = ["read-only", "workspace-write", "danger-full-access"];

export default class CodexAssistantPlugin extends Plugin {
	private readonly state: CodexAssistantAppState = {
		settings: { ...DEFAULT_SETTINGS },
		sessions: [],
		activeSessionId: "",
		lastFocusedNotePath: null,
		modelCatalog: { models: [] }
	};

	private codex!: CodexService;
	private settingsRepository!: SettingsRepository;
	private sessionStore!: SessionStore;
	private runController!: RunController;
	private settingTab: CodexAssistantSettingTab | null = null;

	get settings(): PluginData {
		return this.state.settings;
	}

	get sessions() {
		return this.state.sessions;
	}

	get activeSessionId(): string {
		return this.state.activeSessionId;
	}

	async onload(): Promise<void> {
		this.settingsRepository = new SettingsRepository({
			loadData: async (): Promise<unknown> => {
				const data: unknown = await this.loadData();
				return data;
			},
			saveData: async (data) => await this.saveData(data)
		});
		this.state.settings = await this.settingsRepository.load();
		this.codex = new CodexService(() => this.state.settings.codexBinaryPath || "codex");
		this.sessionStore = new SessionStore({
			app: this.app,
			state: this.state,
			codex: this.codex,
			settingsRepository: this.settingsRepository,
			notifyUi: (change) => this.refreshViews(change)
		});
		this.runController = new RunController({
			app: this.app,
			state: this.state,
			runExecutor: new CodexRunExecutor(() => this.state.settings.codexBinaryPath || "codex"),
			sessionStore: this.sessionStore,
			settingsRepository: this.settingsRepository,
			notifyUi: (change) => this.refreshViews(change),
			notifyExecutionLogUpdated: () => this.settingTab?.notifyExecutionLogUpdated()
		});

		await this.refreshModelCatalog();
		this.captureFocusedNotePath();
		this.registerEvent(this.app.workspace.on("active-leaf-change", (leaf) => {
			const markdownPath = leaf?.view instanceof MarkdownView ? (leaf.view.file?.path ?? null) : null;
			if (markdownPath) {
				this.updateFocusedNotePath(markdownPath);
				return;
			}
			this.captureFocusedNotePath();
		}));
		this.registerEvent(this.app.workspace.on("file-open", (file) => {
			if (file) {
				this.updateFocusedNotePath(file.path);
				return;
			}
			this.captureFocusedNotePath();
		}));
		this.registerEvent(this.app.metadataCache.on("changed", (file) => {
			if (file.path !== this.state.lastFocusedNotePath) {
				return;
			}
			this.refreshViews("skills");
		}));
		await this.sessionStore.refreshSessions();
		this.registerView(CODEX_ASSISTANT_VIEW_TYPE, (leaf) => new CodexAssistantView(leaf, this));

		// eslint-disable-next-line obsidianmd/ui/sentence-case
		this.addRibbonIcon("bot", "Codex Assistant", () => {
			void this.openSkillPicker();
		});

		this.addCommand({
			id: "codex-assistant-open-sidebar",
			// eslint-disable-next-line obsidianmd/commands/no-plugin-name-in-command-name, obsidianmd/ui/sentence-case
			name: "Codex Assistant: Open sidebar",
			callback: () => {
				void this.activateView();
			}
		});
		this.addCommand({
			id: "codex-assistant-run-skill",
			// eslint-disable-next-line obsidianmd/commands/no-plugin-name-in-command-name, obsidianmd/ui/sentence-case
			name: "Codex Assistant: Run skill…",
			callback: () => {
				void this.openSkillPicker();
			}
		});
		this.addCommand({
			id: "codex-assistant-new-session",
			// eslint-disable-next-line obsidianmd/commands/no-plugin-name-in-command-name, obsidianmd/ui/sentence-case
			name: "Codex Assistant: New session",
			callback: () => {
				void this.createAndSelectSession();
			}
		});

		this.settingTab = new CodexAssistantSettingTab(this.app, this);
		this.addSettingTab(this.settingTab);
	}

	onunload(): void {
		this.runController?.cancelAllRuns();
		void this.settingsRepository?.flush(this.state.settings);
		this.settingTab = null;
	}

	onUserEnable(): void {
		void this.ensureSidebarCreated();
	}

	async activateView(): Promise<void> {
		const leaf = await this.app.workspace.ensureSideLeaf(CODEX_ASSISTANT_VIEW_TYPE, "right", {
			active: true,
			reveal: true,
			split: false
		});
		await leaf.setViewState({ type: CODEX_ASSISTANT_VIEW_TYPE, active: true });
		this.refreshViews("all");
	}

	private async ensureSidebarCreated(): Promise<void> {
		const leaf = await this.app.workspace.ensureSideLeaf(CODEX_ASSISTANT_VIEW_TYPE, "right", {
			active: false,
			reveal: false,
			split: false
		});
		await leaf.setViewState({ type: CODEX_ASSISTANT_VIEW_TYPE, active: false });
		this.refreshViews("all");
	}

	async createAndSelectSession(): Promise<void> {
		const created = await this.sessionStore.createAndSelectSession();
		new Notice(`Session created: ${created.label}`);
	}

	async setActiveSession(sessionId: string): Promise<void> {
		await this.sessionStore.setActiveSession(sessionId);
	}

	getCurrentTranscript(): ChatMessage[] {
		return this.sessionStore.getCurrentTranscript();
	}

	getAvailableModels(): ModelOption[] {
		return this.state.modelCatalog.models;
	}

	async refreshAvailableModels(): Promise<void> {
		await this.refreshModelCatalog();
		this.refreshViews("controls");
	}

	getReasoningOptionsForModel(modelId: string): string[] {
		const selected = this.state.modelCatalog.models.find((model) => model.id === modelId);
		if (selected?.reasoningEfforts.length) {
			return selected.reasoningEfforts;
		}
		return DEFAULT_REASONING_EFFORTS;
	}

	getAvailableSandboxModes(): SandboxMode[] {
		return AVAILABLE_SANDBOX_MODES;
	}

	getActiveSessionSummary() {
		return this.sessionStore.getActiveSessionSummary();
	}

	getExecutionLogForAssistantMessage(message: ChatMessage) {
		return this.runController.getExecutionLogForAssistantMessage(message);
	}

	getSessionRunState(sessionId: string) {
		return this.runController.getSessionRunState(sessionId);
	}

	getActiveSessionRunState() {
		return this.runController.getActiveSessionRunState();
	}

	isSessionRunning(sessionId: string): boolean {
		return this.runController.isSessionRunning(sessionId);
	}

	getMarkdownRenderSourcePath(): string {
		return this.getActiveFile()?.path ?? "";
	}

	async setSelectedModel(modelId: string): Promise<void> {
		this.state.settings.selectedModel = modelId;
		this.normalizeSelectedModelAndReasoning();
		await this.saveSettings();
		this.refreshViews("controls");
	}

	async setSelectedReasoningEffort(reasoningEffort: string): Promise<void> {
		this.state.settings.selectedReasoningEffort = reasoningEffort;
		this.normalizeSelectedModelAndReasoning();
		await this.saveSettings();
		this.refreshViews("controls");
	}

	async setSandboxMode(mode: SandboxMode): Promise<void> {
		this.state.settings.sandboxMode = mode;
		await this.saveSettings();
		this.refreshViews("controls");
	}

	async runManualPrompt(prompt: string): Promise<void> {
		await this.activateView();
		const started = await this.runController.runManualPrompt(prompt);
		if (!started) {
			new Notice("This session already has a run in progress.");
		}
	}

	async runSkill(skill: SkillDefinition): Promise<void> {
		await this.activateView();
		const started = await this.runController.runSkill(skill, this.resolveSkillReasoningEffort(skill), this.resolveSkillSandboxMode(skill));
		if (!started) {
			new Notice("This session already has a run in progress.");
		}
	}

	cancelCurrentRun(): void {
		this.runController.cancelCurrentRun();
	}

	cancelSessionRun(sessionId: string): boolean {
		return this.runController.cancelSessionRun(sessionId);
	}

	cancelExecutionLogRun(logId: string): boolean {
		return this.runController.cancelExecutionLogRun(logId);
	}

	async openSkillPicker(): Promise<void> {
		const matches = this.getApplicableSkills();
		if (matches.length === 0) {
			new Notice("No applicable skills found for this note.");
			return;
		}

		new SkillPickerModal(this.app, matches, (skill) => {
			void this.runSkill(skill);
		}).open();
	}

	getApplicableSkills(): SkillDefinition[] {
		const activeFile = this.getActiveFile();
		const tags = getFrontmatterTags(this.app, activeFile);
		return resolveApplicableSkills(this.state.settings.skills, activeFile, tags);
	}

	async insertIntoActiveNote(text: string, mode: "cursor" | "append" = "cursor"): Promise<void> {
		const view = getActiveMarkdownView(this.app, this.state.lastFocusedNotePath);
		if (!view?.editor) {
			new Notice("Open a Markdown note before inserting.");
			return;
		}

		if (mode === "append") {
			const current = view.editor.getValue();
			const separator = current.endsWith("\n") ? "" : "\n";
			view.editor.setValue(`${current}${separator}${text}`);
		} else {
			view.editor.replaceSelection(text);
		}
		new Notice("Inserted assistant response into active note.");
	}

	async renameSession(sessionId: string, title: string): Promise<void> {
		await this.sessionStore.renameSession(sessionId, title);
		new Notice(`Session renamed to ${title.trim()}.`);
	}

	async archiveSession(sessionId: string): Promise<void> {
		if (!sessionId) {
			return;
		}
		if (this.runController.isSessionRunning(sessionId)) {
			new Notice("Stop the current run before archiving this session.");
			return;
		}
		await this.sessionStore.archiveSession(sessionId);
		new Notice("Session archived.");
	}

	async saveSettings(): Promise<void> {
		await this.settingsRepository.saveNow(this.state.settings);
	}

	private refreshViews(change: AppViewUpdate = "all"): void {
		this.app.workspace.getLeavesOfType(CODEX_ASSISTANT_VIEW_TYPE).forEach((leaf) => {
			const view = leaf.view;
			if (view instanceof CodexAssistantView) {
				view.requestRender(change);
			}
		});
	}

	private captureFocusedNotePath(): void {
		const focusedView = this.app.workspace.getActiveViewOfType(MarkdownView);
		const focusedPath = focusedView?.file?.path;
		if (focusedPath) {
			this.updateFocusedNotePath(focusedPath);
		}
	}

	private updateFocusedNotePath(path: string | null): void {
		const normalizedPath = path?.trim() || null;
		if (this.state.lastFocusedNotePath === normalizedPath) {
			return;
		}
		this.state.lastFocusedNotePath = normalizedPath;
		this.refreshViews("skills");
	}

	private getActiveFile(): TFile | null {
		const view = getActiveMarkdownView(this.app, this.state.lastFocusedNotePath);
		return view?.file ?? null;
	}

	private async refreshModelCatalog(): Promise<void> {
		this.state.modelCatalog = await this.codex.getModelCatalog();
		this.normalizeSelectedModelAndReasoning();
		await this.saveSettings();
	}

	private normalizeSelectedModelAndReasoning(): void {
		const models = this.state.modelCatalog.models;
		if (models.length === 0) {
			this.state.settings.selectedModel = this.state.settings.selectedModel || DEFAULT_SETTINGS.selectedModel;
			this.state.settings.selectedReasoningEffort = this.state.settings.selectedReasoningEffort || DEFAULT_SETTINGS.selectedReasoningEffort;
			return;
		}

		const modelIds = new Set(models.map((model) => model.id));
		if (!this.state.settings.selectedModel || !modelIds.has(this.state.settings.selectedModel)) {
			const defaultModel = this.state.modelCatalog.defaultModelId && modelIds.has(this.state.modelCatalog.defaultModelId)
				? this.state.modelCatalog.defaultModelId
				: models[0]?.id;
			this.state.settings.selectedModel = defaultModel ?? DEFAULT_SETTINGS.selectedModel;
		}

		const selectedModel = models.find((model) => model.id === this.state.settings.selectedModel);
		const reasoningOptions = selectedModel?.reasoningEfforts.length
			? selectedModel.reasoningEfforts
			: DEFAULT_REASONING_EFFORTS;
		const preferredReasoning = this.state.modelCatalog.defaultReasoningEffort
			|| selectedModel?.defaultReasoningEffort
			|| this.state.settings.selectedReasoningEffort
			|| DEFAULT_SETTINGS.selectedReasoningEffort;
		if (!reasoningOptions.includes(this.state.settings.selectedReasoningEffort)) {
			this.state.settings.selectedReasoningEffort = reasoningOptions.includes(preferredReasoning)
				? preferredReasoning
				: (reasoningOptions[0] ?? DEFAULT_SETTINGS.selectedReasoningEffort);
		}
	}

	private resolveSkillReasoningEffort(skill: SkillDefinition): string | undefined {
		const override = skill.reasoningEffort?.trim();
		if (!override) {
			return undefined;
		}
		const supported = this.getReasoningOptionsForModel(this.state.settings.selectedModel);
		return supported.includes(override) ? override : undefined;
	}

	private resolveSkillSandboxMode(skill: SkillDefinition): SandboxMode | undefined {
		if (skill.sandboxMode === "read-only" || skill.sandboxMode === "workspace-write" || skill.sandboxMode === "danger-full-access") {
			return skill.sandboxMode;
		}
		return undefined;
	}
}
