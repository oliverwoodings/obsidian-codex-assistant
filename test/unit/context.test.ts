import { describe, expect, it, vi } from "vitest";
import { buildSessionContext, getActiveMarkdownView, getFrontmatterTags, getOpenMarkdownNotePaths } from "../../src/services/context";
import { createApp, createFile, createLeaf, createMarkdownView } from "../helpers/fakes";

describe("context helpers", () => {
	it("prefers the active markdown view and deduplicates open note paths", () => {
		const activeView = createMarkdownView("Notes/Active.md", "selection");
		const duplicateLeaf = createLeaf({ file: createFile("Notes/Open.md") });
		duplicateLeaf.view = createMarkdownView("Notes/Open.md");
		const app = createApp({
			workspace: {
				getActiveViewOfType: vi.fn(() => activeView),
				getLeavesOfType: vi.fn(() => [
					createLeaf(activeView),
					duplicateLeaf,
					createLeaf(createMarkdownView("Notes/Open.md")),
					createLeaf(createMarkdownView("Notes/Other.md")),
				]),
			},
		});

		const context = buildSessionContext(app);

		expect(context.activeNotePath).toBe("Notes/Active.md");
		expect(context.selectedText).toBe("selection");
		expect(getOpenMarkdownNotePaths(app)).toEqual(["Notes/Active.md", "Notes/Open.md", "Notes/Other.md"]);
	});

	it("falls back to last focused and most recent markdown views when there is no active view", () => {
		const historyView = createMarkdownView("Notes/History.md");
		const recentView = createMarkdownView("Notes/Recent.md");
		const app = createApp({
			workspace: {
				getActiveViewOfType: vi.fn(() => null),
				getLeavesOfType: vi.fn(() => [
					createLeaf(historyView),
					createLeaf(recentView),
				]),
				getMostRecentLeaf: vi.fn((type?: string) => (type === "markdown" ? createLeaf(recentView) : null)),
			},
		});

		expect(getActiveMarkdownView(app, "Notes/History.md")?.file?.path).toBe("Notes/History.md");
		expect(getActiveMarkdownView(app)?.file?.path).toBe("Notes/Recent.md");
	});

	it("extracts frontmatter tags from strings and arrays", () => {
		const file = createFile("Notes/Test.md");
		const app = createApp({
			metadataCache: {
				getFileCache: vi.fn()
					.mockReturnValueOnce({ frontmatter: { tags: "one, two" } })
					.mockReturnValueOnce({ frontmatter: { tags: ["#three", "four"] } })
					.mockReturnValueOnce({ frontmatter: {} }),
			},
		});

		expect(getFrontmatterTags(app, file)).toEqual(["one", "two"]);
		expect(getFrontmatterTags(app, file)).toEqual(["#three", "four"]);
		expect(getFrontmatterTags(app, file)).toEqual([]);
		expect(getFrontmatterTags(app, null)).toEqual([]);
	});
});
