import { setIcon } from "obsidian";
import type QuickSkillsPlugin from "../../main";
import type { SandboxMode } from "../../types";
import { formatReasoningLabel, formatSandboxModeShortLabel } from "./formatters";
import { DictationController } from "./DictationController";
import { SkillMenuController } from "./SkillMenuController";

export class ComposerController {
	private readonly plugin: QuickSkillsPlugin;
	private readonly inputEl: HTMLTextAreaElement;
	private readonly modelSelectEl: HTMLSelectElement;
	private readonly reasoningSelectEl: HTMLSelectElement;
	private readonly modeSelectEl: HTMLSelectElement;
	private readonly sendButton: HTMLButtonElement;
	private readonly stopButton: HTMLButtonElement;
	private readonly dictationController: DictationController;
	private readonly skillMenuController: SkillMenuController;

	constructor(options: {
		plugin: QuickSkillsPlugin;
		containerEl: HTMLElement;
		contentEl: HTMLElement;
		transcriptEl: () => HTMLElement | null;
	}) {
		this.plugin = options.plugin;

		const composer = options.containerEl.createDiv({ cls: "quick-skills-composer" });
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

		const footer = composer.createDiv({ cls: "quick-skills-composer-toolbar" });
		const actionControls = footer.createDiv({ cls: "quick-skills-toolbar-actions" });
		this.dictationController = new DictationController({
			plugin: this.plugin,
			inputEl: this.inputEl,
			onInputChanged: () => this.autosizeInput(),
			onStateChanged: () => {
				this.renderControls();
				this.renderSkills();
			},
			footerEl: footer,
			actionControlsEl: actionControls
		});

		this.modelSelectEl = this.createCompactSelect(this.dictationController.selectContainerEl, "Model");
		this.modelSelectEl.addEventListener("change", () => {
			void this.plugin.setSelectedModel(this.modelSelectEl.value);
		});

		this.reasoningSelectEl = this.createCompactSelect(this.dictationController.selectContainerEl, "Reasoning");
		this.reasoningSelectEl.addEventListener("change", () => {
			void this.plugin.setSelectedReasoningEffort(this.reasoningSelectEl.value);
		});

		this.modeSelectEl = this.createCompactSelect(this.dictationController.selectContainerEl, "Mode");
		this.modeSelectEl.addEventListener("change", () => {
			void this.plugin.setSandboxMode(this.modeSelectEl.value as SandboxMode);
		});

		this.skillMenuController = new SkillMenuController({
			plugin: this.plugin,
			actionControlsEl: actionControls,
			contentEl: options.contentEl,
			transcriptEl: options.transcriptEl
		});
		setIcon(this.skillMenuController.triggerElement, "sparkles");

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

		this.autosizeInput();
	}

	requestRender(change: "all" | "controls" | "skills"): void {
		if (change === "all" || change === "controls") {
			this.renderControls();
		}
		if (change === "all" || change === "skills" || change === "controls") {
			this.renderSkills();
		}
	}

	async teardown(): Promise<void> {
		await this.dictationController.teardown();
	}

	private renderControls(): void {
		const models = this.plugin.getAvailableModels();
		const selectedModel = this.plugin.settings.selectedModel;
		this.modelSelectEl.empty();
		models.forEach((model) => {
			const option = this.modelSelectEl.createEl("option", { text: model.label });
			option.value = model.id;
			option.selected = model.id === selectedModel;
		});

		const selectedReasoning = this.plugin.settings.selectedReasoningEffort;
		const reasoningLevels = this.plugin.getReasoningOptionsForModel(this.modelSelectEl.value || selectedModel);
		this.reasoningSelectEl.empty();
		reasoningLevels.forEach((effort) => {
			const option = this.reasoningSelectEl.createEl("option", { text: formatReasoningLabel(effort) });
			option.value = effort;
			option.selected = effort === selectedReasoning;
		});

		this.modeSelectEl.empty();
		this.plugin.getAvailableSandboxModes().forEach((mode) => {
			const option = this.modeSelectEl.createEl("option", { text: formatSandboxModeShortLabel(mode) });
			option.value = mode;
			option.selected = mode === this.plugin.settings.sandboxMode;
		});

		const controlsBlocked = this.plugin.isRunning || this.dictationController.isBusy();
		this.sendButton.disabled = controlsBlocked;
		this.sendButton.hidden = this.plugin.isRunning;
		this.stopButton.hidden = !this.plugin.isRunning;
		this.dictationController.render();
	}

	private renderSkills(): void {
		this.skillMenuController.render(this.plugin.isRunning || this.dictationController.isBusy());
	}

	private async sendManualPrompt(): Promise<void> {
		if (this.dictationController.isBusy()) {
			return;
		}
		const prompt = this.inputEl.value.trim();
		if (!prompt) {
			return;
		}
		this.inputEl.value = "";
		this.autosizeInput();
		await this.plugin.runManualPrompt(prompt);
	}

	private createCompactSelect(container: HTMLElement, label: string): HTMLSelectElement {
		const wrapper = container.createDiv({ cls: "quick-skills-toolbar-select-wrap" });
		return wrapper.createEl("select", {
			cls: "quick-skills-toolbar-select",
			attr: {
				"aria-label": label,
				title: label
			}
		});
	}

	private autosizeInput(): void {
		this.inputEl.setCssProps({ "--quick-skills-input-height": "0px" });
		const height = Math.min(Math.max(this.inputEl.scrollHeight, 40), 160);
		this.inputEl.setCssProps({ "--quick-skills-input-height": `${height}px` });
	}
}
