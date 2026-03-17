import { describe, expect, it } from "vitest";
import { buildExecutionLogEntry, buildMessage } from "../helpers/builders";
import { getExecutionLogTrace, getStoredTurnTrace, hasStoredTurnTrace } from "../../src/ui/sidebar/traceHelpers";

describe("traceHelpers", () => {
	it("rebuilds stored traces from execution log raw events for completed assistant messages", () => {
		const message = buildMessage({
			role: "assistant",
			content: "Final answer",
			executionLogId: "run-1",
		});
		const plugin = {
			getExecutionLogForAssistantMessage() {
				return buildExecutionLogEntry({
					id: "run-1",
					rawEvents: [
						{
							timestamp: 1,
							type: "thread.started",
							payload: { type: "thread.started", thread_id: "session-1" },
						},
						{
							timestamp: 2,
							type: "item.started",
							payload: { type: "item.started", item: { id: "reason-1", type: "reasoning", text: "Thinking" } },
						},
					],
					durationMs: 2_000,
				});
			},
		};

		expect(getExecutionLogTrace(plugin, message)).toEqual({
			items: [{ id: "reason-1", kind: "reasoning", text: "Thinking" }],
			durationMs: 2_000,
		});
	});

	it("falls back to stored turn trace and legacy reasoning/activity fields", () => {
		const fromItems = buildMessage({
			role: "assistant",
			turnTrace: {
				items: [
					{ id: "activity-1", kind: "activity", activity: { id: "activity-1", kind: "web_search", status: "running", title: "Web search" } },
					{ id: "blank", kind: "message", text: "   " },
				],
				durationMs: 500,
			},
		});
		const legacy = buildMessage({
			role: "assistant",
			reasoningTrace: "Legacy reasoning",
			turnTrace: {
				activities: [{ id: "activity-2", kind: "file_change", status: "completed", title: "Files changed" }],
				completedMessages: ["progress update", "final output"],
				durationMs: 750,
			},
		});
		const plugin = {
			getExecutionLogForAssistantMessage() {
				return undefined;
			},
		};

		expect(getStoredTurnTrace(plugin, fromItems)).toEqual({
			items: [{ id: "activity-1", kind: "activity", activity: { id: "activity-1", kind: "web_search", status: "running", title: "Web search" } }],
			durationMs: 500,
		});
		expect(getStoredTurnTrace(plugin, legacy)).toEqual({
			items: [
				{ id: `${legacy.id}-reasoning`, kind: "reasoning", text: "Legacy reasoning" },
				{ id: "activity-2", kind: "activity", activity: { id: "activity-2", kind: "file_change", status: "completed", title: "Files changed" } },
				{ id: `${legacy.id}-message-2`, kind: "message", text: "progress update" },
			],
			durationMs: 750,
		});
		expect(hasStoredTurnTrace(plugin, legacy)).toBe(true);
	});
});
