import { describe, expect, it } from "vitest";
import { buildActivity, buildMessage } from "../helpers/builders";
import {
	formatDuration,
	formatReasoningLabel,
	formatSandboxModeShortLabel,
	getErrorMessage,
	getStreamingStatusLabel,
	iconForActivity,
	labelForActivityStatus,
	metaLabelForMessage,
	summarizeNotePath,
} from "../../src/ui/sidebar/viewHelpers";

describe("sidebar view helpers", () => {
	it("formats labels and note summaries", () => {
		expect(formatDuration(1_000)).toBe("1s");
		expect(formatDuration(61_000)).toBe("1m 1s");
		expect(formatReasoningLabel("xhigh")).toBe("X-high");
		expect(formatReasoningLabel("very_high effort")).toBe("Very High Effort");
		expect(formatSandboxModeShortLabel("read-only")).toBe("Read");
		expect(formatSandboxModeShortLabel("workspace-write")).toBe("Write");
		expect(formatSandboxModeShortLabel("danger-full-access")).toBe("Danger");
		expect(summarizeNotePath("Folder/My note.md")).toBe("My note");
	});

	it("derives streaming and activity labels", () => {
		expect(getStreamingStatusLabel([{ id: "1", kind: "reasoning", text: "Thinking" }])).toBe("Thinking");
		expect(getStreamingStatusLabel([{ id: "2", kind: "message", text: "Draft", isDraft: true }])).toBe("Drafting response");
		expect(getStreamingStatusLabel([{
			id: "3",
			kind: "activity",
			activity: buildActivity({ kind: "todo_list" }),
		}])).toBe("Updating plan");
		expect(iconForActivity("file_change")).toBe("file-pen");
		expect(labelForActivityStatus("info")).toBe("Updated");
		expect(labelForActivityStatus("failed")).toBe("Failed");
	});

	it("handles meta and error fallback text", () => {
		expect(metaLabelForMessage(buildMessage({ role: "assistant" }))).toBe("");
		expect(metaLabelForMessage(buildMessage({ role: "error", isStreaming: true }))).toBe("error - running...");
		expect(getErrorMessage(new Error("Boom"), "fallback")).toBe("Boom");
		expect(getErrorMessage({ message: "hidden" }, "fallback")).toBe("fallback");
	});
});
