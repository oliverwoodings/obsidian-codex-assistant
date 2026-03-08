import type { TFile } from "obsidian";
import type { SkillDefinition } from "../types";

export interface SkillWithRank {
	skill: SkillDefinition;
	isSpecific: boolean;
}

export function resolveApplicableSkills(
	skills: SkillDefinition[],
	activeFile: TFile | null,
	frontmatterTags: string[]
): SkillDefinition[] {
	const ranked = skills
		.map((skill) => ({
			skill,
			isSpecific: hasRules(skill) && matchesRules(skill, activeFile, frontmatterTags)
		}))
		.filter((entry) => !hasRules(entry.skill) || entry.isSpecific);

	return ranked.sort((a, b) => {
		if (a.isSpecific !== b.isSpecific) {
			return a.isSpecific ? -1 : 1;
		}
		return a.skill.name.localeCompare(b.skill.name);
	}).map((entry) => entry.skill);
}

function hasRules(skill: SkillDefinition): boolean {
	return Boolean(skill.rules?.folderPrefix?.trim() || (skill.rules?.frontmatterTags?.length ?? 0) > 0);
}

function matchesRules(skill: SkillDefinition, file: TFile | null, tags: string[]): boolean {
	const folderRule = skill.rules?.folderPrefix?.trim();
	const tagRules = (skill.rules?.frontmatterTags ?? []).map((tag) => normalizeTag(tag)).filter((tag) => tag.length > 0);
	const filePath = file?.path ?? "";
	const fileFolder = filePath.includes("/") ? filePath.slice(0, filePath.lastIndexOf("/") + 1) : "";

	const folderMatch = !folderRule || fileFolder.startsWith(folderRule);
	const tagMatch = tagRules.length === 0 || tags.some((tag) => tagRules.includes(normalizeTag(tag)));

	return folderMatch && tagMatch;
}

function normalizeTag(tag: string): string {
	return tag.replace(/^#/, "").trim().toLowerCase();
}
