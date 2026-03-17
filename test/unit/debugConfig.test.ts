import { describe, expect, it } from "vitest";
import { buildCodexDebugConfig, isNewSessionId } from "../../src/codex/debugConfig";

describe("buildCodexDebugConfig", () => {
	it("builds a new-session invocation with defaults", () => {
		const { command, commandArgs, config } = buildCodexDebugConfig({
			xmlPayload: "<xml />",
			sessionId: "new-session-123",
			model: "gpt-5.3-codex",
			reasoningEffort: "high",
			sandboxMode: "workspace-write",
			workingDirectory: "/vault",
		}, "   ");

		expect(command).toBe("codex");
		expect(commandArgs).toContain("--model");
		expect(commandArgs).toContain("--sandbox");
		expect(commandArgs).toContain("--cd");
		expect(commandArgs).toContain("--skip-git-repo-check");
		expect(commandArgs).not.toContain("resume");
		expect(config.sessionStrategy).toBe("new");
		expect(config.executablePath).toBe("codex");
		expect(isNewSessionId("new-session-123")).toBe(true);
	});

	it("builds a resume invocation for existing sessions", () => {
		const { commandArgs, config } = buildCodexDebugConfig({
			xmlPayload: "<xml />",
			sessionId: "019cc05f-1234-1234-1234-123456789abc",
			model: "",
			reasoningEffort: "",
			sandboxMode: "read-only",
		}, "/usr/local/bin/codex");

		expect(commandArgs.slice(-2)).toEqual(["resume", "019cc05f-1234-1234-1234-123456789abc"]);
		expect(config.sessionStrategy).toBe("resume");
		expect(config.model).toBeUndefined();
		expect(config.reasoningEffort).toBeUndefined();
	});
});
