import { MarkdownRenderer, Notice, setIcon, type Component } from "obsidian";
import type QuickSkillsPlugin from "../../main";
import { CodexStreamAccumulator } from "../../codex/streamAccumulator";
import type { ChatActivity, ChatMessage, ChatTraceItem } from "../../types";
import { iconForActivity, labelForActivityStatus, summarizeNotePath } from "./formatters";

export class TranscriptPane {
	private readonly plugin: QuickSkillsPlugin;
	private readonly host: Component;
	private readonly transcriptEl: HTMLElement;
	private transcriptRenderVersion = 0;
	private readonly expandedActivityIds = new Set<string>();
	private readonly collapsedActivityIds = new Set<string>();
	private readonly expandedReasoningMessageIds = new Set<string>();
	private pendingScrollMessageId: string | null = null;

	constructor(options: {
		plugin: QuickSkillsPlugin;
		host: Component;
		containerEl: HTMLElement;
	}) {
		this.plugin = options.plugin;
		this.host = options.host;
		this.transcriptEl = options.containerEl.createDiv({ cls: "quick-skills-transcript" });
	}

	get element(): HTMLElement {
		return this.transcriptEl;
	}

	requestRender(): void {
		void this.render();
	}

	private async render(): Promise<void> {
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
			if (label.length > 0) {
				bubble.createDiv({ cls: "quick-skills-message-meta", text: label });
			}

			const content = bubble.createDiv({ cls: "quick-skills-message-content markdown-rendered" });
			if (message.role === "assistant") {
				if (message.isStreaming) {
					await this.renderAssistantStreamingState(content, message);
				} else {
					await this.renderAssistantCompletedState(content, message);
				}
			} else if (message.role === "skill") {
				this.renderSkillMessage(content, message);
			} else if (message.role === "error") {
				content.createEl("pre", { text: message.content, cls: "quick-skills-message-plain" });
			} else {
				await MarkdownRenderer.render(this.plugin.app, message.content, content, "", this.host);
			}

			if (renderVersion !== this.transcriptRenderVersion) {
				return;
			}
		}

		if (this.pendingScrollMessageId) {
			const target = this.transcriptEl.querySelector<HTMLElement>(`.quick-skills-row[data-message-id="${this.pendingScrollMessageId}"]`);
			this.transcriptEl.scrollTop = target ? target.offsetTop - 8 : this.transcriptEl.scrollHeight;
			this.pendingScrollMessageId = null;
			return;
		}
		this.transcriptEl.scrollTop = this.transcriptEl.scrollHeight;
	}

	private renderSkillMessage(container: HTMLElement, message: ChatMessage): void {
		const pill = container.createDiv({ cls: "quick-skills-skill-pill" });
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
				text: summarizeNotePath(message.activeNotePath)
			});
		}
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
		await MarkdownRenderer.render(this.plugin.app, message.content, finalContent, "", this.host);
		this.renderAssistantMessageActions(finalMessage, message);
	}

	private async renderTraceItems(container: HTMLElement, items: ChatTraceItem[]): Promise<void> {
		const traceItems = items.filter((item) => !!item.activity || !!item.text?.trim());
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
			await MarkdownRenderer.render(this.plugin.app, text, block, "", this.host);
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
			attr: { type: "button", "aria-label": label, title: label }
		});
		setIcon(button, icon);
		button.addEventListener("click", () => {
			void action();
		});
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

	private renderActivityHeader(container: HTMLElement, activity: ChatActivity): void {
		container.addClass("quick-skills-activity-header");
		const iconEl = container.createSpan({ cls: "quick-skills-activity-icon" });
		setIcon(iconEl, iconForActivity(activity.kind));
		container.createSpan({
			cls: "quick-skills-activity-title",
			text: activity.title,
			attr: { title: activity.title }
		});
		container.createSpan({
			cls: `quick-skills-activity-status quick-skills-activity-status-${activity.status}`,
			text: labelForActivityStatus(activity.status)
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
		this.requestRender();
	}

	private hasStoredTurnTrace(message: ChatMessage): boolean {
		const trace = this.getStoredTurnTrace(message);
		return trace.items.length > 0;
	}

	private getStoredTurnTrace(message: ChatMessage): { items: ChatTraceItem[]; durationMs?: number } {
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
			return { items: storedItems, durationMs: message.turnTrace?.durationMs };
		}

		const items: ChatTraceItem[] = [];
		const reasoningText = message.turnTrace?.reasoningText?.trim() || message.reasoningTrace?.trim() || undefined;
		if (reasoningText) {
			items.push({ id: `${message.id}-reasoning`, kind: "reasoning", text: reasoningText });
		}
		for (const activity of message.turnTrace?.activities ?? []) {
			items.push({ id: activity.id, kind: "activity", activity });
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
		return { items, durationMs: message.turnTrace?.durationMs };
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

	private metaLabelForMessage(message: ChatMessage): string {
		if (message.role === "assistant" || message.role === "user" || message.role === "skill") {
			return "";
		}
		return `${message.role}${message.isStreaming ? " - running..." : ""}`;
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
}
