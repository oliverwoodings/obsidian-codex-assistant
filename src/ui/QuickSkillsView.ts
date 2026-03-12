import { ItemView, type WorkspaceLeaf } from "obsidian";
import type QuickSkillsPlugin from "../main";
import type { AppViewUpdate } from "../state/uiChange";
import { closeOpenPopoverMenus } from "./sidebar/popover";
import { ComposerController } from "./sidebar/ComposerController";
import { SessionHeaderController } from "./sidebar/SessionHeaderController";
import { TranscriptPane } from "./sidebar/TranscriptPane";

export const QUICK_SKILLS_VIEW_TYPE = "quick-skills-sidebar";

export class QuickSkillsView extends ItemView {
	private readonly plugin: QuickSkillsPlugin;
	private sessionHeader!: SessionHeaderController;
	private transcriptPane!: TranscriptPane;
	private composer!: ComposerController;

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
			closeOpenPopoverMenus(contentEl);
		});

		this.sessionHeader = new SessionHeaderController({
			plugin: this.plugin,
			rootEl: contentEl,
			contentEl,
			transcriptEl: () => this.transcriptPane?.element ?? null
		});
		this.transcriptPane = new TranscriptPane({
			plugin: this.plugin,
			host: this,
			containerEl: contentEl
		});
		this.composer = new ComposerController({
			plugin: this.plugin,
			containerEl: contentEl,
			contentEl,
			transcriptEl: () => this.transcriptPane.element
		});
		this.requestRender("all");
	}

	async onClose(): Promise<void> {
		await this.composer?.teardown();
	}

	requestRender(change: AppViewUpdate): void {
		if (change === "all" || change === "sessions") {
			this.sessionHeader.render(this.plugin.sessions, this.plugin.activeSessionId);
		}
		if (change === "all" || change === "transcript") {
			this.transcriptPane.requestRender();
		}
		if (change === "all" || change === "controls" || change === "skills") {
			this.composer.requestRender(change === "all" ? "all" : change);
		}
	}
}
