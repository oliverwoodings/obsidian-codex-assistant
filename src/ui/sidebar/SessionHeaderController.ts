import { setIcon } from "obsidian";
import type QuickSkillsPlugin from "../../main";
import type { SessionSummary } from "../../types";
import { closeOpenPopoverMenus, updatePopoverDirection } from "./popover";

export class SessionHeaderController {
	private readonly plugin: QuickSkillsPlugin;
	private readonly rootEl: HTMLElement;
	private readonly contentEl: HTMLElement;
	private readonly transcriptEl: () => HTMLElement | null;
	private readonly sessionSelectEl: HTMLSelectElement;
	private readonly sessionMenuEl: HTMLDetailsElement;

	constructor(options: {
		plugin: QuickSkillsPlugin;
		rootEl: HTMLElement;
		contentEl: HTMLElement;
		transcriptEl: () => HTMLElement | null;
	}) {
		this.plugin = options.plugin;
		this.rootEl = options.rootEl;
		this.contentEl = options.contentEl;
		this.transcriptEl = options.transcriptEl;

		const header = this.rootEl.createDiv({ cls: "quick-skills-topbar" });
		header.createDiv({ cls: "quick-skills-topbar-label", text: "Session" });
		const sessionGroup = header.createDiv({ cls: "quick-skills-session-group" });
		this.sessionSelectEl = sessionGroup.createEl("select", { cls: "quick-skills-session-select" });
		this.sessionSelectEl.addEventListener("change", () => {
			void this.plugin.setActiveSession(this.sessionSelectEl.value);
		});

		this.sessionMenuEl = sessionGroup.createEl("details", {
			cls: "quick-skills-session-menu quick-skills-popover-menu"
		});
		this.sessionMenuEl.addEventListener("toggle", () => {
			if (!this.sessionMenuEl.open) {
				return;
			}
			closeOpenPopoverMenus(this.contentEl, this.sessionMenuEl);
			updatePopoverDirection(this.sessionMenuEl, this.contentEl, this.transcriptEl() ?? undefined);
		});
		const sessionMenuTrigger = this.sessionMenuEl.createEl("summary", {
			cls: "quick-skills-session-menu-trigger",
			attr: {
				"aria-label": "Session actions",
				title: "Session actions"
			}
		});
		setIcon(sessionMenuTrigger, "settings");
		const sessionMenuPopover = this.sessionMenuEl.createDiv({
			cls: "quick-skills-actions-popover quick-skills-session-menu-popover"
		});
		this.createActionButton(sessionMenuPopover, "Rename", async () => {
			this.openRenameSessionModal();
		});
		this.createActionButton(sessionMenuPopover, "Archive", async () => {
			const activeSessionId = this.plugin.activeSessionId;
			if (!activeSessionId) {
				return;
			}
			await this.plugin.archiveSession(activeSessionId);
		});
		const newSessionButton = sessionGroup.createEl("button", {
			cls: "quick-skills-new-session-button",
			text: "New"
		});
		newSessionButton.addEventListener("click", () => {
			void this.plugin.createAndSelectSession();
		});
	}

	render(sessions: SessionSummary[], activeSessionId: string): void {
		this.sessionSelectEl.empty();
		sessions.forEach((session) => {
			const option = this.sessionSelectEl.createEl("option", { text: session.label });
			option.value = session.id;
			option.selected = session.id === activeSessionId;
			if (session.tooltip) {
				option.title = session.tooltip;
			}
		});
	}

	private createActionButton(
		container: HTMLElement,
		label: string,
		action: () => Promise<void>
	): void {
		const button = container.createEl("button", { text: label, cls: "quick-skills-actions-item" });
		button.addEventListener("click", () => {
			void (async () => {
				await action();
				this.sessionMenuEl.removeAttribute("open");
			})();
		});
	}

	private openRenameSessionModal(): void {
		const activeSession = this.plugin.getActiveSessionSummary();
		const sessionId = activeSession?.id ?? this.plugin.activeSessionId;
		if (!sessionId) {
			return;
		}
		const initialName = activeSession?.title ?? "New session";
		void import("../SessionRenameModal").then(({ SessionRenameModal }) => {
			new SessionRenameModal(this.plugin.app, initialName, async (nextName) => {
				await this.plugin.renameSession(sessionId, nextName);
			}).open();
		});
	}
}
