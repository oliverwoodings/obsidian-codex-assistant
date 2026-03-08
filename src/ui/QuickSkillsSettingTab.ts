import { App, PluginSettingTab, Setting } from "obsidian";
import type QuickSkillsPlugin from "../main";
import type { SkillDefinition } from "../types";
import { SkillEditModal } from "./SkillEditModal";
import { renderExecutionLog } from "./executionLog";

export class QuickSkillsSettingTab extends PluginSettingTab {
	private readonly plugin: QuickSkillsPlugin;
	private executionLogContainerEl: HTMLElement | null = null;
	private executionLogCountSetting: Setting | null = null;
	private readonly expandedExecutionLogIds = new Set<string>();
	private logRefreshTimeoutId: number | null = null;

	constructor(app: App, plugin: QuickSkillsPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	hide(): void {
		if (this.logRefreshTimeoutId !== null) {
			window.clearTimeout(this.logRefreshTimeoutId);
			this.logRefreshTimeoutId = null;
		}
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		new Setting(containerEl).setName("Skill manager").setHeading();

		new Setting(containerEl)
			.setName("Codex executable path")
			.setDesc("Executable used by the Codex SDK for sessions and streaming runs. Use an absolute path if Obsidian cannot resolve `codex`.")
			.addText((text) => text
				.setValue(this.plugin.settings.codexBinaryPath)
				.onChange(async (value) => {
					this.plugin.settings.codexBinaryPath = value.trim() || "codex";
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName("Create skill")
			.setDesc("Add a reusable prompt")
			.addButton((button) => button.setButtonText("New skill").setCta().onClick(() => {
				new SkillEditModal(this.app, null, this.getSkillEditorOptions(), (skill) => {
					void (async () => {
						this.plugin.settings.skills.push(skill);
						await this.plugin.saveSettings();
						this.display();
					})();
				}).open();
			}));

		this.plugin.settings.skills.forEach((skill, index) => {
			this.renderSkillRow(containerEl, skill, index);
		});

		new Setting(containerEl)
			.setName("Execution log")
			.setHeading();

		this.executionLogCountSetting = new Setting(containerEl)
			.setName("Log entries")
			.setDesc(`${this.plugin.settings.executionLog.length} saved.`)
			.addButton((button) => button
				.setButtonText("Clear log")
				.onClick(async () => {
					this.plugin.settings.executionLog = [];
					this.expandedExecutionLogIds.clear();
					await this.plugin.saveSettings();
					this.refreshExecutionLogSection();
				}));

		this.executionLogContainerEl = containerEl.createDiv({ cls: "quick-skills-execution-log-section" });
		this.pruneExpandedExecutionLogIds();
		renderExecutionLog(
			this.executionLogContainerEl,
			this.plugin.settings.executionLog,
			this.expandedExecutionLogIds,
			async (id) => this.stopExecutionLogRun(id)
		);
	}

	notifyExecutionLogUpdated(): void {
		if (!this.containerEl.isConnected) {
			return;
		}
		if (this.logRefreshTimeoutId !== null) {
			return;
		}

		this.logRefreshTimeoutId = window.setTimeout(() => {
			this.logRefreshTimeoutId = null;
			this.refreshExecutionLogSection();
		}, 200);
	}

	private refreshExecutionLogSection(): void {
		if (!this.containerEl.isConnected) {
			return;
		}
		this.executionLogCountSetting?.setDesc(`${this.plugin.settings.executionLog.length} saved.`);
		if (!this.executionLogContainerEl) {
			return;
		}
		this.executionLogContainerEl.empty();
		this.pruneExpandedExecutionLogIds();
		renderExecutionLog(
			this.executionLogContainerEl,
			this.plugin.settings.executionLog,
			this.expandedExecutionLogIds,
			async (id) => this.stopExecutionLogRun(id)
		);
	}

	private async stopExecutionLogRun(id: string): Promise<void> {
		this.plugin.cancelExecutionLogRun(id);
		this.refreshExecutionLogSection();
	}

	private pruneExpandedExecutionLogIds(): void {
		const currentIds = new Set(this.plugin.settings.executionLog.map((entry) => entry.id));
		for (const id of this.expandedExecutionLogIds) {
			if (!currentIds.has(id)) {
				this.expandedExecutionLogIds.delete(id);
			}
		}
	}

	private renderSkillRow(containerEl: HTMLElement, skill: SkillDefinition, index: number): void {
		new Setting(containerEl)
			.setName(skill.name)
			.setDesc(this.describeSkill(skill))
			.addExtraButton((button) => button.setIcon("up-chevron-glyph").setTooltip("Move up").onClick(async () => {
				if (index === 0) {
					return;
				}
				this.swapSkills(index, index - 1);
				await this.plugin.saveSettings();
				this.display();
			}))
			.addExtraButton((button) => button.setIcon("down-chevron-glyph").setTooltip("Move down").onClick(async () => {
				if (index >= this.plugin.settings.skills.length - 1) {
					return;
				}
				this.swapSkills(index, index + 1);
				await this.plugin.saveSettings();
				this.display();
			}))
			.addButton((button) => button.setButtonText("Edit").onClick(() => {
				new SkillEditModal(this.app, skill, this.getSkillEditorOptions(), (updatedSkill) => {
					void (async () => {
						this.plugin.settings.skills[index] = updatedSkill;
						await this.plugin.saveSettings();
						this.display();
					})();
				}).open();
			}))
			.addButton((button) => button.setWarning().setButtonText("Delete").onClick(async () => {
				this.plugin.settings.skills.splice(index, 1);
				await this.plugin.saveSettings();
				this.display();
			}));
	}

	private describeSkill(skill: SkillDefinition): string {
		const prompt = skill.prompt.trim();
		const promptSummary = prompt.length > 96 ? `${prompt.slice(0, 93).trimEnd()}...` : prompt;
		const scopeParts = [
			skill.reasoningEffort?.trim() ? `Reasoning: ${this.formatReasoningLabel(skill.reasoningEffort.trim())}` : "",
			skill.sandboxMode ? `Mode: ${this.formatSandboxModeLabel(skill.sandboxMode)}` : "",
			skill.rules?.frontmatterTags?.length ? `Tags: ${skill.rules.frontmatterTags.join(", ")}` : "",
			skill.rules?.folderPrefix?.trim() ? `Folder: ${skill.rules.folderPrefix.trim()}` : ""
		].filter((value) => value.length > 0);
		return scopeParts.length > 0 ? `${promptSummary} · ${scopeParts.join(" · ")}` : promptSummary;
	}

	private getSkillEditorOptions(): { reasoningOptions: string[]; sandboxModes: ReturnType<QuickSkillsPlugin["getAvailableSandboxModes"]> } {
		return {
			reasoningOptions: this.plugin.getReasoningOptionsForModel(this.plugin.settings.selectedModel),
			sandboxModes: this.plugin.getAvailableSandboxModes()
		};
	}

	private formatSandboxModeLabel(mode: SkillDefinition["sandboxMode"]): string {
		if (mode === "read-only") {
			return "Read-only";
		}
		if (mode === "workspace-write") {
			return "Workspace write";
		}
		return "Danger full access";
	}

	private formatReasoningLabel(value: string): string {
		return value
			.split(/[-_\s]+/)
			.filter((part) => part.length > 0)
			.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
			.join(" ");
	}

	private swapSkills(a: number, b: number): void {
		const first = this.plugin.settings.skills[a];
		const second = this.plugin.settings.skills[b];
		if (!first || !second) {
			return;
		}
		this.plugin.settings.skills[a] = second;
		this.plugin.settings.skills[b] = first;
	}
}
