import { App, Modal, Setting, TextComponent } from "obsidian";

export class SessionRenameModal extends Modal {
	private draftName: string;
	private readonly onSave: (name: string) => Promise<void>;

	constructor(app: App, initialName: string, onSave: (name: string) => Promise<void>) {
		super(app);
		this.draftName = initialName;
		this.onSave = onSave;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h3", { text: "Rename session" });

		let inputComponent: TextComponent | null = null;
		new Setting(contentEl)
			.setName("Session name")
			.addText((text) => {
				inputComponent = text;
				text
					.setPlaceholder("Session name")
					.setValue(this.draftName)
					.onChange((value) => {
						this.draftName = value;
					});
				text.inputEl.addEventListener("keydown", (event: KeyboardEvent) => {
					if (event.key === "Enter") {
						event.preventDefault();
						void this.submit();
					}
				});
			});

		new Setting(contentEl)
			.addButton((button) => button.setButtonText("Save").setCta().onClick(() => {
				void this.submit();
			}))
			.addExtraButton((button) => button.setIcon("cross").setTooltip("Cancel").onClick(() => this.close()));

		window.setTimeout(() => {
			const inputEl = inputComponent?.inputEl;
			inputEl?.focus();
			inputEl?.select();
		}, 0);
	}

	private async submit(): Promise<void> {
		const trimmed = this.draftName.trim();
		if (!trimmed) {
			return;
		}
		await this.onSave(trimmed);
		this.close();
	}
}
