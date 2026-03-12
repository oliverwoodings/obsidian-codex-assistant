import type { ChatActivity, SandboxMode } from "../../types";

export function formatReasoningLabel(value: string): string {
	if (value === "xhigh") {
		return "X-high";
	}
	return value
		.split(/[-_\s]+/)
		.filter((part) => part.length > 0)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(" ");
}

export function formatSandboxModeShortLabel(mode: SandboxMode): string {
	if (mode === "read-only") {
		return "Read";
	}
	if (mode === "workspace-write") {
		return "Write";
	}
	return "Danger";
}

export function summarizeNotePath(path: string): string {
	const trimmed = path.trim();
	if (!trimmed) {
		return "";
	}
	const segments = trimmed.split("/").filter((segment) => segment.length > 0);
	if (segments.length === 0) {
		return trimmed;
	}
	const fileName = segments[segments.length - 1] ?? trimmed;
	return fileName.endsWith(".md") ? fileName.slice(0, -3) : fileName;
}

export function iconForActivity(kind: ChatActivity["kind"]): string {
	switch (kind) {
		case "command_execution":
			return "terminal";
		case "todo_list":
			return "list-todo";
		case "web_search":
			return "search";
		case "mcp_tool_call":
			return "plug";
		case "file_change":
			return "file-pen";
		case "error":
			return "alert-triangle";
		default:
			return "dot";
	}
}

export function labelForActivityStatus(status: ChatActivity["status"]): string {
	if (status === "completed") {
		return "Done";
	}
	if (status === "failed") {
		return "Failed";
	}
	if (status === "info") {
		return "Updated";
	}
	return "Running";
}
