import type { ChatActivity, ChatMessage, ChatTraceItem, SandboxMode } from "../../types";

export function metaLabelForMessage(message: ChatMessage): string {
	if (message.role === "assistant" || message.role === "user" || message.role === "skill") {
		return "";
	}
	return `${message.role}${message.isStreaming ? " - running..." : ""}`;
}

export function getStreamingStatusLabel(items: ChatTraceItem[]): string {
	for (let index = items.length - 1; index >= 0; index -= 1) {
		const item = items[index];
		if (!item) {
			continue;
		}
		if (item.kind === "activity" && item.activity) {
			return item.activity.kind === "todo_list" ? "Updating plan" : "Using tools";
		}
		if (item.kind === "message") {
			return item.isDraft ? "Drafting response" : "Sharing progress";
		}
		if (item.kind === "reasoning") {
			return "Thinking";
		}
	}
	return "Working";
}

export function formatDuration(durationMs: number): string {
	const totalSeconds = Math.max(1, Math.round(durationMs / 1000));
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	if (minutes <= 0) {
		return `${seconds}s`;
	}
	if (seconds === 0) {
		return `${minutes}m`;
	}
	return `${minutes}m ${seconds}s`;
}

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

export function getErrorMessage(error: unknown, fallback: string): string {
	return error instanceof Error && error.message.trim() ? error.message : fallback;
}
