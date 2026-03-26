import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type CodexAssistantPlugin from "../main";
import type { SkillDefinition } from "../types";
import { SkillEditModal } from "./SkillEditModal";
import { renderExecutionLog } from "./executionLog";

export class CodexAssistantSettingTab extends PluginSettingTab {
	private readonly plugin: CodexAssistantPlugin;
	private executionLogContainerEl: HTMLElement | null = null;
	private executionLogCountSetting: Setting | null = null;
	private readonly expandedExecutionLogIds = new Set<string>();
	private logRefreshTimeoutId: number | null = null;

	constructor(app: App, plugin: CodexAssistantPlugin) {
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

		const extraPathSetting = new Setting(containerEl)
			.setName("Extra PATH entries")
			.setDesc("Optional absolute paths to prepend to PATH for Codex runs. Add one directory per line so GUI-launched Obsidian can find tools like node.")
			.addTextArea((text) => {
				text
					.setPlaceholder("/opt/homebrew/bin")
					.setValue(this.plugin.settings.extraPathEntries.join("\n"))
					.onChange(async (value) => {
						this.plugin.settings.extraPathEntries = value
							.split(/\r?\n/u)
							.map((entry) => entry.trim())
							.filter((entry, index, entries) => entry.length > 0 && entries.indexOf(entry) === index);
						await this.plugin.saveSettings();
					});
				text.inputEl.addClass("codex-assistant-settings-textarea");
				text.inputEl.rows = 4;
				text.inputEl.setCssProps({ width: "100%" });
			});
		extraPathSetting.settingEl.addClass("codex-assistant-setting-item-full-width");

		new Setting(containerEl)
			.setName("Model catalog")
			.setDesc(`Available models are loaded from the local Codex cache at \`~/.codex/models_cache.json\` and defaults from \`~/.codex/config.toml\`. The plugin reads that cache on load, so if the Codex app has newer models, refresh here. Currently loaded: ${this.plugin.getAvailableModels().length} model${this.plugin.getAvailableModels().length === 1 ? "" : "s"}.`)
			.addButton((button) => button
				.setButtonText("Refresh model cache")
				.onClick(async () => {
					button.setDisabled(true);
					button.setButtonText("Refreshing...");
					try {
						await this.plugin.refreshAvailableModels();
						new Notice("Model cache refreshed.");
						this.display();
					} finally {
						button.setDisabled(false);
						button.setButtonText("Refresh model cache");
					}
				}));

		const globalInstructionsSetting = new Setting(containerEl)
			.setName("Global instructions")
			.setDesc("Optional instructions applied to every prompt and skill run.")
			.addTextArea((text) => {
				text
					.setPlaceholder("Add instructions that should apply to all runs")
					.setValue(this.plugin.settings.globalInstructions)
					.onChange(async (value) => {
						this.plugin.settings.globalInstructions = value;
						await this.plugin.saveSettings();
					});
				text.inputEl.addClass("codex-assistant-settings-textarea");
				text.inputEl.rows = 6;
				text.inputEl.setCssProps({ width: "100%" });
			});
		globalInstructionsSetting.settingEl.addClass("codex-assistant-setting-item-full-width");

		new Setting(containerEl)
			.setName("Voice dictation")
			.setHeading();

		new Setting(containerEl)
			.setName("Whisper base URL")
			.setDesc("Shared local whisper.cpp runtime URL used for one-shot dictation.")
			.addText((text) => text
				.setPlaceholder("http://127.0.0.1:8080")
				.setValue(this.plugin.settings.whisperBaseUrl)
				.onChange(async (value) => {
					this.plugin.settings.whisperBaseUrl = value.trim() || "http://127.0.0.1:8080";
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName("Whisper language")
			.setDesc("Optional language hint for dictation, for example `en`. Leave blank to auto-detect.")
			.addText((text) => text
				.setPlaceholder("Optional, for example: en")
				.setValue(this.plugin.settings.whisperLanguage)
				.onChange(async (value) => {
					this.plugin.settings.whisperLanguage = value.trim();
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName("Dictation timeout (ms)")
			.setDesc("Timeout for the final whisper transcription request after recording stops.")
			.addText((text) => text
				.setPlaceholder("90000")
				.setValue(String(this.plugin.settings.whisperRequestTimeoutMs))
				.onChange(async (value) => {
					const parsed = Number.parseInt(value.trim(), 10);
					this.plugin.settings.whisperRequestTimeoutMs = Number.isFinite(parsed) ? parsed : 90_000;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName("Skills")
			.setHeading();

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

		this.executionLogContainerEl = containerEl.createDiv({ cls: "codex-assistant-execution-log-section" });
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

	private getSkillEditorOptions(): { reasoningOptions: string[]; sandboxModes: ReturnType<CodexAssistantPlugin["getAvailableSandboxModes"]> } {
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
