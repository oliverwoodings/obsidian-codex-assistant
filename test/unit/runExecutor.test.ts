import { delimiter } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { buildCodexEnvironment } from "../../src/codex/runExecutor";

describe("buildCodexEnvironment", () => {
	it("prepends configured PATH entries while keeping the existing environment", () => {
		vi.stubEnv("PATH", ["/usr/bin", "/bin"].join(delimiter));
		vi.stubEnv("HOME", "/Users/tester");

		const env = buildCodexEnvironment(["/opt/homebrew/bin", " /usr/bin ", "", "/opt/homebrew/bin"]);

		expect(env.HOME).toBe("/Users/tester");
		expect(env.PATH).toBe(["/opt/homebrew/bin", "/usr/bin", "/bin"].join(delimiter));
	});
});
