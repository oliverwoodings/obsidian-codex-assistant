import type { ThreadEvent, ThreadItem } from "@openai/codex-sdk";
import type { ChatActivity, ChatActivityStatus, ChatTraceItem } from "../types";

const MAX_COMMAND_OUTPUT_CHARS = 1200;

export interface CodexLiveState {
	traceItems: ChatTraceItem[];
}

export interface StreamAccumulatorUpdate {
	sessionId?: string;
	liveState: CodexLiveState;
	liveStateChanged: boolean;
	finalContent: string;
	finalContentChanged: boolean;
}

export class CodexStreamAccumulator {
	private sessionId: string | undefined;
	private readonly itemOrder: string[] = [];
	private readonly itemsById = new Map<string, ThreadItem>();
	private readonly completedAssistantIds = new Set<string>();
	private lastLiveStateKey = "";
	private lastFinalContent = "";

	apply(event: ThreadEvent): StreamAccumulatorUpdate {
		if (event.type === "thread.started") {
			this.sessionId = event.thread_id;
		}
		if (event.type === "item.started" || event.type === "item.updated" || event.type === "item.completed") {
			this.trackItem(event.item);
			if (event.type === "item.completed" && event.item.type === "agent_message") {
				this.completedAssistantIds.add(event.item.id);
			}
		}
		const finalContent = this.buildFinalContent();
		const liveState = this.buildLiveState();
		const liveStateKey = JSON.stringify(liveState);
		const finalContentChanged = finalContent !== this.lastFinalContent;
		const liveStateChanged = liveStateKey !== this.lastLiveStateKey;
		this.lastFinalContent = finalContent;
		this.lastLiveStateKey = liveStateKey;
		return {
			sessionId: this.sessionId,
			liveState,
			liveStateChanged,
			finalContent,
			finalContentChanged
		};
	}

	getResolvedSessionId(): string | undefined {
		return this.sessionId;
	}

	getFinalContent(): string {
		return this.lastFinalContent;
	}

	getLiveState(): CodexLiveState {
		return this.buildLiveState();
	}

	private trackItem(item: ThreadItem): void {
		if (!this.itemsById.has(item.id)) {
			this.itemOrder.push(item.id);
		}
		this.itemsById.set(item.id, item);
	}

	private buildFinalContent(): string {
		for (let index = this.itemOrder.length - 1; index >= 0; index -= 1) {
			const itemId = this.itemOrder[index];
			if (!itemId || !this.completedAssistantIds.has(itemId)) {
				continue;
			}
			const item = this.itemsById.get(itemId);
			if (item?.type !== "agent_message" || !item.text.trim()) {
				continue;
			}
			return item.text;
		}
		return "";
	}

	private buildLiveState(): CodexLiveState {
		const traceItems: ChatTraceItem[] = [];
		const finalAssistantId = this.getFinalAssistantId();

		for (const itemId of this.itemOrder) {
			const item = this.itemsById.get(itemId);
			if (!item) {
				continue;
			}
			if (item.type === "reasoning") {
				const text = item.text.trim();
				if (text) {
					traceItems.push({
						id: item.id,
						kind: "reasoning",
						text: item.text
					});
				}
				continue;
			}
			if (item.type === "agent_message") {
				const text = item.text.trim();
				if (!text) {
					continue;
				}
				if (this.completedAssistantIds.has(itemId) && item.id === finalAssistantId) {
					continue;
				}
				traceItems.push({
					id: item.id,
					kind: "message",
					text: item.text,
					isDraft: !this.completedAssistantIds.has(itemId)
				});
				continue;
			}
			const activity = summarizeProgressItem(item);
			if (activity) {
				traceItems.push({
					id: item.id,
					kind: "activity",
					activity
				});
			}
		}

		return {
			traceItems
		};
	}

	private getFinalAssistantId(): string | null {
		for (let index = this.itemOrder.length - 1; index >= 0; index -= 1) {
			const itemId = this.itemOrder[index];
			if (!itemId || !this.completedAssistantIds.has(itemId)) {
				continue;
			}
			const item = this.itemsById.get(itemId);
			if (item?.type === "agent_message" && item.text.trim()) {
				return item.id;
			}
		}
		return null;
	}
}

function summarizeProgressItem(item: ThreadItem): ChatActivity | null {
	switch (item.type) {
		case "command_execution": {
			const statusLabel = item.status === "failed"
				? `Command failed${typeof item.exit_code === "number" ? ` (${item.exit_code})` : ""}`
				: item.status === "completed"
					? `Command completed${typeof item.exit_code === "number" ? ` (${item.exit_code})` : ""}`
					: "Running command";
			const output = clampTail(item.aggregated_output.trim(), MAX_COMMAND_OUTPUT_CHARS);
			return {
				id: item.id,
				kind: "command_execution",
				status: mapStatus(item.status),
				title: item.command,
				detail: output ? `${statusLabel}\n${output}` : statusLabel
			};
		}
		case "todo_list":
			return {
				id: item.id,
				kind: "todo_list",
				status: "info",
				title: "Plan updated",
				detail: item.items.length > 0
					? item.items.map((entry) => `- [${entry.completed ? "x" : " "}] ${entry.text}`).join("\n")
					: "No plan items."
			};
		case "web_search":
			return {
				id: item.id,
				kind: "web_search",
				status: "running",
				title: "Web search",
				detail: item.query
			};
		case "mcp_tool_call":
			return {
				id: item.id,
				kind: "mcp_tool_call",
				status: mapStatus(item.status),
				title: `${item.server}/${item.tool}`,
				detail: item.error?.message
			};
		case "file_change":
			return {
				id: item.id,
				kind: "file_change",
				status: mapStatus(item.status),
				title: item.status === "failed" ? "Patch failed" : "Files changed",
				detail: item.changes.map((change) => `${change.kind}: ${change.path}`).join("\n") || undefined
			};
		case "error":
			return {
				id: item.id,
				kind: "error",
				status: "failed",
				title: "Item error",
				detail: item.message
			};
		default:
			return null;
	}
}

function clampTail(value: string, maxChars: number): string {
	if (value.length <= maxChars) {
		return value;
	}
	return `...\n${value.slice(-maxChars)}`;
}

function mapStatus(value: string): ChatActivityStatus {
	if (value === "completed") {
		return "completed";
	}
	if (value === "failed") {
		return "failed";
	}
	return "running";
}
