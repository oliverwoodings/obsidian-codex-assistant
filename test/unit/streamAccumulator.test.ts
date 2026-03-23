import { describe, expect, it } from "vitest";
import { CodexStreamAccumulator } from "../../src/codex/streamAccumulator";

describe("CodexStreamAccumulator", () => {
	it("tracks session id, live trace items, and final content", () => {
		const accumulator = new CodexStreamAccumulator();

		accumulator.apply({ type: "thread.started", thread_id: "session-123" } as never);
		accumulator.apply({
			type: "item.started",
			item: { id: "reason-1", type: "reasoning", text: "Thinking" },
		} as never);
		accumulator.apply({
			type: "item.updated",
			item: {
				id: "cmd-1",
				type: "command_execution",
				command: "rg foo",
				status: "in_progress",
				exit_code: undefined,
				aggregated_output: "line 1\nline 2",
			},
		} as never);
		const finalUpdate = accumulator.apply({
			type: "item.completed",
			item: { id: "msg-1", type: "agent_message", text: "Final answer" },
		} as never);

		expect(finalUpdate.sessionId).toBe("session-123");
		expect(finalUpdate.finalContent).toBe("Final answer");
		expect(finalUpdate.finalContentChanged).toBe(true);
		expect(finalUpdate.liveState.traceItems).toEqual([
			{ id: "reason-1", kind: "reasoning", text: "Thinking" },
			{
				id: "cmd-1",
				kind: "activity",
				activity: {
					id: "cmd-1",
					kind: "command_execution",
					status: "running",
					title: "rg foo",
					detail: "Running command\nline 1\nline 2",
				},
			},
		]);
	});

	it("replaces duplicate items instead of duplicating them and excludes the final completed assistant item from live trace", () => {
		const accumulator = new CodexStreamAccumulator();

		accumulator.apply({
			type: "item.started",
			item: { id: "msg-1", type: "agent_message", text: "Draft 1" },
		} as never);
		const updated = accumulator.apply({
			type: "item.updated",
			item: { id: "msg-1", type: "agent_message", text: "Draft 2" },
		} as never);
		const completed = accumulator.apply({
			type: "item.completed",
			item: { id: "msg-1", type: "agent_message", text: "Final draft" },
		} as never);

		expect(updated.liveState.traceItems).toEqual([
			{ id: "msg-1", kind: "message", text: "Draft 2", isDraft: true },
		]);
		expect(completed.liveState.traceItems).toEqual([]);
		expect(completed.finalContent).toBe("Final draft");
		expect(accumulator.getLiveState().traceItems).toEqual([]);
	});

	it("maps plan, tool, file change, and error items into activity summaries", () => {
		const accumulator = new CodexStreamAccumulator();

		accumulator.apply({
			type: "item.completed",
			item: {
				id: "todo-1",
				type: "todo_list",
				items: [{ text: "Ship tests", completed: true }],
			},
		} as never);
		accumulator.apply({
			type: "item.updated",
			item: {
				id: "mcp-1",
				type: "mcp_tool_call",
				server: "github",
				tool: "search",
				status: "failed",
				error: { message: "Denied" },
			},
		} as never);
		accumulator.apply({
			type: "item.completed",
			item: {
				id: "file-1",
				type: "file_change",
				status: "completed",
				changes: [{ kind: "update", path: "src/main.ts" }],
			},
		} as never);
		const update = accumulator.apply({
			type: "item.completed",
			item: {
				id: "error-1",
				type: "error",
				message: "This session was recorded with model `gpt-5.4-mini` but is resuming with `gpt-5.4`. Consider switching back.",
			},
		} as never);

		expect(update.liveState.traceItems).toEqual([
			expect.objectContaining({
				id: "todo-1",
				kind: "activity",
				activity: expect.objectContaining({ title: "Plan updated", status: "info" }),
			}),
			expect.objectContaining({
				id: "mcp-1",
				kind: "activity",
				activity: expect.objectContaining({ title: "github/search", status: "failed", detail: "Denied" }),
			}),
			expect.objectContaining({
				id: "file-1",
				kind: "activity",
				activity: expect.objectContaining({ title: "Files changed", detail: "update: src/main.ts" }),
			}),
			expect.objectContaining({
				id: "error-1",
				kind: "activity",
				activity: expect.objectContaining({
					title: "Model changed",
					status: "failed",
					detail: "This session was recorded with model `gpt-5.4-mini` but is resuming with `gpt-5.4`. Consider switching back.",
				}),
			}),
		]);
	});
});
