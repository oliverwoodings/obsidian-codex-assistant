import { ItemView, MarkdownRenderer, Notice, setIcon, type WorkspaceLeaf } from "obsidian";
import type QuickSkillsPlugin from "../main";
import { CodexStreamAccumulator } from "../codex/streamAccumulator";
import type { ChatActivity, ChatMessage, ChatTraceItem, SandboxMode, SessionSummary } from "../types";
import { DictationSession } from "../voice/dictationSession";
import { SessionRenameModal } from "./SessionRenameModal";

export const QUICK_SKILLS_VIEW_TYPE = "quick-skills-sidebar";
const DICTATION_BAR_COUNT = 20;
type DictationUiState = "idle" | "recording" | "transcribing";

export class QuickSkillsView extends ItemView {
	private readonly plugin: QuickSkillsPlugin;
	private transcriptEl!: HTMLElement;
	private inputEl!: HTMLTextAreaElement;
	private sessionSelectEl!: HTMLSelectElement;
	private optionControlsEl!: HTMLElement;
	private dictationDisplayEl!: HTMLElement;
	private dictationStatusEl!: HTMLElement;
	private readonly dictationBars: HTMLElement[] = [];
	private modelSelectEl!: HTMLSelectElement;
	private reasoningSelectEl!: HTMLSelectElement;
	private modeSelectEl!: HTMLSelectElement;
	private micButton!: HTMLButtonElement;
	private skillMenuEl!: HTMLDetailsElement;
	private skillMenuPopoverEl!: HTMLElement;
	private skillMenuTriggerEl!: HTMLElement;
	private sendButton!: HTMLButtonElement;
	private stopButton!: HTMLButtonElement;
	private transcriptRenderVersion = 0;
	private readonly expandedActivityIds = new Set<string>();
	private readonly collapsedActivityIds = new Set<string>();
	private readonly expandedReasoningMessageIds = new Set<string>();
	private pendingScrollMessageId: string | null = null;
	private dictationState: DictationUiState = "idle";
	private dictationSession: DictationSession | null = null;
	private dictationLevels = Array.from({ length: DICTATION_BAR_COUNT }, () => 0);

	constructor(leaf: WorkspaceLeaf, plugin: QuickSkillsPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return QUICK_SKILLS_VIEW_TYPE;
	}

	getDisplayText(): string {
		// eslint-disable-next-line obsidianmd/ui/sentence-case
		return "Quick Skills";
	}

	getIcon(): string {
		return "bot";
	}

	async onOpen(): Promise<void> {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("quick-skills-view");
		this.registerDomEvent(document, "pointerdown", (event: PointerEvent) => {
			const target = event.target;
			if (target instanceof Element && target.closest(".quick-skills-popover-menu")) {
				return;
			}
			this.closeOpenPopoverMenus();
		});

		const header = contentEl.createDiv({ cls: "quick-skills-topbar" });
		header.createDiv({ cls: "quick-skills-topbar-label", text: "Session" });
		const sessionGroup = header.createDiv({ cls: "quick-skills-session-group" });
		this.sessionSelectEl = sessionGroup.createEl("select", { cls: "quick-skills-session-select" });
		this.sessionSelectEl.addEventListener("change", () => {
			void (async () => {
				await this.plugin.setActiveSession(this.sessionSelectEl.value);
				this.render();
			})();
		});
		const sessionMenu = sessionGroup.createEl("details", { cls: "quick-skills-session-menu quick-skills-popover-menu" });
		sessionMenu.addEventListener("toggle", () => {
			if (sessionMenu.open) {
				this.closeOpenPopoverMenus(sessionMenu);
				this.updatePopoverDirection(sessionMenu);
			}
		});
		const sessionMenuTrigger = sessionMenu.createEl("summary", {
			cls: "quick-skills-session-menu-trigger",
			attr: {
				"aria-label": "Session actions",
				title: "Session actions"
			}
		});
		setIcon(sessionMenuTrigger, "settings");
		const sessionMenuPopover = sessionMenu.createDiv({ cls: "quick-skills-actions-popover quick-skills-session-menu-popover" });
		this.createActionButton(sessionMenuPopover, "Rename", async () => {
			this.openRenameSessionModal();
		}, sessionMenu);
		this.createActionButton(sessionMenuPopover, "Archive", async () => {
			const activeSessionId = this.plugin.activeSessionId;
			if (!activeSessionId) {
				return;
			}
			await this.plugin.archiveSession(activeSessionId);
			this.render();
		}, sessionMenu);
		const newSessionButton = sessionGroup.createEl("button", {
			cls: "quick-skills-new-session-button",
			text: "New"
		});
		newSessionButton.addEventListener("click", () => {
			void (async () => {
				await this.plugin.createAndSelectSession();
				this.render();
			})();
		});

		this.transcriptEl = contentEl.createDiv({ cls: "quick-skills-transcript" });

		const composer = contentEl.createDiv({ cls: "quick-skills-composer" });
		this.inputEl = composer.createEl("textarea", {
			cls: "quick-skills-input",
			attr: {
				placeholder: "Ask anything...",
				rows: "1",
				"aria-label": "Prompt input"
			}
		});
		this.inputEl.addEventListener("input", () => {
			this.autosizeInput();
		});
		this.inputEl.addEventListener("keydown", (event: KeyboardEvent) => {
			if (event.key === "Enter" && !event.shiftKey) {
				event.preventDefault();
				void this.sendManualPrompt();
			}
		});
		this.autosizeInput();

		const footer = composer.createDiv({ cls: "quick-skills-composer-toolbar" });
		this.optionControlsEl = footer.createDiv({ cls: "quick-skills-toolbar-selects" });
		this.dictationDisplayEl = footer.createDiv({ cls: "quick-skills-dictation-display" });
		this.dictationStatusEl = this.dictationDisplayEl.createDiv({ cls: "quick-skills-dictation-status" });
		const dictationBarsEl = this.dictationDisplayEl.createDiv({ cls: "quick-skills-dictation-bars" });
		for (let index = 0; index < DICTATION_BAR_COUNT; index += 1) {
			this.dictationBars.push(dictationBarsEl.createDiv({ cls: "quick-skills-dictation-bar" }));
		}

		this.modelSelectEl = this.createCompactSelect(this.optionControlsEl, "Model");
		this.modelSelectEl.addEventListener("change", () => {
			void (async () => {
				await this.plugin.setSelectedModel(this.modelSelectEl.value);
				this.renderReasoningOptions();
			})();
		});

		this.reasoningSelectEl = this.createCompactSelect(this.optionControlsEl, "Reasoning");
		this.reasoningSelectEl.addEventListener("change", () => {
			void this.plugin.setSelectedReasoningEffort(this.reasoningSelectEl.value);
		});

		this.modeSelectEl = this.createCompactSelect(this.optionControlsEl, "Mode");
		this.modeSelectEl.addEventListener("change", () => {
			void this.plugin.setSandboxMode(this.modeSelectEl.value as SandboxMode);
		});

		const actionControls = footer.createDiv({ cls: "quick-skills-toolbar-actions" });
		this.micButton = actionControls.createEl("button", {
			cls: "quick-skills-toolbar-button quick-skills-toolbar-button-mic",
			attr: { "aria-label": "Voice dictation", title: "Voice dictation" }
		});
		setIcon(this.micButton, "mic");
		this.micButton.addEventListener("click", () => {
			void this.toggleDictation();
		});
		this.skillMenuEl = actionControls.createEl("details", {
			cls: "quick-skills-composer-skill-menu quick-skills-popover-menu"
		});
		this.skillMenuEl.addEventListener("toggle", () => {
			if (this.plugin.isRunning) {
				this.skillMenuEl.removeAttribute("open");
				return;
			}
			if (this.skillMenuEl.open) {
				this.closeOpenPopoverMenus(this.skillMenuEl);
				this.updatePopoverDirection(this.skillMenuEl);
			}
		});
		this.skillMenuTriggerEl = this.skillMenuEl.createEl("summary", {
			cls: "quick-skills-toolbar-button quick-skills-toolbar-button-skill",
			attr: {
				"aria-label": "Run skill",
				title: "Run skill"
			}
		});
		setIcon(this.skillMenuTriggerEl, "sparkles");
		this.skillMenuPopoverEl = this.skillMenuEl.createDiv({
			cls: "quick-skills-actions-popover quick-skills-composer-skill-popover"
		});

		this.sendButton = actionControls.createEl("button", {
			cls: "quick-skills-toolbar-button quick-skills-toolbar-button-send",
			attr: { "aria-label": "Send prompt", title: "Send prompt" }
		});
		setIcon(this.sendButton, "arrow-up");
		this.sendButton.addEventListener("click", () => {
			void this.sendManualPrompt();
		});
		this.stopButton = actionControls.createEl("button", {
			cls: "quick-skills-toolbar-button quick-skills-toolbar-button-stop",
			attr: { "aria-label": "Stop run", title: "Stop run" }
		});
		setIcon(this.stopButton, "square");
		this.stopButton.addEventListener("click", () => {
			this.plugin.cancelCurrentRun();
		});

		this.render();
	}

	render(): void {
		this.renderSessions(this.plugin.sessions);
		this.renderModelOptions();
		this.renderReasoningOptions();
		this.renderModeOptions();
		this.renderSkillMenu();
		this.renderDictationUi();
		void this.renderTranscript();
		const controlsBlocked = this.plugin.isRunning || this.isDictationBusy();
		this.skillMenuTriggerEl.toggleClass("is-disabled", controlsBlocked);
		this.skillMenuTriggerEl.setAttribute("aria-disabled", controlsBlocked ? "true" : "false");
		if (controlsBlocked) {
			this.skillMenuEl.removeAttribute("open");
		}
		this.sendButton.disabled = controlsBlocked;
		this.sendButton.hidden = this.plugin.isRunning;
		this.stopButton.hidden = !this.plugin.isRunning;
		this.autosizeInput();
	}

	async onClose(): Promise<void> {
		await this.teardownDictation();
	}

	private renderSessions(sessions: SessionSummary[]): void {
		if (!this.sessionSelectEl) {
			return;
		}
		const active = this.plugin.activeSessionId;
		this.sessionSelectEl.empty();
		sessions.forEach((session) => {
			const option = this.sessionSelectEl.createEl("option", { text: session.label });
			option.value = session.id;
			option.selected = session.id === active;
			if (session.tooltip) {
				option.title = session.tooltip;
			}
		});
	}

	private async renderTranscript(): Promise<void> {
		const renderVersion = ++this.transcriptRenderVersion;
		this.transcriptEl.empty();
		const messages = this.plugin.getCurrentTranscript();
		this.pruneExpandedActivityIds(messages);
		this.pruneExpandedReasoningMessageIds(messages);

		for (const message of messages) {
			const row = this.transcriptEl.createDiv({
				cls: `quick-skills-row quick-skills-row-${message.role}`,
				attr: { "data-message-id": message.id }
			});
			const bubble = row.createDiv({ cls: `quick-skills-bubble quick-skills-bubble-${message.role}` });
			const label = this.metaLabelForMessage(message);
			const meta = label.length > 0 ? bubble.createDiv({ cls: "quick-skills-message-meta" }) : null;
			if (meta && label.length > 0) {
				meta.setText(label);
			}

			const content = bubble.createDiv({ cls: "quick-skills-message-content markdown-rendered" });
			if (message.role === "assistant") {
				if (message.isStreaming) {
					await this.renderAssistantStreamingState(content, message);
				} else {
					await this.renderAssistantCompletedState(content, message);
				}
			} else if (message.role === "skill") {
				const pill = content.createDiv({ cls: "quick-skills-skill-pill" });
				const iconEl = pill.createSpan({ cls: "quick-skills-skill-pill-icon" });
				setIcon(iconEl, "sparkles");
				const copy = pill.createDiv({ cls: "quick-skills-skill-pill-copy" });
				copy.createDiv({ cls: "quick-skills-skill-pill-label", text: "Skill" });
				copy.createDiv({
					cls: "quick-skills-skill-pill-name",
					text: message.skillName?.trim() || "Unnamed skill"
				});
				if (message.activeNotePath?.trim()) {
					const noteMeta = pill.createSpan({ cls: "quick-skills-skill-pill-meta" });
					const noteIcon = noteMeta.createSpan({ cls: "quick-skills-skill-pill-meta-icon" });
					setIcon(noteIcon, "file-text");
					noteMeta.createSpan({
						cls: "quick-skills-skill-pill-meta-label",
						text: this.summarizeNotePath(message.activeNotePath)
					});
				}
			} else if (message.role === "error") {
				content.createEl("pre", { text: message.content, cls: "quick-skills-message-plain" });
			} else {
				await MarkdownRenderer.render(this.app, message.content, content, "", this);
			}

			if (renderVersion !== this.transcriptRenderVersion) {
				return;
			}
		}

		if (this.pendingScrollMessageId) {
			const target = this.transcriptEl.querySelector<HTMLElement>(`.quick-skills-row[data-message-id="${this.pendingScrollMessageId}"]`);
			if (target) {
				this.transcriptEl.scrollTop = target.offsetTop - 8;
			} else {
				this.transcriptEl.scrollTop = this.transcriptEl.scrollHeight;
			}
			this.pendingScrollMessageId = null;
			return;
		}

		this.transcriptEl.scrollTop = this.transcriptEl.scrollHeight;
	}

	private async renderAssistantStreamingState(container: HTMLElement, message: ChatMessage): Promise<void> {
		const trace = this.getStoredTurnTrace(message);
		const liveState = container.createDiv({ cls: "quick-skills-live-state" });
		await this.renderTraceItems(liveState, trace.items);
		const status = liveState.createDiv({ cls: "quick-skills-live-state-status" });
		status.createSpan({
			cls: "quick-skills-live-state-label",
			text: this.getStreamingStatusLabel(trace.items)
		});
	}

	private async renderAssistantCompletedState(container: HTMLElement, message: ChatMessage): Promise<void> {
		const hasTurnTrace = this.hasStoredTurnTrace(message);
		const traceExpanded = hasTurnTrace && this.expandedReasoningMessageIds.has(message.id);
		if (hasTurnTrace) {
			this.renderTurnTraceToggle(container, message, traceExpanded);
		}
		if (traceExpanded) {
			const tracePanel = container.createDiv({ cls: "quick-skills-reasoning-panel" });
			await this.renderTraceItems(tracePanel, this.getStoredTurnTrace(message).items);
			this.renderMessageDivider(container, "Final message");
		}
		const finalMessage = container.createDiv({ cls: "quick-skills-final-message" });
		const finalContent = finalMessage.createDiv({ cls: "quick-skills-final-message-content markdown-rendered" });
		await MarkdownRenderer.render(this.app, message.content, finalContent, "", this);
		this.renderAssistantMessageActions(finalMessage, message);
	}

	private async renderTraceItems(
		container: HTMLElement,
		items: ChatTraceItem[]
	): Promise<void> {
		const traceItems = items.filter((item) => !!item.activity || !!item.text?.trim());
		if (traceItems.length === 0) {
			return;
		}
		for (const item of traceItems) {
			if (item.kind === "activity" && item.activity) {
				this.renderActivityCard(container, item.activity);
				continue;
			}
			const text = item.text?.trim();
			if (!text) {
				continue;
			}
			const block = container.createDiv({
				cls: item.kind === "reasoning"
					? "quick-skills-trace-text quick-skills-trace-text-reasoning markdown-rendered"
					: "quick-skills-trace-text quick-skills-trace-text-message markdown-rendered"
			});
			await MarkdownRenderer.render(this.app, text, block, "", this);
		}
	}

	private renderAssistantMessageActions(container: HTMLElement, message: ChatMessage): void {
		const actions = container.createDiv({ cls: "quick-skills-message-actions-inline" });
		this.createInlineMessageAction(actions, "copy", "Copy message", async () => {
			await navigator.clipboard.writeText(message.content);
			new Notice("Assistant message copied.");
		});
		this.createInlineMessageAction(actions, "file-pen", "Insert at cursor", async () => {
			await this.plugin.insertIntoActiveNote(message.content, "cursor");
		});
		this.createInlineMessageAction(actions, "file-plus", "Append to note", async () => {
			await this.plugin.insertIntoActiveNote(message.content, "append");
		});
	}

	private createInlineMessageAction(
		container: HTMLElement,
		icon: string,
		label: string,
		action: () => Promise<void>
	): void {
		const button = container.createEl("button", {
			cls: "quick-skills-message-action-icon",
			attr: {
				type: "button",
				"aria-label": label,
				title: label
			}
		});
		setIcon(button, icon);
		button.addEventListener("click", () => {
			void action();
		});
	}

	private renderModelOptions(): void {
		if (!this.modelSelectEl) {
			return;
		}
		const models = this.plugin.getAvailableModels();
		const selected = this.plugin.settings.selectedModel;
		this.modelSelectEl.empty();
		models.forEach((model) => {
			const option = this.modelSelectEl.createEl("option", { text: model.label });
			option.value = model.id;
			option.selected = model.id === selected;
		});
	}

	private renderReasoningOptions(): void {
		if (!this.reasoningSelectEl || !this.modelSelectEl) {
			return;
		}
		const selectedModel = this.modelSelectEl.value || this.plugin.settings.selectedModel;
		const selectedReasoning = this.plugin.settings.selectedReasoningEffort;
		const reasoningLevels = this.plugin.getReasoningOptionsForModel(selectedModel);
		this.reasoningSelectEl.empty();
		reasoningLevels.forEach((effort) => {
			const option = this.reasoningSelectEl.createEl("option", { text: this.formatReasoningLabel(effort) });
			option.value = effort;
			option.selected = effort === selectedReasoning;
		});
	}

	private renderModeOptions(): void {
		if (!this.modeSelectEl) {
			return;
		}
		const selectedMode = this.plugin.settings.sandboxMode;
		this.modeSelectEl.empty();
		this.plugin.getAvailableSandboxModes().forEach((mode) => {
			const option = this.modeSelectEl.createEl("option", { text: this.formatModeLabel(mode) });
			option.value = mode;
			option.selected = mode === selectedMode;
		});
	}

	private createActionButton(
		container: HTMLElement,
		label: string,
		action: () => Promise<void>,
		menu: HTMLDetailsElement
	): void {
		const button = container.createEl("button", { text: label, cls: "quick-skills-actions-item" });
		button.addEventListener("click", () => {
			void (async () => {
				await action();
				menu.removeAttribute("open");
			})();
		});
	}

	private renderSkillMenu(): void {
		if (!this.skillMenuPopoverEl || !this.skillMenuEl) {
			return;
		}
		this.skillMenuPopoverEl.empty();
		if (this.plugin.isRunning || this.isDictationBusy()) {
			this.skillMenuEl.removeAttribute("open");
		}
		const applicableSkills = this.plugin.getApplicableSkills();
		if (applicableSkills.length === 0) {
			const emptyState = this.skillMenuPopoverEl.createDiv({
				cls: "quick-skills-actions-empty",
				text: "No skills for this note"
			});
			emptyState.setAttribute("aria-disabled", "true");
			return;
		}
		for (const skill of applicableSkills) {
			this.createActionButton(this.skillMenuPopoverEl, skill.name, async () => {
				await this.plugin.runSkill(skill);
			}, this.skillMenuEl);
		}
	}

	private metaLabelForMessage(message: ChatMessage): string {
		if (message.role === "assistant" || message.role === "user" || message.role === "skill") {
			return "";
		}
		const role = message.role;
		return `${role}${message.isStreaming ? " - running..." : ""}`;
	}

	private async sendManualPrompt(): Promise<void> {
		if (this.isDictationBusy()) {
			return;
		}
		const prompt = this.inputEl.value.trim();
		if (!prompt) {
			return;
		}
		this.inputEl.value = "";
		this.autosizeInput();
		await this.plugin.runManualPrompt(prompt);
		this.render();
	}

	private formatReasoningLabel(value: string): string {
		if (value === "xhigh") {
			return "X-high";
		}
		return value.charAt(0).toUpperCase() + value.slice(1);
	}

	private formatModeLabel(mode: SandboxMode): string {
		if (mode === "read-only") {
			return "Read";
		}
		if (mode === "workspace-write") {
			return "Write";
		}
		return "Danger";
	}

	private renderDictationUi(): void {
		const dictationVisible = this.dictationState !== "idle";
		this.optionControlsEl.hidden = dictationVisible;
		this.dictationDisplayEl.hidden = !dictationVisible;
		if (!this.micButton) {
			return;
		}
		this.micButton.disabled = this.plugin.isRunning || this.dictationState === "transcribing";
		this.micButton.toggleClass("is-recording", this.dictationState === "recording");
		this.micButton.toggleClass("is-transcribing", this.dictationState === "transcribing");
		this.micButton.setAttribute(
			"title",
			this.dictationState === "recording"
				? "Stop dictation"
				: (this.dictationState === "transcribing" ? "Transcribing..." : "Start dictation")
		);
		this.micButton.setAttribute(
			"aria-label",
			this.dictationState === "recording"
				? "Stop dictation"
				: (this.dictationState === "transcribing" ? "Transcribing..." : "Start dictation")
		);
		if (this.dictationState === "transcribing") {
			setIcon(this.micButton, "loader");
			this.dictationStatusEl.setText("Transcribing audio...");
		} else {
			setIcon(this.micButton, "mic");
			this.dictationStatusEl.setText("Listening...");
		}
		this.renderDictationLevels();
	}

	private renderDictationLevels(): void {
		this.dictationBars.forEach((bar, index) => {
			const level = this.dictationLevels[index] ?? 0;
			bar.style.setProperty("--quick-skills-dictation-level", `${Math.max(0.12, level)}`);
		});
	}

	private async toggleDictation(): Promise<void> {
		if (this.plugin.isRunning || this.dictationState === "transcribing") {
			return;
		}
		if (this.dictationState === "recording") {
			await this.stopDictation();
			return;
		}
		await this.startDictation();
	}

	private async startDictation(): Promise<void> {
		try {
			this.dictationLevels = Array.from({ length: DICTATION_BAR_COUNT }, () => 0);
			this.dictationSession = new DictationSession({
				baseUrl: this.plugin.settings.whisperBaseUrl,
				language: this.plugin.settings.whisperLanguage,
				timeoutMs: this.plugin.settings.whisperRequestTimeoutMs
			}, {
				onLevel: (level) => {
					this.pushDictationLevel(level);
				}
			});
			await this.dictationSession.start();
			this.dictationState = "recording";
			this.render();
		} catch (error) {
			this.dictationSession = null;
			this.dictationState = "idle";
			new Notice(this.getErrorMessage(error, "Failed to start voice dictation."));
			this.render();
		}
	}

	private async stopDictation(): Promise<void> {
		if (!this.dictationSession) {
			this.dictationState = "idle";
			this.render();
			return;
		}
		this.dictationState = "transcribing";
		this.render();
		try {
			const transcript = (await this.dictationSession.stopAndTranscribe()).trim();
			if (!transcript) {
				new Notice("No speech detected.");
			} else {
				this.appendDictationTranscript(transcript);
			}
		} catch (error) {
			new Notice(this.getErrorMessage(error, "Voice dictation transcription failed."));
		} finally {
			this.dictationSession = null;
			this.dictationState = "idle";
			this.dictationLevels = Array.from({ length: DICTATION_BAR_COUNT }, () => 0);
			this.render();
		}
	}

	private appendDictationTranscript(transcript: string): void {
		const existing = this.inputEl.value.trim();
		this.inputEl.value = existing ? `${this.inputEl.value.trimEnd()}\n\n${transcript}` : transcript;
		this.autosizeInput();
		this.inputEl.focus();
	}

	private pushDictationLevel(level: number): void {
		this.dictationLevels = [...this.dictationLevels.slice(1), level];
		this.renderDictationLevels();
	}

	private async teardownDictation(): Promise<void> {
		if (!this.dictationSession) {
			return;
		}
		await this.dictationSession.abort();
		this.dictationSession = null;
		this.dictationState = "idle";
	}

	private isDictationBusy(): boolean {
		return this.dictationState !== "idle";
	}

	private getErrorMessage(error: unknown, fallback: string): string {
		return error instanceof Error && error.message.trim() ? error.message : fallback;
	}

	private renderTurnTraceToggle(container: HTMLElement, message: ChatMessage, expanded: boolean): void {
		const trace = this.getStoredTurnTrace(message);
		const label = trace.durationMs && Number.isFinite(trace.durationMs)
			? `Worked for ${this.formatDuration(trace.durationMs)}`
			: "Worked";
		const button = container.createDiv({ cls: "quick-skills-turn-trace-toggle" });
		button.setAttribute("role", "button");
		button.setAttribute("tabindex", "0");
		button.setAttribute("aria-expanded", expanded ? "true" : "false");
		button.toggleClass("is-expanded", expanded);
		const leftRule = button.createSpan({ cls: "quick-skills-turn-trace-rule" });
		leftRule.setAttribute("aria-hidden", "true");
		button.createSpan({ cls: "quick-skills-turn-trace-label", text: label });
		const chevronEl = button.createSpan({ cls: "quick-skills-turn-trace-chevron" });
		setIcon(chevronEl, expanded ? "chevron-down" : "chevron-right");
		const rightRule = button.createSpan({ cls: "quick-skills-turn-trace-rule" });
		rightRule.setAttribute("aria-hidden", "true");
		button.addEventListener("click", () => {
			this.toggleReasoning(message.id);
		});
		button.addEventListener("keydown", (event: KeyboardEvent) => {
			if (event.key !== "Enter" && event.key !== " ") {
				return;
			}
			event.preventDefault();
			this.toggleReasoning(message.id);
		});
	}

	private renderMessageDivider(container: HTMLElement, label: string): void {
		const divider = container.createDiv({ cls: "quick-skills-message-divider" });
		const leftRule = divider.createSpan({ cls: "quick-skills-message-divider-rule" });
		leftRule.setAttribute("aria-hidden", "true");
		divider.createSpan({ cls: "quick-skills-message-divider-label", text: label });
		const rightRule = divider.createSpan({ cls: "quick-skills-message-divider-rule" });
		rightRule.setAttribute("aria-hidden", "true");
	}

	private summarizeNotePath(path: string): string {
		const trimmed = path.trim();
		if (!trimmed) {
			return "";
		}
		const segments = trimmed.split("/").filter((segment) => segment.length > 0);
		if (segments.length === 0) {
			return trimmed;
		}
		const fileName = segments[segments.length - 1] ?? trimmed;
		return fileName.endsWith(".md") ? fileName.slice(0, -3) : fileName;
	}

	private renderActivityCard(
		container: HTMLElement,
		activity: ChatActivity
	): void {
		const cardClass = `quick-skills-activity quick-skills-activity-${activity.status}`;
		if (!activity.detail?.trim()) {
			const card = container.createDiv({ cls: cardClass });
			this.renderActivityHeader(card, activity);
			return;
		}

		const detailsEl = container.createEl("details", {
			cls: `${cardClass} quick-skills-activity-details`
		});
		detailsEl.open = this.isActivityExpanded(activity.id);
		detailsEl.addEventListener("toggle", () => {
			if (detailsEl.open) {
				this.expandedActivityIds.add(activity.id);
				this.collapsedActivityIds.delete(activity.id);
			} else {
				this.expandedActivityIds.delete(activity.id);
				this.collapsedActivityIds.add(activity.id);
			}
		});

		const summaryEl = detailsEl.createEl("summary", { cls: "quick-skills-activity-summary" });
		const disclosureEl = summaryEl.createSpan({ cls: "quick-skills-activity-disclosure" });
		setIcon(disclosureEl, "chevron-right");
		this.renderActivityHeader(summaryEl, activity);
		detailsEl.createEl("pre", {
			text: activity.detail,
			cls: "quick-skills-message-plain quick-skills-activity-detail"
		});
	}

	private isActivityExpanded(activityId: string): boolean {
		if (this.expandedActivityIds.has(activityId)) {
			return true;
		}
		if (this.collapsedActivityIds.has(activityId)) {
			return false;
		}
		return false;
	}

	private renderActivityHeader(container: HTMLElement, activity: ChatActivity): void {
		container.addClass("quick-skills-activity-header");
		const iconEl = container.createSpan({ cls: "quick-skills-activity-icon" });
		setIcon(iconEl, this.iconForActivity(activity.kind));
		container.createSpan({
			cls: "quick-skills-activity-title",
			text: activity.title,
			attr: { title: activity.title }
		});
		container.createSpan({
			cls: `quick-skills-activity-status quick-skills-activity-status-${activity.status}`,
			text: this.labelForActivityStatus(activity.status)
		});
	}

	private iconForActivity(kind: ChatActivity["kind"]): string {
		switch (kind) {
			case "command_execution":
				return "terminal";
			case "todo_list":
				return "list-todo";
			case "web_search":
				return "search";
			case "mcp_tool_call":
				return "plug";
			case "file_change":
				return "file-pen";
			case "error":
				return "alert-triangle";
			default:
				return "dot";
		}
	}

	private labelForActivityStatus(status: ChatActivity["status"]): string {
		if (status === "completed") {
			return "Done";
		}
		if (status === "failed") {
			return "Failed";
		}
		if (status === "info") {
			return "Updated";
		}
		return "Running";
	}

	private pruneExpandedActivityIds(messages: ChatMessage[]): void {
		const visibleIds = new Set<string>();
		for (const message of messages) {
			for (const item of message.turnTrace?.items ?? []) {
				if (item.kind === "activity" && item.activity) {
					visibleIds.add(item.activity.id);
				}
			}
			for (const activity of message.turnTrace?.activities ?? []) {
				visibleIds.add(activity.id);
			}
		}
		for (const activityId of Array.from(this.expandedActivityIds)) {
			if (!visibleIds.has(activityId)) {
				this.expandedActivityIds.delete(activityId);
			}
		}
		for (const activityId of Array.from(this.collapsedActivityIds)) {
			if (!visibleIds.has(activityId)) {
				this.collapsedActivityIds.delete(activityId);
			}
		}
	}

	private pruneExpandedReasoningMessageIds(messages: ChatMessage[]): void {
		const visibleIds = new Set(
			messages
				.filter((message) => message.role === "assistant" && this.hasStoredTurnTrace(message))
				.map((message) => message.id)
		);
		for (const messageId of Array.from(this.expandedReasoningMessageIds)) {
			if (!visibleIds.has(messageId)) {
				this.expandedReasoningMessageIds.delete(messageId);
			}
		}
	}

	private toggleReasoning(messageId: string): void {
		if (this.expandedReasoningMessageIds.has(messageId)) {
			this.expandedReasoningMessageIds.delete(messageId);
		} else {
			this.expandedReasoningMessageIds.add(messageId);
			this.pendingScrollMessageId = messageId;
		}
		this.render();
	}

	private closeOpenPopoverMenus(exceptMenu?: HTMLDetailsElement): void {
		for (const menu of Array.from(this.contentEl.querySelectorAll<HTMLDetailsElement>(".quick-skills-popover-menu[open]"))) {
			if (exceptMenu && menu === exceptMenu) {
				continue;
			}
			menu.open = false;
		}
	}

	private updatePopoverDirection(menu: HTMLDetailsElement): void {
		menu.removeClass("quick-skills-popover-menu-up");
		const popover = menu.querySelector<HTMLElement>(".quick-skills-actions-popover");
		const trigger = menu.querySelector<HTMLElement>("summary");
		if (!popover || !trigger) {
			return;
		}
		const bounds = this.getPopoverViewportBounds(menu);
		const triggerRect = trigger.getBoundingClientRect();
		const popoverRect = popover.getBoundingClientRect();
		const availableBelow = bounds.bottom - triggerRect.bottom;
		const availableAbove = triggerRect.top - bounds.top;
		if (popoverRect.height > availableBelow && availableAbove > availableBelow) {
			menu.addClass("quick-skills-popover-menu-up");
		}
	}

	private getPopoverViewportBounds(menu: HTMLDetailsElement): DOMRect {
		if (menu.closest(".quick-skills-transcript")) {
			return this.transcriptEl.getBoundingClientRect();
		}
		return this.contentEl.getBoundingClientRect();
	}

	private openRenameSessionModal(): void {
		const activeSession = this.plugin.getActiveSessionSummary();
		const sessionId = activeSession?.id ?? this.plugin.activeSessionId;
		if (!sessionId) {
			return;
		}
		const initialName = activeSession?.title ?? "New session";
		new SessionRenameModal(this.app, initialName, async (nextName) => {
			await this.plugin.renameSession(sessionId, nextName);
			this.render();
		}).open();
	}

	private hasStoredTurnTrace(message: ChatMessage): boolean {
		const trace = this.getStoredTurnTrace(message);
		return trace.items.length > 0;
	}

	private getStoredTurnTrace(message: ChatMessage): {
		items: ChatTraceItem[];
		durationMs?: number;
	} {
		const logTrace = this.getExecutionLogTrace(message);
		if (logTrace) {
			return logTrace;
		}

		const storedItems = (message.turnTrace?.items ?? [])
			.map((item) => ({
				id: item.id,
				kind: item.kind,
				text: item.text,
				activity: item.activity ? { ...item.activity } : undefined,
				isDraft: item.isDraft
			}))
			.filter((item) => !!item.activity || !!item.text?.trim());
		if (storedItems.length > 0) {
			return {
				items: storedItems,
				durationMs: message.turnTrace?.durationMs
			};
		}

		const items: ChatTraceItem[] = [];
		const reasoningText = message.turnTrace?.reasoningText?.trim() || message.reasoningTrace?.trim() || undefined;
		if (reasoningText) {
			items.push({
				id: `${message.id}-reasoning`,
				kind: "reasoning",
				text: reasoningText
			});
		}
		for (const activity of message.turnTrace?.activities ?? []) {
			items.push({
				id: activity.id,
				kind: "activity",
				activity
			});
		}
		for (const entry of (message.turnTrace?.completedMessages ?? []).slice(0, -1)) {
			if (!entry.trim()) {
				continue;
			}
			items.push({
				id: `${message.id}-message-${items.length}`,
				kind: "message",
				text: entry
			});
		}
		return {
			items,
			durationMs: message.turnTrace?.durationMs
		};
	}

	private getExecutionLogTrace(message: ChatMessage): { items: ChatTraceItem[]; durationMs?: number } | null {
		if (message.role !== "assistant" || message.isStreaming) {
			return null;
		}
		const executionLog = this.plugin.getExecutionLogForAssistantMessage(message);
		if (!executionLog || executionLog.rawEvents.length === 0) {
			return null;
		}
		const accumulator = new CodexStreamAccumulator();
		for (const rawEvent of executionLog.rawEvents) {
			const payload = rawEvent.payload;
			if (!payload || typeof payload !== "object" || typeof (payload as { type?: unknown }).type !== "string") {
				continue;
			}
			accumulator.apply(payload as never);
		}
		const items = accumulator.getLiveState().traceItems;
		if (items.length === 0) {
			return null;
		}
		return {
			items,
			durationMs: Number.isFinite(executionLog.durationMs) ? executionLog.durationMs : message.turnTrace?.durationMs
		};
	}

	private formatDuration(durationMs: number): string {
		const totalSeconds = Math.max(1, Math.round(durationMs / 1000));
		const minutes = Math.floor(totalSeconds / 60);
		const seconds = totalSeconds % 60;
		if (minutes <= 0) {
			return `${seconds}s`;
		}
		if (seconds === 0) {
			return `${minutes}m`;
		}
		return `${minutes}m ${seconds}s`;
	}

	private getStreamingStatusLabel(items: ChatTraceItem[]): string {
		for (let index = items.length - 1; index >= 0; index -= 1) {
			const item = items[index];
			if (!item) {
				continue;
			}
			if (item.kind === "activity" && item.activity) {
				if (item.activity.kind === "todo_list") {
					return "Updating plan";
				}
				return "Using tools";
			}
			if (item.kind === "message") {
				return item.isDraft ? "Drafting response" : "Sharing progress";
			}
			if (item.kind === "reasoning") {
				return "Thinking";
			}
		}
		return "Working";
	}

	private createCompactSelect(container: HTMLElement, label: string): HTMLSelectElement {
		const wrapper = container.createDiv({ cls: "quick-skills-toolbar-select-wrap" });
		const select = wrapper.createEl("select", {
			cls: "quick-skills-toolbar-select",
			attr: {
				"aria-label": label,
				title: label
			}
		});
		return select;
	}

	private autosizeInput(): void {
		if (!this.inputEl) {
			return;
		}
		this.inputEl.setCssProps({ "--quick-skills-input-height": "0px" });
		const height = Math.min(Math.max(this.inputEl.scrollHeight, 40), 160);
		this.inputEl.setCssProps({ "--quick-skills-input-height": `${height}px` });
	}
}
