import { MarkdownView, Notice, Plugin, TFile } from "obsidian";
import { DEFAULT_REASONING_EFFORTS } from "./codex/constants";
import { CodexService, type CodexLiveState } from "./codex/service";
import { buildSessionContext, getActiveMarkdownView, getFrontmatterTags } from "./services/context";
import { resolveApplicableSkills } from "./services/skillApplicability";
import { buildXmlPayload } from "./services/xmlPayload";
import { DEFAULT_SETTINGS } from "./settings";
import type {
	ChatMessage,
	ExecutionLogCodexConfig,
	ExecutionLogEntry,
	ExecutionLogRawEvent,
	ExecutionLogRequestKind,
	ExecutionLogStatus,
	ModelCatalog,
	ModelOption,
	PluginData,
	SandboxMode,
	SessionSummary,
	SkillDefinition
} from "./types";
import { createId } from "./utils/id";
import { QuickSkillsSettingTab } from "./ui/QuickSkillsSettingTab";
import { SkillPickerModal } from "./ui/SkillPickerModal";
import { QUICK_SKILLS_VIEW_TYPE, QuickSkillsView } from "./ui/QuickSkillsView";

const MAX_EXECUTION_LOG_ENTRIES = 100;
const AVAILABLE_SANDBOX_MODES: SandboxMode[] = ["read-only", "workspace-write", "danger-full-access"];

interface RunMetadata {
	requestKind: ExecutionLogRequestKind;
	prompt: string;
	skillName?: string;
	vaultRootPath: string;
	reasoningEffort?: string;
	sandboxMode?: SandboxMode;
}

export default class QuickSkillsPlugin extends Plugin {
	settings: PluginData = { ...DEFAULT_SETTINGS };
	codex!: CodexService;
	sessions: SessionSummary[] = [];
	activeSessionId = "";
	isRunning = false;
	private currentAssistantMessageId: string | null = null;
	private currentRunLogId: string | null = null;
	private cancelRequested = false;
	private settingTab: QuickSkillsSettingTab | null = null;
	private lastFocusedNotePath: string | null = null;
	private modelCatalog: ModelCatalog = { models: [] };

	async onload(): Promise<void> {
		await this.loadSettings();
		this.codex = new CodexService(() => this.settings.codexBinaryPath || "codex");
		await this.refreshModelCatalog();
		this.captureFocusedNotePath();
		this.registerEvent(this.app.workspace.on("active-leaf-change", () => {
			this.captureFocusedNotePath();
		}));
		this.registerEvent(this.app.workspace.on("file-open", (file) => {
			if (file) {
				this.lastFocusedNotePath = file.path;
				return;
			}
			this.captureFocusedNotePath();
		}));
		await this.refreshSessions();
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
		this.codex?.cancel();
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
		this.refreshView();
	}

	async createAndSelectSession(): Promise<void> {
		const created = this.codex.createSession();
		this.registerManagedSessionId(created.id);
		this.upsertSession(created);
		await this.setActiveSession(created.id);
		new Notice(`Session created: ${created.label}`);
	}

	async setActiveSession(sessionId: string): Promise<void> {
		if (!this.isManagedSessionId(sessionId)) {
			return;
		}
		this.activeSessionId = sessionId;
		this.registerManagedSessionId(sessionId);
		this.settings.lastSessionId = sessionId;
		if (!this.settings.transcripts[sessionId]) {
			this.settings.transcripts[sessionId] = [];
		}
		await this.saveSettings();
		this.refreshView();
	}

	getCurrentTranscript(): ChatMessage[] {
		if (!this.activeSessionId) {
			return [];
		}
		return this.settings.transcripts[this.activeSessionId] ?? [];
	}

	getAvailableModels(): ModelOption[] {
		return this.modelCatalog.models;
	}

	getReasoningOptionsForModel(modelId: string): string[] {
		const selected = this.modelCatalog.models.find((model) => model.id === modelId);
		if (selected?.reasoningEfforts.length) {
			return selected.reasoningEfforts;
		}
		return DEFAULT_REASONING_EFFORTS;
	}

	getAvailableSandboxModes(): SandboxMode[] {
		return AVAILABLE_SANDBOX_MODES;
	}

	getActiveSessionSummary(): SessionSummary | undefined {
		return this.sessions.find((session) => session.id === this.activeSessionId);
	}

	async setSelectedModel(modelId: string): Promise<void> {
		this.settings.selectedModel = modelId;
		this.normalizeSelectedModelAndReasoning();
		await this.saveSettings();
	}

	async setSelectedReasoningEffort(reasoningEffort: string): Promise<void> {
		this.settings.selectedReasoningEffort = reasoningEffort;
		this.normalizeSelectedModelAndReasoning();
		await this.saveSettings();
	}

	async setSandboxMode(mode: SandboxMode): Promise<void> {
		this.settings.sandboxMode = mode;
		await this.saveSettings();
	}

	async runManualPrompt(prompt: string): Promise<void> {
		const context = buildSessionContext(this.app, this.lastFocusedNotePath);
		await this.activateView();
		this.pushMessage({
			id: createId("user"),
			role: "user",
			content: prompt,
			timestamp: Date.now()
		});
		const xmlPayload = buildXmlPayload({
			kind: "manual",
			prompt,
			context
		});
		await this.runRequest(xmlPayload, {
			requestKind: "manual",
			prompt,
			vaultRootPath: context.vaultRootPath
		});
	}

	async runSkill(skill: SkillDefinition): Promise<void> {
		const context = buildSessionContext(this.app, this.lastFocusedNotePath);
		await this.activateView();
		const renderedPrompt = skill.prompt.trim();
		const reasoningEffort = this.resolveSkillReasoningEffort(skill);
		const sandboxMode = this.resolveSkillSandboxMode(skill);
		this.pushMessage({
			id: createId("skill"),
			role: "skill",
			skillName: skill.name,
			activeNotePath: context.activeNotePath || undefined,
			content: renderedPrompt,
			timestamp: Date.now()
		});
		const xmlPayload = buildXmlPayload({
			kind: "skill",
			skillName: skill.name,
			prompt: renderedPrompt,
			context
		});
		await this.runRequest(xmlPayload, {
			requestKind: "skill",
			prompt: renderedPrompt,
			skillName: skill.name,
			vaultRootPath: context.vaultRootPath,
			reasoningEffort,
			sandboxMode
		});
	}

	cancelCurrentRun(): void {
		if (this.isRunning) {
			this.cancelRequested = true;
		}
		this.codex.cancel();
		this.isRunning = false;
		if (this.currentAssistantMessageId) {
			this.finishAssistantMessage(this.currentAssistantMessageId);
		}
		void this.saveSettings();
		this.refreshView();
	}

	cancelExecutionLogRun(logId: string): boolean {
		if (!this.isRunning || this.currentRunLogId !== logId) {
			return false;
		}
		this.cancelCurrentRun();
		return true;
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
		return resolveApplicableSkills(this.settings.skills, activeFile, tags);
	}

	async refreshSessions(): Promise<void> {
		const discoveredSessions = await this.codex.listSessions();
		const discoveredById = new Map(discoveredSessions.map((session) => [session.id, session]));
		const managedIds = this.settings.managedSessionIds.filter((id, index, values) => id.length > 0 && values.indexOf(id) === index);

		this.sessions = managedIds.map((id) => this.buildManagedSessionSummary(id, discoveredById.get(id)));

		if (this.sessions.length === 0) {
			const created = this.codex.createSession();
			this.registerManagedSessionId(created.id);
			this.sessions = [created];
		}
		const fallbackSession = this.sessions[0];
		if (!fallbackSession) {
			return;
		}
		const selected = this.settings.lastSessionId && this.isManagedSessionId(this.settings.lastSessionId)
			? this.settings.lastSessionId
			: fallbackSession.id;
		await this.setActiveSession(selected);
	}

	async insertIntoActiveNote(text: string, mode: "cursor" | "append" = "cursor"): Promise<void> {
		const view = getActiveMarkdownView(this.app, this.lastFocusedNotePath);
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

	private async runRequest(xmlPayload: string, metadata: RunMetadata): Promise<void> {
		if (!this.activeSessionId) {
			await this.createAndSelectSession();
		}
		const requestSessionId = this.activeSessionId;
		const runStartedAt = Date.now();
		const logId = this.startExecutionLog({
			sessionId: requestSessionId,
			requestKind: metadata.requestKind,
			skillName: metadata.skillName,
			prompt: metadata.prompt,
			xmlPayload
		});
		this.currentRunLogId = logId;
		const assistantMessageId = createId("assistant");
		this.currentAssistantMessageId = assistantMessageId;
		this.pushMessage({
			id: assistantMessageId,
			role: "assistant",
			content: "",
			timestamp: Date.now(),
			isStreaming: true
		});

		this.isRunning = true;
		this.cancelRequested = false;
		this.refreshView();
		const result = await this.codex.run({
			xmlPayload,
			sessionId: requestSessionId,
			model: this.settings.selectedModel,
			reasoningEffort: metadata.reasoningEffort ?? this.settings.selectedReasoningEffort,
			sandboxMode: metadata.sandboxMode ?? this.settings.sandboxMode,
			workingDirectory: metadata.vaultRootPath
		}, {
			onInvocation: (command, args, config) => {
				this.setExecutionLogInvocation(logId, command, args, config);
			},
			onEvent: (event) => {
				this.appendExecutionLogEvent(logId, event);
			},
			onLiveState: (state) => {
				this.setAssistantLiveState(assistantMessageId, state);
			},
			onFinalContent: (content) => {
				this.replaceAssistantMessage(assistantMessageId, content);
			}
		});
		this.finishAssistantMessage(assistantMessageId);
		if (result.errorMessage && !result.cancelled) {
			this.pushMessage({
				id: createId("error"),
				role: "error",
				content: result.errorMessage,
				timestamp: Date.now()
			});
		}
		if (result.sessionId && result.sessionId !== requestSessionId) {
			await this.adoptResolvedSessionId(requestSessionId, result.sessionId);
			this.setExecutionLogSession(logId, result.sessionId);
		}
		const assistantMessage = this.findMessageById(assistantMessageId);
		const finalStatus: ExecutionLogStatus = (this.cancelRequested || result.cancelled)
			? "stopped"
			: (result.errorMessage ? "error" : "success");
		this.completeExecutionLog(logId, {
			status: finalStatus,
			response: result.finalContent || (assistantMessage?.content ?? ""),
			errorMessage: result.errorMessage,
			durationMs: Date.now() - runStartedAt
		});
		this.isRunning = false;
		this.currentRunLogId = null;
		this.cancelRequested = false;
		await this.saveSettings();
		this.refreshView();
	}

	private replaceAssistantMessage(messageId: string, content: string): void {
		const transcript = this.getCurrentTranscript();
		const message = transcript.find((entry) => entry.id === messageId);
		if (!message) {
			return;
		}
		message.content = content;
		void this.saveSettings();
		this.refreshView();
	}

	private setAssistantLiveState(messageId: string, state: CodexLiveState): void {
		const transcript = this.getCurrentTranscript();
		const message = transcript.find((entry) => entry.id === messageId);
		if (!message) {
			return;
		}
		if (state.reasoningText) {
			message.reasoningPreview = state.reasoningText;
			message.reasoningTrace = state.reasoningText;
		} else if (message.reasoningPreview) {
			delete message.reasoningPreview;
		} else if (message.reasoningTrace) {
			delete message.reasoningTrace;
		}
		if (state.draftText) {
			message.draftPreview = state.draftText;
		} else if (message.draftPreview) {
			delete message.draftPreview;
		}
		if (state.activities.length > 0) {
			message.activities = state.activities;
		} else if (message.activities) {
			delete message.activities;
		}
		if (state.reasoningText || state.completedMessages.length > 0 || state.activities.length > 0) {
			message.turnTrace = {
				reasoningText: state.reasoningText || undefined,
				completedMessages: state.completedMessages.length > 0 ? [...state.completedMessages] : undefined,
				activities: state.activities.length > 0 ? [...state.activities] : undefined
			};
		} else if (message.turnTrace) {
			delete message.turnTrace;
		}
		void this.saveSettings();
		this.refreshView();
	}

	private finishAssistantMessage(messageId: string): void {
		const transcript = this.getCurrentTranscript();
		const message = transcript.find((entry) => entry.id === messageId);
		if (message) {
			message.isStreaming = false;
			if (message.reasoningPreview) {
				delete message.reasoningPreview;
			}
			if (message.draftPreview) {
				delete message.draftPreview;
			}
			if (message.activities) {
				delete message.activities;
			}
		}
		this.currentAssistantMessageId = null;
	}

	private pushMessage(message: ChatMessage): void {
		if (!this.activeSessionId) {
			return;
		}
		if (!this.settings.transcripts[this.activeSessionId]) {
			this.settings.transcripts[this.activeSessionId] = [];
		}
		const transcript = this.settings.transcripts[this.activeSessionId];
		if (!transcript) {
			return;
		}
		transcript.push(message);
		void this.saveSettings();
		this.refreshView();
	}

	private startExecutionLog(entry: {
		sessionId: string;
		requestKind: ExecutionLogRequestKind;
		prompt: string;
		xmlPayload: string;
		skillName?: string;
	}): string {
		const id = createId("run");
		this.settings.executionLog.unshift({
			id,
			timestamp: Date.now(),
			sessionId: entry.sessionId,
			requestKind: entry.requestKind,
			skillName: entry.skillName,
			prompt: entry.prompt,
			xmlPayload: entry.xmlPayload,
			command: "",
			commandArgs: [],
			processOutput: "",
			rawEvents: [],
			response: "",
			errorMessage: "",
			durationMs: Number.NaN,
			status: "running"
		});
		if (this.settings.executionLog.length > MAX_EXECUTION_LOG_ENTRIES) {
			this.settings.executionLog = this.settings.executionLog.slice(0, MAX_EXECUTION_LOG_ENTRIES);
		}
		void this.saveSettings();
		this.settingTab?.notifyExecutionLogUpdated();
		return id;
	}

	private setExecutionLogInvocation(id: string, command: string, args: string[], config: ExecutionLogCodexConfig): void {
		const entry = this.settings.executionLog.find((item) => item.id === id);
		if (!entry) {
			return;
		}
		entry.command = command;
		entry.commandArgs = [...args];
		entry.codexConfig = config;
		void this.saveSettings();
		this.settingTab?.notifyExecutionLogUpdated();
	}

	private setExecutionLogSession(id: string, sessionId: string): void {
		const entry = this.settings.executionLog.find((item) => item.id === id);
		if (!entry) {
			return;
		}
		entry.sessionId = sessionId;
		void this.saveSettings();
		this.settingTab?.notifyExecutionLogUpdated();
	}

	private appendExecutionLogEvent(id: string, event: ExecutionLogRawEvent): void {
		const entry = this.settings.executionLog.find((item) => item.id === id);
		if (!entry) {
			return;
		}
		entry.rawEvents.push(event);
		void this.saveSettings();
		this.settingTab?.notifyExecutionLogUpdated();
	}

	private completeExecutionLog(id: string, update: {
		status: ExecutionLogStatus;
		response: string;
		errorMessage: string;
		durationMs: number;
	}): void {
		const entry = this.settings.executionLog.find((item) => item.id === id);
		if (!entry) {
			return;
		}
		entry.status = update.status;
		entry.response = update.response;
		entry.errorMessage = update.errorMessage;
		if (update.errorMessage && !entry.processOutput.trim()) {
			entry.processOutput = update.errorMessage;
		}
		entry.durationMs = update.durationMs;
		void this.saveSettings();
		this.settingTab?.notifyExecutionLogUpdated();
	}

	private findMessageById(messageId: string): ChatMessage | null {
		for (const transcript of Object.values(this.settings.transcripts)) {
			const found = transcript.find((message) => message.id === messageId);
			if (found) {
				return found;
			}
		}
		return null;
	}

	private async adoptResolvedSessionId(previousSessionId: string, resolvedSessionId: string): Promise<void> {
		if (previousSessionId === resolvedSessionId) {
			return;
		}
		await this.codex.adoptSessionMetadata(previousSessionId, resolvedSessionId);
		const previousTranscript = this.settings.transcripts[previousSessionId];
		const resolvedTranscript = this.settings.transcripts[resolvedSessionId] ?? [];
		if (previousTranscript?.length) {
			this.settings.transcripts[resolvedSessionId] = [...resolvedTranscript, ...previousTranscript];
		} else if (!this.settings.transcripts[resolvedSessionId]) {
			this.settings.transcripts[resolvedSessionId] = [];
		}
		if (previousSessionId in this.settings.transcripts) {
			delete this.settings.transcripts[previousSessionId];
		}

		if (this.activeSessionId === previousSessionId) {
			this.activeSessionId = resolvedSessionId;
		}
		if (this.settings.lastSessionId === previousSessionId) {
			this.settings.lastSessionId = resolvedSessionId;
		}
		this.replaceManagedSessionId(previousSessionId, resolvedSessionId);

		this.sessions = this.sessions.filter((entry) => entry.id !== previousSessionId);
		const discoveredSession = (await this.codex.listSessions()).find((session) => session.id === resolvedSessionId);
		this.upsertSession(this.buildManagedSessionSummary(resolvedSessionId, discoveredSession));
	}

	async renameSession(sessionId: string, title: string): Promise<void> {
		const normalizedTitle = title.trim();
		if (!sessionId || !normalizedTitle) {
			return;
		}
		await this.codex.renameSession(sessionId, normalizedTitle);
		await this.refreshSessions();
		new Notice(`Session renamed to ${normalizedTitle}.`);
	}

	async archiveSession(sessionId: string): Promise<void> {
		if (!sessionId) {
			return;
		}
		if (this.isRunning && sessionId === this.activeSessionId) {
			new Notice("Stop the current run before archiving this session.");
			return;
		}
		await this.codex.archiveSession(sessionId);
		delete this.settings.transcripts[sessionId];
		this.unregisterManagedSessionId(sessionId);
		if (this.activeSessionId === sessionId) {
			this.activeSessionId = "";
		}
		if (this.settings.lastSessionId === sessionId) {
			this.settings.lastSessionId = "";
		}
		this.sessions = this.sessions.filter((session) => session.id !== sessionId);
		await this.refreshSessions();
		new Notice("Session archived.");
	}

	private upsertSession(session: SessionSummary): void {
		const existingIndex = this.sessions.findIndex((entry) => entry.id === session.id);
		if (existingIndex >= 0) {
			this.sessions[existingIndex] = session;
			return;
		}
		this.sessions = [session, ...this.sessions.filter((entry) => entry.id !== session.id)];
	}

	private isManagedSessionId(sessionId: string): boolean {
		return this.settings.managedSessionIds.includes(sessionId);
	}

	private registerManagedSessionId(sessionId: string, prepend = true): void {
		if (!sessionId) {
			return;
		}
		const existing = this.settings.managedSessionIds.filter((id) => id !== sessionId);
		this.settings.managedSessionIds = prepend
			? [sessionId, ...existing]
			: [...existing, sessionId];
	}

	private unregisterManagedSessionId(sessionId: string): void {
		this.settings.managedSessionIds = this.settings.managedSessionIds.filter((id) => id !== sessionId);
	}

	private replaceManagedSessionId(previousSessionId: string, resolvedSessionId: string): void {
		if (!resolvedSessionId) {
			return;
		}
		const nextIds: string[] = [];
		let replaced = false;
		for (const sessionId of this.settings.managedSessionIds) {
			if (sessionId === previousSessionId) {
				if (!nextIds.includes(resolvedSessionId)) {
					nextIds.push(resolvedSessionId);
				}
				replaced = true;
				continue;
			}
			if (sessionId === resolvedSessionId || nextIds.includes(sessionId)) {
				continue;
			}
			nextIds.push(sessionId);
		}
		if (!replaced && !nextIds.includes(resolvedSessionId)) {
			nextIds.unshift(resolvedSessionId);
		}
		this.settings.managedSessionIds = nextIds;
	}

	private refreshView(): void {
		this.app.workspace.getLeavesOfType(QUICK_SKILLS_VIEW_TYPE).forEach((leaf) => {
			const view = leaf.view;
			if (view instanceof QuickSkillsView) {
				view.render();
			}
		});
	}

	private captureFocusedNotePath(): void {
		const focusedView = this.app.workspace.getActiveViewOfType(MarkdownView);
		const focusedPath = focusedView?.file?.path;
		if (focusedPath) {
			this.lastFocusedNotePath = focusedPath;
		}
	}

	private getActiveFile(): TFile | null {
		const view = getActiveMarkdownView(this.app, this.lastFocusedNotePath);
		return view?.file ?? null;
	}

	private async refreshModelCatalog(): Promise<void> {
		this.modelCatalog = await this.codex.getModelCatalog();
		this.normalizeSelectedModelAndReasoning();
		await this.saveSettings();
	}

	private normalizeSelectedModelAndReasoning(): void {
		const models = this.modelCatalog.models;
		if (models.length === 0) {
			this.settings.selectedModel = this.settings.selectedModel || DEFAULT_SETTINGS.selectedModel;
			this.settings.selectedReasoningEffort = this.settings.selectedReasoningEffort || DEFAULT_SETTINGS.selectedReasoningEffort;
			return;
		}

		const modelIds = new Set(models.map((model) => model.id));
		if (!this.settings.selectedModel || !modelIds.has(this.settings.selectedModel)) {
			const defaultModel = this.modelCatalog.defaultModelId && modelIds.has(this.modelCatalog.defaultModelId)
				? this.modelCatalog.defaultModelId
				: models[0]?.id;
			this.settings.selectedModel = defaultModel ?? DEFAULT_SETTINGS.selectedModel;
		}

		const selectedModel = models.find((model) => model.id === this.settings.selectedModel);
		const reasoningOptions = selectedModel?.reasoningEfforts.length
			? selectedModel.reasoningEfforts
			: DEFAULT_REASONING_EFFORTS;
		const preferredReasoning = this.modelCatalog.defaultReasoningEffort
			|| selectedModel?.defaultReasoningEffort
			|| this.settings.selectedReasoningEffort
			|| DEFAULT_SETTINGS.selectedReasoningEffort;
		if (!reasoningOptions.includes(this.settings.selectedReasoningEffort)) {
			this.settings.selectedReasoningEffort = reasoningOptions.includes(preferredReasoning)
				? preferredReasoning
				: (reasoningOptions[0] ?? DEFAULT_SETTINGS.selectedReasoningEffort);
		}
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<PluginData>);
		this.settings.skills = this.normalizeSkills(this.settings.skills);
		this.settings.transcripts = this.settings.transcripts ?? {};
		this.settings.managedSessionIds = this.normalizeManagedSessionIds(this.settings.managedSessionIds);
		if (this.settings.managedSessionIds.length === 0) {
			this.settings.managedSessionIds = this.normalizeManagedSessionIds(Object.keys(this.settings.transcripts));
		}
		if (this.settings.lastSessionId && !this.isManagedSessionId(this.settings.lastSessionId)) {
			this.settings.lastSessionId = this.settings.managedSessionIds[0] ?? "";
		}
		this.settings.codexBinaryPath = this.settings.codexBinaryPath || "codex";
		this.settings.selectedModel = this.settings.selectedModel || DEFAULT_SETTINGS.selectedModel;
		this.settings.selectedReasoningEffort = this.settings.selectedReasoningEffort || DEFAULT_SETTINGS.selectedReasoningEffort;
		this.settings.sandboxMode = this.normalizeSandboxMode(this.settings.sandboxMode);
		this.settings.executionLog = this.normalizeExecutionLog(this.settings.executionLog);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	private normalizeExecutionLog(entries: unknown): ExecutionLogEntry[] {
		if (!Array.isArray(entries)) {
			return [];
		}
		return entries
			.map((entry) => this.normalizeExecutionLogEntry(entry))
			.filter((entry): entry is ExecutionLogEntry => Boolean(entry))
			.slice(0, MAX_EXECUTION_LOG_ENTRIES);
	}

	private normalizeExecutionLogEntry(value: unknown): ExecutionLogEntry | null {
		if (!value || typeof value !== "object") {
			return null;
		}
		const raw = value as Partial<ExecutionLogEntry>;
		const status = this.normalizeExecutionStatus(raw.status);
		return {
			id: typeof raw.id === "string" ? raw.id : createId("run"),
			timestamp: typeof raw.timestamp === "number" ? raw.timestamp : Date.now(),
			sessionId: typeof raw.sessionId === "string" ? raw.sessionId : "",
			requestKind: raw.requestKind === "skill" ? "skill" : "manual",
			skillName: typeof raw.skillName === "string" ? raw.skillName : undefined,
			prompt: typeof raw.prompt === "string" ? raw.prompt : "",
			xmlPayload: typeof raw.xmlPayload === "string" ? raw.xmlPayload : "",
			command: typeof raw.command === "string" ? raw.command : "",
			commandArgs: Array.isArray(raw.commandArgs)
				? raw.commandArgs.filter((item): item is string => typeof item === "string")
				: [],
			processOutput: typeof raw.processOutput === "string" ? raw.processOutput : "",
			rawEvents: this.normalizeExecutionLogRawEvents(raw.rawEvents),
			codexConfig: this.normalizeExecutionLogCodexConfig(raw.codexConfig),
			response: typeof raw.response === "string" ? raw.response : "",
			errorMessage: typeof raw.errorMessage === "string" ? raw.errorMessage : "",
			durationMs: typeof raw.durationMs === "number" ? raw.durationMs : Number.NaN,
			status
		};
	}

	private normalizeExecutionLogRawEvents(value: unknown): ExecutionLogRawEvent[] {
		if (!Array.isArray(value)) {
			return [];
		}
		const events: ExecutionLogRawEvent[] = [];
		for (const entry of value) {
			if (!entry || typeof entry !== "object") {
				continue;
			}
			const raw = entry as Partial<ExecutionLogRawEvent>;
			const payload = raw.payload;
			if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
				continue;
			}
			events.push({
				timestamp: typeof raw.timestamp === "number" ? raw.timestamp : Date.now(),
				type: typeof raw.type === "string" ? raw.type : "unknown",
				payload
			});
		}
		return events;
	}

	private normalizeExecutionLogCodexConfig(value: unknown): ExecutionLogCodexConfig | undefined {
		if (!value || typeof value !== "object") {
			return undefined;
		}
		const raw = value as Partial<ExecutionLogCodexConfig>;
		if (raw.transport !== "codex-sdk" || raw.streamingProtocol !== "experimental-json") {
			return undefined;
		}
		if (typeof raw.executablePath !== "string" || typeof raw.requestedSessionId !== "string") {
			return undefined;
		}
		const configOverrides = raw.configOverrides;
		return {
			transport: "codex-sdk",
			streamingProtocol: "experimental-json",
			executablePath: raw.executablePath,
			sessionStrategy: raw.sessionStrategy === "resume" ? "resume" : "new",
			requestedSessionId: raw.requestedSessionId,
			workingDirectory: typeof raw.workingDirectory === "string" ? raw.workingDirectory : undefined,
			sandboxMode: raw.sandboxMode,
			model: typeof raw.model === "string" ? raw.model : undefined,
			reasoningEffort: typeof raw.reasoningEffort === "string" ? raw.reasoningEffort : undefined,
			skipGitRepoCheck: raw.skipGitRepoCheck === true,
			configOverrides: configOverrides && typeof configOverrides === "object" && !Array.isArray(configOverrides)
				? configOverrides
				: {}
		};
	}

	private normalizeExecutionStatus(value: unknown): ExecutionLogStatus {
		if (value === "running") {
			return "error";
		}
		if (value === "success" || value === "error" || value === "stopped") {
			return value;
		}
		return "error";
	}

	private normalizeManagedSessionIds(value: unknown): string[] {
		if (!Array.isArray(value)) {
			return [];
		}
		const normalized: string[] = [];
		for (const item of value) {
			if (typeof item !== "string") {
				continue;
			}
			const id = item.trim();
			if (!id || normalized.includes(id)) {
				continue;
			}
			normalized.push(id);
		}
		return normalized;
	}

	private normalizeSkills(value: unknown): SkillDefinition[] {
		if (!Array.isArray(value)) {
			return [...DEFAULT_SETTINGS.skills];
		}
		const normalized = value
			.map((entry) => this.normalizeSkill(entry))
			.filter((entry): entry is SkillDefinition => Boolean(entry));
		return normalized.length > 0 ? normalized : [...DEFAULT_SETTINGS.skills];
	}

	private normalizeSkill(value: unknown): SkillDefinition | null {
		if (!value || typeof value !== "object") {
			return null;
		}
		const raw = value as {
			id?: unknown;
			name?: unknown;
			prompt?: unknown;
			promptTemplate?: unknown;
			reasoningEffort?: unknown;
			sandboxMode?: unknown;
			rules?: unknown;
		};
		const id = typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : createId("skill");
		const name = typeof raw.name === "string" ? raw.name.trim() : "";
		const prompt = typeof raw.prompt === "string"
			? raw.prompt.trim()
			: (typeof raw.promptTemplate === "string" ? raw.promptTemplate.trim() : "");
		if (!name || !prompt) {
			return null;
		}
		return {
			id,
			name,
			prompt,
			reasoningEffort: typeof raw.reasoningEffort === "string" && raw.reasoningEffort.trim()
				? raw.reasoningEffort.trim()
				: undefined,
			sandboxMode: this.normalizeOptionalSandboxMode(raw.sandboxMode),
			rules: this.normalizeSkillRules(raw.rules)
		};
	}

	private normalizeSkillRules(value: unknown): SkillDefinition["rules"] {
		if (!value || typeof value !== "object") {
			return {};
		}
		const raw = value as { frontmatterTag?: unknown; frontmatterTags?: unknown; folderPrefix?: unknown };
		return {
			frontmatterTags: this.normalizeSkillTags(raw.frontmatterTags ?? raw.frontmatterTag),
			folderPrefix: typeof raw.folderPrefix === "string" && raw.folderPrefix.trim()
				? raw.folderPrefix.trim()
				: undefined
		};
	}

	private normalizeSkillTags(value: unknown): string[] | undefined {
		if (typeof value === "string") {
			const normalized = this.parseSkillTagList(value.split(","));
			return normalized.length > 0 ? normalized : undefined;
		}
		if (!Array.isArray(value)) {
			return undefined;
		}
		const normalized = this.parseSkillTagList(value);
		return normalized.length > 0 ? normalized : undefined;
	}

	private parseSkillTagList(values: unknown[]): string[] {
		const normalized: string[] = [];
		for (const entry of values) {
			if (typeof entry !== "string") {
				continue;
			}
			const tag = entry.replace(/^#/, "").trim();
			if (!tag) {
				continue;
			}
			const existingIndex = normalized.findIndex((candidate) => candidate.toLowerCase() === tag.toLowerCase());
			if (existingIndex >= 0) {
				continue;
			}
			normalized.push(tag);
		}
		return normalized;
	}

	private normalizeSandboxMode(value: unknown): SandboxMode {
		if (value === "workspace-write" || value === "danger-full-access") {
			return value;
		}
		return "read-only";
	}

	private normalizeOptionalSandboxMode(value: unknown): SandboxMode | undefined {
		if (value === "read-only" || value === "workspace-write" || value === "danger-full-access") {
			return value;
		}
		return undefined;
	}

	private resolveSkillReasoningEffort(skill: SkillDefinition): string | undefined {
		const override = skill.reasoningEffort?.trim();
		if (!override) {
			return undefined;
		}
		const supported = this.getReasoningOptionsForModel(this.settings.selectedModel);
		return supported.includes(override) ? override : undefined;
	}

	private resolveSkillSandboxMode(skill: SkillDefinition): SandboxMode | undefined {
		return this.normalizeOptionalSandboxMode(skill.sandboxMode);
	}

	private buildManagedSessionSummary(sessionId: string, discovered?: SessionSummary): SessionSummary {
		const transcript = this.settings.transcripts[sessionId] ?? [];
		const lastMessage = transcript.length > 0 ? transcript[transcript.length - 1] : undefined;
		const updatedAt = discovered?.updatedAt ?? lastMessage?.timestamp ?? this.extractTimestampFromSessionId(sessionId) ?? Date.now();
		const startedAt = discovered?.startedAt ?? transcript[0]?.timestamp ?? this.extractTimestampFromSessionId(sessionId);
		const workspaceLabel = discovered?.workspaceLabel;
		const customTitle = discovered?.customTitle;
		const title = this.buildSessionTitle(sessionId, transcript, workspaceLabel, customTitle);
		return {
			id: sessionId,
			title,
			label: this.buildSessionDisplayLabel(title, updatedAt),
			updatedAt,
			startedAt,
			workspaceLabel,
			customTitle,
			tooltip: this.buildSessionTooltip(sessionId, updatedAt, startedAt, workspaceLabel, customTitle, discovered?.tooltip)
		};
	}

	private buildSessionTitle(
		sessionId: string,
		transcript: ChatMessage[],
		workspaceLabel: string | undefined,
		customTitle: string | undefined
	): string {
		return customTitle
			|| this.deriveSessionTitle(transcript)
			|| workspaceLabel
			|| this.fallbackSessionTitle(sessionId);
	}

	private buildSessionDisplayLabel(title: string, updatedAt: number | undefined): string {
		const timestampLabel = updatedAt ? this.formatSessionTimestamp(updatedAt) : "";
		return timestampLabel ? `${title} · ${timestampLabel}` : title;
	}

	private buildSessionTooltip(
		sessionId: string,
		updatedAt: number | undefined,
		startedAt: number | undefined,
		workspaceLabel: string | undefined,
		customTitle: string | undefined,
		sourceTooltip?: string
	): string {
		const parts = [
			`Session ID: ${sessionId}`,
			customTitle ? `Name: ${customTitle}` : "",
			workspaceLabel ? `Workspace: ${workspaceLabel}` : "",
			startedAt ? `Started: ${new Date(startedAt).toLocaleString()}` : "",
			updatedAt ? `Updated: ${new Date(updatedAt).toLocaleString()}` : "",
			sourceTooltip ?? ""
		].filter((value) => value.length > 0);
		return parts.join("\n");
	}

	private deriveSessionTitle(transcript: ChatMessage[]): string | undefined {
		for (const message of transcript) {
			if (message.role === "skill" && message.skillName?.trim()) {
				return `Skill: ${message.skillName.trim()}`;
			}
			if (message.role === "user") {
				const summary = this.summarizeSessionText(message.content);
				if (summary) {
					return summary;
				}
			}
		}
		return undefined;
	}

	private summarizeSessionText(value: string): string | undefined {
		const normalized = value
			.replace(/\s+/gu, " ")
			.replace(/^#+\s*/u, "")
			.trim();
		if (!normalized) {
			return undefined;
		}
		return normalized.length > 48 ? `${normalized.slice(0, 45).trimEnd()}...` : normalized;
	}

	private fallbackSessionTitle(sessionId: string): string {
		if (sessionId.startsWith("new-session-") || sessionId.startsWith("session-")) {
			return "New session";
		}
		if (sessionId.length > 12) {
			return sessionId.slice(0, 12);
		}
		return sessionId;
	}

	private formatSessionTimestamp(timestamp: number): string {
		const date = new Date(timestamp);
		const now = new Date();
		const sameYear = date.getFullYear() === now.getFullYear();
		return date.toLocaleString([], sameYear
			? { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }
			: { year: "numeric", month: "short", day: "numeric" });
	}

	private extractTimestampFromSessionId(sessionId: string): number | undefined {
		const prefixedMatch = sessionId.match(/^(?:new-session|session)-(\d{10,})/u);
		if (prefixedMatch?.[1]) {
			const parsed = Number(prefixedMatch[1]);
			return Number.isFinite(parsed) ? parsed : undefined;
		}
		return undefined;
	}
}
