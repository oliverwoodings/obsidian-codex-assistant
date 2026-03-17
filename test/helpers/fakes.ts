import { vi } from "vitest";
import type { App, MarkdownView, TFile, WorkspaceLeaf } from "obsidian";
import { TFile as MockTFile, WorkspaceLeaf as MockWorkspaceLeaf, MarkdownView as MockMarkdownView } from "./obsidianMock";

export function createFile(path: string): TFile {
	return new MockTFile(path) as unknown as TFile;
}

export function createMarkdownView(path?: string, selection = ""): MarkdownView {
	const file = path ? createFile(path) : null;
	const view = new MockMarkdownView(file) as unknown as MarkdownView & {
		editor: { getSelection: () => string; getValue: () => string; replaceSelection: (value: string) => void };
	};
	view.editor = {
		getSelection: () => selection,
		getValue: () => "",
		replaceSelection: vi.fn(),
	};
	return view;
}

export function createLeaf(view?: Record<string, unknown>): WorkspaceLeaf {
	return new MockWorkspaceLeaf(view) as unknown as WorkspaceLeaf;
}

export function createApp(overrides: Partial<App> = {}): App {
	const {
		workspace: workspaceOverrides,
		metadataCache: metadataCacheOverrides,
		vault: vaultOverrides,
		...appOverrides
	} = overrides as Partial<App> & {
		workspace?: Record<string, unknown>;
		metadataCache?: Record<string, unknown>;
		vault?: Record<string, unknown>;
	};
	const eventHandlers = new Map<string, Function[]>();
	const workspace = {
		on: vi.fn((name: string, callback: Function) => {
			const list = eventHandlers.get(name) ?? [];
			list.push(callback);
			eventHandlers.set(name, list);
			return { name, callback };
		}),
		trigger(name: string, ...args: unknown[]) {
			for (const callback of eventHandlers.get(name) ?? []) {
				callback(...args);
			}
		},
		getLeavesOfType: vi.fn(() => []),
		getActiveViewOfType: vi.fn(() => null),
		ensureSideLeaf: vi.fn(async () => createLeaf()),
		openLinkText: vi.fn(async () => undefined),
		revealLeaf: vi.fn(async () => undefined),
		getMostRecentLeaf: vi.fn(() => null),
		layoutReady: true,
		rightSplit: {},
		...workspaceOverrides,
	};
	const app = {
		workspace,
		metadataCache: {
			on: vi.fn((_name: string, callback: Function) => ({ callback })),
			getFileCache: vi.fn(() => null),
			...metadataCacheOverrides,
		},
		vault: {
			adapter: { basePath: "/vault" },
			...vaultOverrides,
		},
		...appOverrides,
	};
	return app as App;
}
