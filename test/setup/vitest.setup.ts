import { afterEach, beforeEach, vi } from "vitest";
import { cleanup } from "@testing-library/preact";
import { resetObsidianMocks } from "../helpers/obsidianMock";

vi.mock("obsidian", async () => import("../helpers/obsidianMock"));

Object.defineProperty(HTMLElement.prototype, "empty", {
	value() {
		this.replaceChildren();
	},
	configurable: true,
});

Object.defineProperty(HTMLElement.prototype, "addClass", {
	value(...classNames: string[]) {
		this.classList.add(...classNames);
	},
	configurable: true,
});

Object.defineProperty(HTMLElement.prototype, "removeClass", {
	value(...classNames: string[]) {
		this.classList.remove(...classNames);
	},
	configurable: true,
});

Object.defineProperty(HTMLElement.prototype, "toggleClass", {
	value(className: string, enabled: boolean) {
		this.classList.toggle(className, enabled);
	},
	configurable: true,
});

Object.defineProperty(HTMLElement.prototype, "setCssProps", {
	value(properties: Record<string, string>) {
		for (const [key, value] of Object.entries(properties)) {
			this.style.setProperty(key, value);
		}
	},
	configurable: true,
});

beforeEach(() => {
	resetObsidianMocks();
	Object.defineProperty(globalThis, "navigator", {
		value: {
			clipboard: {
				writeText: vi.fn(async () => undefined),
			},
		},
		configurable: true,
	});
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	document.body.innerHTML = "";
});
