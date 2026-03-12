import type QuickSkillsPlugin from "../../main";
import { closeOpenPopoverMenus, updatePopoverDirection } from "./popover";

export class SkillMenuController {
	private readonly plugin: QuickSkillsPlugin;
	private readonly contentEl: HTMLElement;
	private readonly transcriptEl: () => HTMLElement | null;
	private readonly menuEl: HTMLDetailsElement;
	private readonly triggerEl: HTMLElement;
	private readonly popoverEl: HTMLElement;

	constructor(options: {
		plugin: QuickSkillsPlugin;
		actionControlsEl: HTMLElement;
		contentEl: HTMLElement;
		transcriptEl: () => HTMLElement | null;
	}) {
		this.plugin = options.plugin;
		this.contentEl = options.contentEl;
		this.transcriptEl = options.transcriptEl;
		this.menuEl = options.actionControlsEl.createEl("details", {
			cls: "quick-skills-composer-skill-menu quick-skills-popover-menu"
		});
		this.menuEl.addEventListener("toggle", () => {
			if (this.plugin.isRunning) {
				this.menuEl.removeAttribute("open");
				return;
			}
			if (!this.menuEl.open) {
				return;
			}
			this.render(this.plugin.isRunning);
			closeOpenPopoverMenus(this.contentEl, this.menuEl);
			updatePopoverDirection(this.menuEl, this.contentEl, this.transcriptEl() ?? undefined);
		});
		this.triggerEl = this.menuEl.createEl("summary", {
			cls: "quick-skills-toolbar-button quick-skills-toolbar-button-skill",
			attr: {
				"aria-label": "Run skill",
				title: "Run skill"
			}
		});
		this.popoverEl = this.menuEl.createDiv({
			cls: "quick-skills-actions-popover quick-skills-composer-skill-popover"
		});
	}

	get triggerElement(): HTMLElement {
		return this.triggerEl;
	}

	render(blocked: boolean): void {
		this.triggerEl.toggleClass("is-disabled", blocked);
		this.triggerEl.setAttribute("aria-disabled", blocked ? "true" : "false");
		if (blocked) {
			this.menuEl.removeAttribute("open");
		}
		this.popoverEl.empty();
		const applicableSkills = this.plugin.getApplicableSkills();
		if (applicableSkills.length === 0) {
			const emptyState = this.popoverEl.createDiv({
				cls: "quick-skills-actions-empty",
				text: "No skills for this note"
			});
			emptyState.setAttribute("aria-disabled", "true");
			return;
		}
		for (const skill of applicableSkills) {
			const button = this.popoverEl.createEl("button", {
				text: skill.name,
				cls: "quick-skills-actions-item"
			});
			button.addEventListener("click", () => {
				void (async () => {
					await this.plugin.runSkill(skill);
					this.menuEl.removeAttribute("open");
				})();
			});
		}
	}
}
