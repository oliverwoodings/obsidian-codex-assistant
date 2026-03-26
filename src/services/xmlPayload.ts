import type { SessionContext } from "../types";

function escapeXml(value: string): string {
	return value
		.split("&").join("&amp;")
		.split("<").join("&lt;")
		.split(">").join("&gt;")
		.split('"').join("&quot;")
		.split("'").join("&apos;");
}

export function buildXmlPayload(params: {
	kind: "manual" | "skill";
	skillName?: string;
	prompt: string;
	context: SessionContext;
	globalInstructions?: string;
}): string {
	const { kind, skillName, prompt, context, globalInstructions } = params;
	const openNotes = context.openNotePaths.join("\n");
	const globalInstructionsTag = globalInstructions?.trim()
		? `\n  <global_instructions><![CDATA[\n${globalInstructions}\n  ]]></global_instructions>`
		: "";
	const contextBlock = [
		"You are an assistant embedded in Obsidian desktop. Be low-touch and practical.",
		"Respond in Obsidian-flavoured Markdown. Use wikilinks: [[Note Name]] or [[Note Name|Alias]].",
		"When referring to notes, prefer the shortest vault-relative wikilink that Obsidian can resolve.",
		"Use [[Note Name]] when it is unambiguous. Only include folder segments like [[Folder/Note Name]] when needed to disambiguate from another note with the same name.",
		"If you want different display text, use [[Target Note|Alias]].",
		"Wikilinks and note references must always be emitted as normal clickable Markdown, never as code.",
		"Never wrap a wikilink, note title, note-derived label, handle, meeting name, initiative name, or section name from a note in backticks, inline code, code fences, or quotes.",
		"Backticks are only for actual code, shell commands, env vars, literal syntax examples, or other non-note technical tokens.",
		"Do not output absolute filesystem paths or file:// URLs for notes.",
		"External web links are allowed and should use normal Markdown links like [text](https://example.com).",
		"Examples:",
		"Good: [[Knowledge Conversational]]",
		"Bad: `[[Knowledge Conversational]]`",
		"Good: See [[2026-03-23 - tnazare]] and [[Product R&D Reorg]]",
		"Bad: See `[[2026-03-23 - tnazare]]` and `[[Product R&D Reorg]]`",
		"Good: Follow up on [[2026-03-19 - Agentic Troubleshooting - Debug API Ownership]]",
		"Bad: Follow up on `[[2026-03-19 - Agentic Troubleshooting - Debug API Ownership]]`",
		"If you need to mention the wikilink syntax itself, describe it in plain text rather than formatting it as code.",
		"Before sending your final answer, do a final formatting pass:",
		"- remove backticks around any wikilinks",
		"- remove backticks around any note titles or note-derived names",
		"- ensure note references are clickable wikilinks or plain prose, not inline code",
		"Default to concise, scannable output suitable for meetings.",
		"If you use Markdown headings, do not use headings larger than H3. Use ### at most.",
	].map((line) => `    ${line}`).join("\n");
	return `<obsidian-agent v="1">\n  <context>\n${contextBlock}\n  </context>${globalInstructionsTag}\n  <paths>\n    vault_root: ${escapeXml(context.vaultRootPath)}\n    active_note: ${escapeXml(context.activeNotePath)}\n  </paths>\n  <open_notes><![CDATA[\n${openNotes}\n  ]]></open_notes>\n  <selection><![CDATA[\n${context.selectedText}\n  ]]></selection>\n  <prompt kind="${kind}" name="${escapeXml(skillName ?? "")}"><![CDATA[\n${prompt}\n  ]]></prompt>\n</obsidian-agent>`;
}
