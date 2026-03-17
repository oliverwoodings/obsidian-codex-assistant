import { MarkdownView, Notice, Plugin, TFile } from "obsidian";
import { DEFAULT_REASONING_EFFORTS } from "./codex/constants";
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
import type { QuickSkillsAppState } from "./state/appState";
import { RunController } from "./state/runController";
import { SessionStore } from "./state/sessionStore";
import { SettingsRepository } from "./state/settingsRepository";
import type { AppViewUpdate } from "./state/uiChange";
import { QuickSkillsSettingTab } from "./ui/QuickSkillsSettingTab";
import { SkillPickerModal } from "./ui/SkillPickerModal";
import { QUICK_SKILLS_VIEW_TYPE, QuickSkillsView } from "./ui/QuickSkillsView";

const AVAILABLE_SANDBOX_MODES: SandboxMode[] = ["read-only", "workspace-write", "danger-full-access"];

export default class QuickSkillsPlugin extends Plugin {
	private readonly state: QuickSkillsAppState = {
		settings: { ...DEFAULT_SETTINGS },
		sessions: [],
		activeSessionId: "",
		isRunning: false,
		currentAssistantMessageId: null,
		currentRunLogId: null,
		cancelRequested: false,
		lastFocusedNotePath: null,
		modelCatalog: { models: [] }
	};

	private codex!: CodexService;
	private settingsRepository!: SettingsRepository;
	private sessionStore!: SessionStore;
	private runController!: RunController;
	private settingTab: QuickSkillsSettingTab | null = null;

	get settings(): PluginData {
		return this.state.settings;
	}

	get sessions() {
		return this.state.sessions;
	}

	get activeSessionId(): string {
		return this.state.activeSessionId;
	}

	get isRunning(): boolean {
		return this.state.isRunning;
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
			codex: this.codex,
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
		this.registerView(QUICK_SKILLS_VIEW_TYPE, (leaf) => new QuickSkillsView(leaf, this));

		// eslint-disable-next-line obsidianmd/ui/sentence-case
		this.addRibbonIcon("bot", "Quick Skills", () => {
			void this.openSkillPicker();
		});

		this.addCommand({
			id: "quick-skills-open-sidebar",
			// eslint-disable-next-line obsidianmd/commands/no-plugin-name-in-command-name, obsidianmd/ui/sentence-case
			name: "Quick Skills: Open Sidebar",
			callback: () => {
				void this.activateView();
			}
		});
		this.addCommand({
			id: "quick-skills-run-skill",
			// eslint-disable-next-line obsidianmd/commands/no-plugin-name-in-command-name, obsidianmd/ui/sentence-case
			name: "Quick Skills: Run Skill…",
			callback: () => {
				void this.openSkillPicker();
			}
		});
		this.addCommand({
			id: "quick-skills-new-session",
			// eslint-disable-next-line obsidianmd/commands/no-plugin-name-in-command-name, obsidianmd/ui/sentence-case
			name: "Quick Skills: New Session",
			callback: () => {
				void this.createAndSelectSession();
			}
		});

		this.settingTab = new QuickSkillsSettingTab(this.app, this);
		this.addSettingTab(this.settingTab);
	}

	onunload(): void {
		this.runController?.cancelCurrentRun();
		void this.settingsRepository?.flush(this.state.settings);
		this.settingTab = null;
	}

	async activateView(): Promise<void> {
		const existing = this.app.workspace.getLeavesOfType(QUICK_SKILLS_VIEW_TYPE)[0];
		const leaf = existing ?? this.app.workspace.getRightLeaf(false);
		if (!leaf) {
			return;
		}
		await leaf.setViewState({ type: QUICK_SKILLS_VIEW_TYPE, active: true });
		void this.app.workspace.revealLeaf(leaf);
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
		await this.runController.runManualPrompt(prompt);
	}

	async runSkill(skill: SkillDefinition): Promise<void> {
		await this.activateView();
		await this.runController.runSkill(skill, this.resolveSkillReasoningEffort(skill), this.resolveSkillSandboxMode(skill));
	}

	cancelCurrentRun(): void {
		this.runController.cancelCurrentRun();
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
		if (this.state.isRunning && sessionId === this.state.activeSessionId) {
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
		this.app.workspace.getLeavesOfType(QUICK_SKILLS_VIEW_TYPE).forEach((leaf) => {
			const view = leaf.view;
			if (view instanceof QuickSkillsView) {
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
