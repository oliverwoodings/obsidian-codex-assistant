import { CodexStreamAccumulator } from "../../codex/streamAccumulator";
import type { ChatMessage, ChatTraceItem } from "../../types";

export interface ExecutionLogLookup {
	rawEvents: Array<{ payload: unknown }>;
	durationMs: number;
}

export interface TraceLookupPlugin {
	getExecutionLogForAssistantMessage(message: ChatMessage): ExecutionLogLookup | undefined;
}

export function getExecutionLogTrace(
	plugin: TraceLookupPlugin,
	message: ChatMessage
): { items: ChatTraceItem[]; durationMs?: number } | null {
	if (message.role !== "assistant" || message.isStreaming) {
		return null;
	}
	const executionLog = plugin.getExecutionLogForAssistantMessage(message);
	if (!executionLog || executionLog.rawEvents.length === 0) {
		return null;
	}
	const accumulator = new CodexStreamAccumulator();
	for (const rawEvent of executionLog.rawEvents) {
		const payload = rawEvent.payload;
		if (!payload || typeof payload !== "object" || typeof (payload as { type?: unknown }).type !== "string") {
			continue;
		}
		accumulator.apply(payload as never);
	}
	const items = accumulator.getLiveState().traceItems;
	if (items.length === 0) {
		return null;
	}
	return {
		items,
		durationMs: Number.isFinite(executionLog.durationMs) ? executionLog.durationMs : message.turnTrace?.durationMs
	};
}

export function getStoredTurnTrace(
	plugin: TraceLookupPlugin,
	message: ChatMessage
): { items: ChatTraceItem[]; durationMs?: number } {
	const logTrace = getExecutionLogTrace(plugin, message);
	if (logTrace) {
		return logTrace;
	}

	const storedItems = (message.turnTrace?.items ?? [])
		.map((item) => ({
			id: item.id,
			kind: item.kind,
			text: item.text,
			activity: item.activity ? { ...item.activity } : undefined,
			isDraft: item.isDraft
		}))
		.filter((item) => !!item.activity || !!item.text?.trim());
	if (storedItems.length > 0) {
		return { items: storedItems, durationMs: message.turnTrace?.durationMs };
	}

	const items: ChatTraceItem[] = [];
	const reasoningText = message.turnTrace?.reasoningText?.trim() || message.reasoningTrace?.trim() || undefined;
	if (reasoningText) {
		items.push({ id: `${message.id}-reasoning`, kind: "reasoning", text: reasoningText });
	}
	for (const activity of message.turnTrace?.activities ?? []) {
		items.push({ id: activity.id, kind: "activity", activity });
	}
	for (const entry of (message.turnTrace?.completedMessages ?? []).slice(0, -1)) {
		if (!entry.trim()) {
			continue;
		}
		items.push({
			id: `${message.id}-message-${items.length}`,
			kind: "message",
			text: entry
		});
	}
	return { items, durationMs: message.turnTrace?.durationMs };
}

export function hasStoredTurnTrace(plugin: TraceLookupPlugin, message: ChatMessage): boolean {
	return getStoredTurnTrace(plugin, message).items.length > 0;
}
