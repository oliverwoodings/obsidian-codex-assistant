import { ItemView, MarkdownRenderer, Notice, setIcon, type WorkspaceLeaf } from "obsidian";
import type QuickSkillsPlugin from "../main";
import type { ChatActivity, ChatMessage, SandboxMode, SessionSummary } from "../types";
import { SessionRenameModal } from "./SessionRenameModal";

export const QUICK_SKILLS_VIEW_TYPE = "quick-skills-sidebar";

export class QuickSkillsView extends ItemView {
	private readonly plugin: QuickSkillsPlugin;
	private transcriptEl!: HTMLElement;
	private inputEl!: HTMLTextAreaElement;
	private sessionSelectEl!: HTMLSelectElement;
	private modelSelectEl!: HTMLSelectElement;
	private reasoningSelectEl!: HTMLSelectElement;
	private modeSelectEl!: HTMLSelectElement;
	private skillMenuEl!: HTMLDetailsElement;
	private skillMenuPopoverEl!: HTMLElement;
	private skillMenuTriggerEl!: HTMLElement;
	private sendButton!: HTMLButtonElement;
	private stopButton!: HTMLButtonElement;
	private transcriptRenderVersion = 0;
	private readonly expandedActivityIds = new Set<string>();
	private readonly expandedReasoningMessageIds = new Set<string>();

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
		const optionControls = footer.createDiv({ cls: "quick-skills-toolbar-selects" });

		this.modelSelectEl = this.createCompactSelect(optionControls, "Model");
		this.modelSelectEl.addEventListener("change", () => {
			void (async () => {
				await this.plugin.setSelectedModel(this.modelSelectEl.value);
				this.renderReasoningOptions();
			})();
		});

		this.reasoningSelectEl = this.createCompactSelect(optionControls, "Reasoning");
		this.reasoningSelectEl.addEventListener("change", () => {
			void this.plugin.setSelectedReasoningEffort(this.reasoningSelectEl.value);
		});

		this.modeSelectEl = this.createCompactSelect(optionControls, "Mode");
		this.modeSelectEl.addEventListener("change", () => {
			void this.plugin.setSandboxMode(this.modeSelectEl.value as SandboxMode);
		});

		const actionControls = footer.createDiv({ cls: "quick-skills-toolbar-actions" });
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
		void this.renderTranscript();
		this.skillMenuTriggerEl.toggleClass("is-disabled", this.plugin.isRunning);
		this.skillMenuTriggerEl.setAttribute("aria-disabled", this.plugin.isRunning ? "true" : "false");
		this.sendButton.disabled = this.plugin.isRunning;
		this.sendButton.hidden = this.plugin.isRunning;
		this.stopButton.hidden = !this.plugin.isRunning;
		this.autosizeInput();
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
			const row = this.transcriptEl.createDiv({ cls: `quick-skills-row quick-skills-row-${message.role}` });
			const bubble = row.createDiv({ cls: `quick-skills-bubble quick-skills-bubble-${message.role}` });
			const label = this.metaLabelForMessage(message);
			const meta = label.length > 0 ? bubble.createDiv({ cls: "quick-skills-message-meta" }) : null;
			if (meta && label.length > 0) {
				meta.setText(label);
			}

			if (message.role === "assistant") {
				bubble.addClass("quick-skills-bubble-has-actions");
				const menuHost = meta ?? bubble;
				const menu = menuHost.createEl("details", { cls: "quick-skills-actions-menu quick-skills-popover-menu" });
				if (!meta) {
					menu.addClass("quick-skills-actions-menu-overlay");
				}
				menu.addEventListener("toggle", () => {
					if (menu.open) {
						this.closeOpenPopoverMenus(menu);
						this.updatePopoverDirection(menu);
					}
				});
				const trigger = menu.createEl("summary", { cls: "quick-skills-actions-trigger" });
				setIcon(trigger, "more-horizontal");
				trigger.setAttribute("aria-label", "Assistant message actions");
				const popover = menu.createDiv({ cls: "quick-skills-actions-popover" });
				this.createActionButton(popover, "Copy", async () => {
					await navigator.clipboard.writeText(message.content);
					new Notice("Assistant message copied.");
				}, menu);
				this.createActionButton(popover, "Insert at cursor", async () => {
					await this.plugin.insertIntoActiveNote(message.content, "cursor");
				}, menu);
				this.createActionButton(popover, "Append to note", async () => {
					await this.plugin.insertIntoActiveNote(message.content, "append");
				}, menu);
				if (!message.isStreaming && this.hasStoredTurnTrace(message)) {
					const reasoningLabel = this.expandedReasoningMessageIds.has(message.id) ? "Hide reasoning" : "Show reasoning";
					this.createActionButton(popover, reasoningLabel, async () => {
						this.toggleReasoning(message.id);
					}, menu);
				}
			}

			const content = bubble.createDiv({ cls: "quick-skills-message-content markdown-rendered" });
			if (message.role === "assistant" && message.isStreaming) {
				await this.renderAssistantStreamingState(content, message);
			}
			if (message.role === "assistant" && !message.isStreaming && this.expandedReasoningMessageIds.has(message.id)) {
				await this.renderCompletedTurnTrace(content, message);
			}
			if (message.role === "assistant" && message.isStreaming && message.content.length === 0) {
				// The structured live state above is the primary rendering while the final response is still pending.
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

		this.transcriptEl.scrollTop = this.transcriptEl.scrollHeight;
	}

	private async renderAssistantStreamingState(container: HTMLElement, message: ChatMessage): Promise<void> {
		const liveState = container.createDiv({ cls: "quick-skills-live-state" });
		liveState.createDiv({
			cls: "quick-skills-live-state-label",
			text: message.content.length > 0 ? "Running..." : "Working..."
		});
		if (message.reasoningPreview) {
			const section = liveState.createDiv({ cls: "quick-skills-live-section" });
			section.createDiv({ cls: "quick-skills-live-section-label", text: "Reasoning" });
			const reasoningContent = section.createDiv({ cls: "quick-skills-live-markdown markdown-rendered" });
			await MarkdownRenderer.render(this.app, message.reasoningPreview, reasoningContent, "", this);
		}
		if (message.draftPreview && message.draftPreview !== message.content) {
			const section = liveState.createDiv({ cls: "quick-skills-live-section" });
			section.createDiv({ cls: "quick-skills-live-section-label", text: "Draft" });
			const draftContent = section.createDiv({ cls: "quick-skills-live-markdown markdown-rendered" });
			await MarkdownRenderer.render(this.app, message.draftPreview, draftContent, "", this);
		}
		if (message.activities?.length) {
			const activityList = liveState.createDiv({ cls: "quick-skills-activity-list" });
			for (const activity of message.activities) {
				this.renderActivityCard(activityList, activity);
			}
		}
	}

	private async renderCompletedTurnTrace(container: HTMLElement, message: ChatMessage): Promise<void> {
		const trace = this.getStoredTurnTrace(message);
		if (!trace.reasoningText && trace.activities.length === 0 && trace.intermediaryMessages.length === 0) {
			return;
		}
		const section = container.createDiv({ cls: "quick-skills-reasoning-panel" });
		section.createDiv({ cls: "quick-skills-reasoning-panel-label", text: "Turn trace" });
		if (trace.reasoningText) {
			const reasoningSection = section.createDiv({ cls: "quick-skills-live-section" });
			reasoningSection.createDiv({ cls: "quick-skills-live-section-label", text: "Reasoning" });
			const reasoningContent = reasoningSection.createDiv({ cls: "quick-skills-live-markdown markdown-rendered" });
			await MarkdownRenderer.render(this.app, trace.reasoningText, reasoningContent, "", this);
		}
		if (trace.activities.length > 0) {
			const activityList = section.createDiv({ cls: "quick-skills-activity-list" });
			for (const activity of trace.activities) {
				this.renderActivityCard(activityList, activity);
			}
		}
		for (const intermediaryMessage of trace.intermediaryMessages) {
			const intermediarySection = section.createDiv({ cls: "quick-skills-live-section" });
			intermediarySection.createDiv({ cls: "quick-skills-live-section-label", text: "Intermediary message" });
			const intermediaryContent = intermediarySection.createDiv({ cls: "quick-skills-live-markdown markdown-rendered" });
			await MarkdownRenderer.render(this.app, intermediaryMessage, intermediaryContent, "", this);
		}
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
		if (this.plugin.isRunning) {
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

	private renderActivityCard(container: HTMLElement, activity: ChatActivity): void {
		const cardClass = `quick-skills-activity quick-skills-activity-${activity.status}`;
		if (!activity.detail?.trim()) {
			const card = container.createDiv({ cls: cardClass });
			this.renderActivityHeader(card, activity);
			return;
		}

		const detailsEl = container.createEl("details", {
			cls: `${cardClass} quick-skills-activity-details`
		});
		detailsEl.open = this.expandedActivityIds.has(activity.id);
		detailsEl.addEventListener("toggle", () => {
			if (detailsEl.open) {
				this.expandedActivityIds.add(activity.id);
			} else {
				this.expandedActivityIds.delete(activity.id);
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
			for (const activity of message.activities ?? []) {
				visibleIds.add(activity.id);
			}
		}
		for (const activityId of Array.from(this.expandedActivityIds)) {
			if (!visibleIds.has(activityId)) {
				this.expandedActivityIds.delete(activityId);
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
		return !!trace.reasoningText || trace.activities.length > 0 || trace.intermediaryMessages.length > 0;
	}

	private getStoredTurnTrace(message: ChatMessage): {
		reasoningText?: string;
		activities: ChatActivity[];
		intermediaryMessages: string[];
	} {
		const reasoningText = message.turnTrace?.reasoningText?.trim() || message.reasoningTrace?.trim() || undefined;
		const activities = message.turnTrace?.activities ?? [];
		const completedMessages = message.turnTrace?.completedMessages ?? [];
		const intermediaryMessages = completedMessages
			.slice(0, -1)
			.map((entry) => entry.trim())
			.filter((entry) => entry.length > 0);
		return {
			reasoningText,
			activities,
			intermediaryMessages
		};
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
