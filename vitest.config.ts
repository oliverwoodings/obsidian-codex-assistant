import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
	resolve: {
		alias: {
			obsidian: fileURLToPath(new URL("./test/helpers/obsidianMock.ts", import.meta.url)),
		},
	},
	test: {
		setupFiles: ["./test/setup/vitest.setup.ts"],
		environment: "jsdom",
		include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
		coverage: {
			reporter: ["text", "html"],
			include: ["src/**/*.ts", "src/**/*.tsx"],
		},
	},
});
