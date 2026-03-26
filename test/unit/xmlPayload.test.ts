import { describe, expect, it } from "vitest";
import { buildXmlPayload } from "../../src/services/xmlPayload";

describe("buildXmlPayload", () => {
	it("builds a manual prompt payload and omits global instructions when blank", () => {
		const payload = buildXmlPayload({
			kind: "manual",
			prompt: "Summarize",
			globalInstructions: "   ",
			context: {
				vaultRootPath: "/vault",
				activeFilePath: "Notes/Today.md",
				activeNotePath: "Notes/Today.md",
				openNotePaths: ["Notes/Today.md", "Notes/Other.md"],
				selectedText: "Selected",
			},
		});

		expect(payload).toContain('<prompt kind="manual" name=""><![CDATA[');
		expect(payload).toContain("Notes/Today.md\nNotes/Other.md");
		expect(payload).toContain("prefer the shortest vault-relative wikilink");
		expect(payload).toContain("Wikilinks and note references must always be emitted as normal clickable Markdown");
		expect(payload).toContain("Bad: `[[Knowledge Conversational]]`");
		expect(payload).toContain("Before sending your final answer, do a final formatting pass:");
		expect(payload).not.toContain("<global_instructions>");
	});

	it("includes skill name, escapes XML attributes, and preserves CDATA bodies", () => {
		const payload = buildXmlPayload({
			kind: "skill",
			skillName: "Review <plan> & triage",
			prompt: "Use <xml> safely & keep [[links]]",
			globalInstructions: "Always be concise",
			context: {
				vaultRootPath: "/vault & stuff",
				activeFilePath: "",
				activeNotePath: "Notes/<Today>.md",
				openNotePaths: [],
				selectedText: "<selection>",
			},
		});

		expect(payload).toContain('name="Review &lt;plan&gt; &amp; triage"');
		expect(payload).toContain("active_note: Notes/&lt;Today&gt;.md");
		expect(payload).toContain("<![CDATA[\nUse <xml> safely & keep [[links]]\n  ]]>");
		expect(payload.match(/<global_instructions>/gu)).toHaveLength(1);
	});
});
