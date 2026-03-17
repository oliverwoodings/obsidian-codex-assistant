import {
	App,
	ButtonComponent,
	DropdownComponent,
	Modal,
	TextAreaComponent,
	TextComponent,
	ToggleComponent
} from "obsidian";
import type { SandboxMode, SkillDefinition } from "../types";
import { createId } from "../utils/id";

export class SkillEditModal extends Modal {
	private draft: SkillDefinition;
	private readonly onSave: (skill: SkillDefinition) => void;
	private readonly reasoningOptions: string[];
	private readonly sandboxModes: SandboxMode[];

	constructor(
		app: App,
		skill: SkillDefinition | null,
		options: {
			reasoningOptions: string[];
			sandboxModes: SandboxMode[];
		},
		onSave: (skill: SkillDefinition) => void
	) {
		super(app);
		this.draft = skill ? {
			...skill,
			rules: {
				...skill.rules,
				frontmatterTags: skill.rules?.frontmatterTags ? [...skill.rules.frontmatterTags] : undefined
			}
		} : {
			id: createId("skill"),
			name: "",
			prompt: "",
			rules: {}
		};
		this.reasoningOptions = options.reasoningOptions;
		this.sandboxModes = options.sandboxModes;
		this.onSave = onSave;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		this.modalEl.addClass("codex-assistant-skill-modal-shell");
		contentEl.addClass("codex-assistant-skill-modal");
		contentEl.createEl("h3", { text: this.draft.name ? "Edit skill" : "Create skill" });

		let nameInput: TextComponent | null = null;
		let promptInput: TextAreaComponent | null = null;

		const nameSection = contentEl.createDiv({ cls: "codex-assistant-skill-editor-section" });
		nameSection.createEl("label", {
			cls: "codex-assistant-skill-editor-label",
			text: "Name"
		});
		nameSection.createEl("p", {
			cls: "codex-assistant-skill-editor-help",
			text: "Short label shown in the skill picker."
		});
		nameInput = new TextComponent(nameSection);
		nameInput.inputEl.addClass("codex-assistant-skill-text-input");
		nameInput
			.setPlaceholder("Summarize this note")
			.setValue(this.draft.name)
			.onChange((value) => {
				this.draft.name = value;
			});

		const promptSection = contentEl.createDiv({ cls: "codex-assistant-skill-editor-section" });
		promptSection.createEl("label", {
			cls: "codex-assistant-skill-editor-label",
			text: "Prompt"
		});
		promptSection.createEl("p", {
			cls: "codex-assistant-skill-editor-help",
			text: "This text is sent exactly as written when you run the skill."
		});
			promptInput = new TextAreaComponent(promptSection);
			promptInput.inputEl.addClass("codex-assistant-skill-prompt-input");
			promptInput
				.setPlaceholder("Prompt")
				.setValue(this.draft.prompt)
				.onChange((value) => {
					this.draft.prompt = value;
				});
		promptInput.inputEl.rows = 12;

		const rulesSection = contentEl.createDiv({ cls: "codex-assistant-skill-editor-section" });
		rulesSection.createEl("label", {
			cls: "codex-assistant-skill-editor-label",
			text: "Availability"
		});
		rulesSection.createEl("p", {
			cls: "codex-assistant-skill-editor-help",
			text: "Optional note filters."
		});

		let tagEnabled = (this.draft.rules?.frontmatterTags?.length ?? 0) > 0;
		let tagInput: TextComponent | null = null;
		const tagRule = this.createRuleRow(
			rulesSection,
			"Tag",
			"Match any listed tag, for example `1-1, project-x, people`",
			tagEnabled,
			"1-1, project-x",
			this.formatTagRuleValue(),
			(value) => {
				tagEnabled = value;
				if (!value) {
					this.draft.rules = { ...this.draft.rules, frontmatterTags: undefined };
					return;
				}
				this.draft.rules = {
					...this.draft.rules,
					frontmatterTags: this.parseTagRuleValue(tagInput?.getValue() ?? "")
				};
			},
			(value) => {
				this.draft.rules = {
					...this.draft.rules,
					frontmatterTags: this.parseTagRuleValue(value)
				};
			}
		);
		tagInput = tagRule.input;

		let folderEnabled = Boolean(this.draft.rules?.folderPrefix?.trim());
		let folderInput: TextComponent | null = null;
		const folderRule = this.createRuleRow(
			rulesSection,
			"Folder",
			"Only show inside a folder like `20 - Meetings/`",
			folderEnabled,
			"e.g. People/",
			this.draft.rules?.folderPrefix ?? "",
			(value) => {
				folderEnabled = value;
				if (!value) {
					this.draft.rules = { ...this.draft.rules, folderPrefix: undefined };
					return;
				}
				this.draft.rules = {
					...this.draft.rules,
					folderPrefix: folderInput?.getValue().trim() || ""
				};
			},
			(value) => {
				this.draft.rules = {
					...this.draft.rules,
					folderPrefix: value
				};
			}
		);
		folderInput = folderRule.input;

		const executionSection = contentEl.createDiv({ cls: "codex-assistant-skill-editor-section" });
		executionSection.createEl("label", {
			cls: "codex-assistant-skill-editor-label",
			text: "Execution"
		});
		executionSection.createEl("p", {
			cls: "codex-assistant-skill-editor-help",
			text: "Optional overrides. Leave unset to inherit the sidebar."
		});

		this.createSelectRow(
			executionSection,
			"Reasoning",
			"Use conversation setting",
			this.draft.reasoningEffort ?? "",
			[
				{ value: "", label: "Use conversation setting" },
				...this.getReasoningSelectOptions().map((effort) => ({
					value: effort,
					label: this.formatReasoningLabel(effort)
				}))
			],
			(value) => {
				this.draft.reasoningEffort = value || undefined;
			}
		);

		this.createSelectRow(
			executionSection,
			"Sandbox",
			"Use conversation setting",
			this.draft.sandboxMode ?? "",
			[
				{ value: "", label: "Use conversation setting" },
				...this.sandboxModes.map((mode) => ({
					value: mode,
					label: this.formatSandboxModeLabel(mode)
				}))
			],
			(value) => {
				this.draft.sandboxMode = value ? value as SandboxMode : undefined;
			}
		);

		const footer = contentEl.createDiv({ cls: "codex-assistant-skill-modal-footer" });
		const cancelButton = new ButtonComponent(footer);
		cancelButton.setButtonText("Cancel").onClick(() => this.close());
		const saveButton = new ButtonComponent(footer);
		saveButton.setButtonText("Save").setCta().onClick(() => {
			this.submit();
		});

		window.setTimeout(() => {
			if (!this.draft.name.trim()) {
				nameInput?.inputEl.focus();
				return;
			}
			promptInput?.inputEl.focus();
		}, 0);
	}

	onClose(): void {
		this.modalEl.removeClass("codex-assistant-skill-modal-shell");
	}

	private createRuleRow(
		container: HTMLElement,
		title: string,
		description: string,
		enabled: boolean,
		placeholder: string,
		value: string,
		onToggle: (enabled: boolean) => void,
		onInput: (value: string) => void
	): { input: TextComponent; toggle: ToggleComponent } {
		const row = container.createDiv({ cls: "codex-assistant-skill-compact-row" });
		const copy = row.createDiv({ cls: "codex-assistant-skill-compact-copy" });
		copy.createEl("div", { cls: "codex-assistant-skill-compact-title", text: title });
		copy.createEl("div", { cls: "codex-assistant-skill-compact-hint", text: description });
		const controls = row.createDiv({ cls: "codex-assistant-skill-compact-controls codex-assistant-skill-compact-controls-rule" });
		const toggleWrap = controls.createDiv({ cls: "codex-assistant-skill-rule-toggle" });
		const toggle = new ToggleComponent(toggleWrap);
		toggle.setValue(enabled).onChange((nextValue) => {
			onToggle(nextValue);
			input.setDisabled(!nextValue);
			row.toggleClass("is-disabled", !nextValue);
		});

		const input = new TextComponent(controls);
		input.inputEl.addClass("codex-assistant-skill-text-input");
		input.inputEl.addClass("codex-assistant-skill-compact-input");
		input
			.setPlaceholder(placeholder)
			.setValue(value)
			.setDisabled(!enabled)
			.onChange((nextValue) => {
				onInput(nextValue);
			});
		row.toggleClass("is-disabled", !enabled);
		return { input, toggle };
	}

	private createSelectRow(
		container: HTMLElement,
		title: string,
		description: string,
		value: string,
		options: Array<{ value: string; label: string }>,
		onChange: (value: string) => void
	): DropdownComponent {
		const row = container.createDiv({ cls: "codex-assistant-skill-compact-row" });
		const copy = row.createDiv({ cls: "codex-assistant-skill-compact-copy" });
		copy.createEl("div", { cls: "codex-assistant-skill-compact-title", text: title });
		copy.createEl("div", { cls: "codex-assistant-skill-compact-hint", text: description });
		const selectWrap = row.createDiv({ cls: "codex-assistant-skill-compact-controls" });
		const select = new DropdownComponent(selectWrap);
		select.selectEl.addClass("codex-assistant-skill-select");
		for (const option of options) {
			select.addOption(option.value, option.label);
		}
		select.setValue(value).onChange(onChange);
		return select;
	}

	private formatReasoningLabel(value: string): string {
		return value
			.split(/[-_\s]+/)
			.filter((part) => part.length > 0)
			.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
			.join(" ");
	}

	private getReasoningSelectOptions(): string[] {
		const options = new Set(this.reasoningOptions);
		const savedOverride = this.draft.reasoningEffort?.trim();
		if (savedOverride) {
			options.add(savedOverride);
		}
		return [...options];
	}

	private formatSandboxModeLabel(mode: SandboxMode): string {
		if (mode === "read-only") {
			return "Read-only";
		}
		if (mode === "workspace-write") {
			return "Workspace write";
		}
		return "Danger full access";
	}

	private submit(): void {
		const name = this.draft.name.trim();
		const prompt = this.draft.prompt.trim();
		if (!name || !prompt) {
			return;
		}
		const frontmatterTags = (this.draft.rules?.frontmatterTags ?? [])
			.map((tag) => tag.trim())
			.filter((tag, index, values) => tag.length > 0 && values.indexOf(tag) === index);
		const folderPrefix = this.draft.rules?.folderPrefix?.trim();
		const rules = {
			frontmatterTags: frontmatterTags.length > 0 ? frontmatterTags : undefined,
			folderPrefix: folderPrefix || undefined
		};
		this.onSave({
			id: this.draft.id,
			name,
			prompt,
			reasoningEffort: this.draft.reasoningEffort?.trim() || undefined,
			sandboxMode: this.draft.sandboxMode,
			rules
		});
		this.close();
	}

	private formatTagRuleValue(): string {
		return (this.draft.rules?.frontmatterTags ?? []).join(", ");
	}

	private parseTagRuleValue(value: string): string[] {
		const normalized: string[] = [];
		for (const segment of value.split(",")) {
			const tag = segment.replace(/^#/, "").trim();
			if (!tag || normalized.some((candidate) => candidate.toLowerCase() === tag.toLowerCase())) {
				continue;
			}
			normalized.push(tag);
		}
		return normalized;
	}
}
