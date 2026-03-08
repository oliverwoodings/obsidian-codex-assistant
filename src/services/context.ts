import { MarkdownView, type App, type TFile, type WorkspaceLeaf } from "obsidian";
import type { SessionContext } from "../types";

function asMarkdownView(leaf: WorkspaceLeaf | null | undefined): MarkdownView | null {
	if (!leaf || !(leaf.view instanceof MarkdownView) || !leaf.view.file) {
		return null;
	}
	return leaf.view;
}

function getOpenMarkdownViews(app: App): MarkdownView[] {
	const views: MarkdownView[] = [];
	const seenPaths = new Set<string>();
	for (const leaf of app.workspace.getLeavesOfType("markdown")) {
		if (!(leaf.view instanceof MarkdownView) || !leaf.view.file) {
			continue;
		}
		const path = leaf.view.file.path;
		if (seenPaths.has(path)) {
			continue;
		}
		seenPaths.add(path);
		views.push(leaf.view);
	}
	return views;
}

function getMostRecentMarkdownView(app: App): MarkdownView | null {
	const workspaceWithRecentLeaf = app.workspace as unknown as {
		getMostRecentLeaf?: (type?: string) => WorkspaceLeaf | null;
	};
	const recentMarkdownView = asMarkdownView(workspaceWithRecentLeaf.getMostRecentLeaf?.("markdown"));
	if (recentMarkdownView) {
		return recentMarkdownView;
	}
	return asMarkdownView(workspaceWithRecentLeaf.getMostRecentLeaf?.());
}

export function getOpenMarkdownNotePaths(app: App): string[] {
	return getOpenMarkdownViews(app).map((view) => view.file?.path ?? "").filter((path) => path.length > 0);
}

export function getActiveMarkdownView(app: App, lastFocusedNotePath?: string | null): MarkdownView | null {
	const focusedView = app.workspace.getActiveViewOfType(MarkdownView);
	if (focusedView?.file) {
		return focusedView;
	}

	const openViews = getOpenMarkdownViews(app);
	if (openViews.length === 0) {
		return null;
	}

	if (lastFocusedNotePath) {
		const byHistory = openViews.find((view) => view.file?.path === lastFocusedNotePath);
		if (byHistory) {
			return byHistory;
		}
	}

	const recentView = getMostRecentMarkdownView(app);
	if (recentView?.file) {
		const byRecent = openViews.find((view) => view.file?.path === recentView.file?.path);
		if (byRecent) {
			return byRecent;
		}
	}

	return openViews[0] ?? null;
}

export function buildSessionContext(app: App, lastFocusedNotePath?: string | null): SessionContext {
	const activeNoteView = getActiveMarkdownView(app, lastFocusedNotePath);
	const openNotePaths = getOpenMarkdownNotePaths(app);
	const activeNotePath = activeNoteView?.file?.path ?? "";
	const vaultRootPath = (app.vault.adapter as { basePath?: string }).basePath ?? "";
	const selectedText = activeNoteView?.editor?.getSelection() ?? "";

	return {
		vaultRootPath,
		activeFilePath: activeNotePath,
		activeNotePath,
		openNotePaths,
		selectedText
	};
}

export function getFrontmatterTags(app: App, file: TFile | null): string[] {
	if (!file) {
		return [];
	}
	const cache = app.metadataCache.getFileCache(file);
	const tags = cache?.frontmatter?.tags as unknown;
	if (!tags) {
		return [];
	}
	if (Array.isArray(tags)) {
		return tags.map((tag) => String(tag));
	}
	if (typeof tags === "string") {
		return tags.split(",").map((tag) => tag.trim()).filter((tag) => tag.length > 0);
	}
	return [];
}
