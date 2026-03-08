import { App, FuzzySuggestModal } from "obsidian";
import type { SkillDefinition } from "../types";

export class SkillPickerModal extends FuzzySuggestModal<SkillDefinition> {
	private readonly skills: SkillDefinition[];
	private readonly onChoose: (skill: SkillDefinition) => void;

	constructor(app: App, skills: SkillDefinition[], onChoose: (skill: SkillDefinition) => void) {
		super(app);
		this.skills = skills;
		this.onChoose = onChoose;
		this.setPlaceholder("Select a skill");
	}

	getItems(): SkillDefinition[] {
		return this.skills;
	}

	getItemText(item: SkillDefinition): string {
		return item.name;
	}

	onChooseItem(item: SkillDefinition): void {
		this.onChoose(item);
	}
}
