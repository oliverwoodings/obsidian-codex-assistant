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
}): string {
	const { kind, skillName, prompt, context } = params;
	const openNotes = context.openNotePaths.join("\n");
	return `<obsidian-agent v="1">\n  <context>\n    You are an assistant embedded in Obsidian desktop. Be low-touch and practical.\n    Respond in Obsidian-flavoured Markdown. Use wikilinks: [[Note Name]] or [[Note Name|Alias]].\n    Do not wrap Obsidian wikilinks in backticks or inline code spans. Write [[Note Name]], not \`[[Note Name]]\`, including in headings and lists.\n    Default to concise, scannable output suitable for meetings.\n    If you use Markdown headings, do not use headings larger than H3. Use ### at most.\n  </context>\n  <paths>\n    vault_root: ${escapeXml(context.vaultRootPath)}\n    active_note: ${escapeXml(context.activeNotePath)}\n  </paths>\n  <open_notes><![CDATA[\n${openNotes}\n  ]]></open_notes>\n  <selection><![CDATA[\n${context.selectedText}\n  ]]></selection>\n  <prompt kind="${kind}" name="${escapeXml(skillName ?? "")}"><![CDATA[\n${prompt}\n  ]]></prompt>\n</obsidian-agent>`;
}
