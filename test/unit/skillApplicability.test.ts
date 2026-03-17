import { describe, expect, it } from "vitest";
import { resolveApplicableSkills } from "../../src/services/skillApplicability";
import { buildSkill } from "../helpers/builders";
import { createFile } from "../helpers/fakes";

describe("resolveApplicableSkills", () => {
	it("keeps generic skills available without an active file", () => {
		const generic = buildSkill({ name: "Generic" });
		const folderSkill = buildSkill({
			name: "Folder",
			rules: { folderPrefix: "Projects/" },
		});

		const resolved = resolveApplicableSkills([folderSkill, generic], null, []);

		expect(resolved).toEqual([generic]);
	});

	it("matches folder and tag rules case-insensitively and ranks specific matches first", () => {
		const generic = buildSkill({ name: "Zeta" });
		const folderMatch = buildSkill({
			name: "Folder match",
			rules: { folderPrefix: "Projects/Alpha/" },
		});
		const tagMatch = buildSkill({
			name: "Tag match",
			rules: { frontmatterTags: ["#Meeting"] },
		});
		const noMatch = buildSkill({
			name: "No match",
			rules: { folderPrefix: "Elsewhere/" },
		});

		const resolved = resolveApplicableSkills(
			[generic, noMatch, tagMatch, folderMatch],
			createFile("Projects/Alpha/note.md"),
			["meeting", "team"]
		);

		expect(resolved.map((skill) => skill.name)).toEqual([
			"Folder match",
			"Tag match",
			"Zeta",
		]);
	});

	it("supports tag lists supplied as strings upstream and sorts specific skills by name", () => {
		const alpha = buildSkill({
			name: "Alpha",
			rules: { frontmatterTags: ["Tag"] },
		});
		const beta = buildSkill({
			name: "Beta",
			rules: { frontmatterTags: ["#tag"] },
		});

		const resolved = resolveApplicableSkills(
			[beta, alpha],
			createFile("folder/file.md"),
			["tag"]
		);

		expect(resolved.map((skill) => skill.name)).toEqual(["Alpha", "Beta"]);
	});
});
