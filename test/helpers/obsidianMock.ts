import { vi } from "vitest";

export const notices: string[] = [];
export const requestUrlMock = vi.fn();
export const setIconMock = vi.fn();
export const markdownRenderMock = vi.fn(async (_app: unknown, text: string, el: HTMLElement) => {
	el.textContent = text;
});

export class Component {
	registerEvent<T>(eventRef: T): T {
		return eventRef;
	}

	registerDomEvent(target: EventTarget, eventName: string, callback: EventListenerOrEventListenerObject): void {
		target.addEventListener(eventName, callback);
	}

	registerInterval(id: number): number {
		return id;
	}
}

export class TFile {
	path: string;

	constructor(path: string) {
		this.path = path;
	}
}

export class MarkdownView {
	file: TFile | null;
	editor?: { getSelection: () => string; getValue?: () => string; replaceSelection?: (value: string) => void };

	constructor(file?: TFile | null) {
		this.file = file ?? null;
	}
}

export class WorkspaceLeaf {
	view: { file?: TFile | null } & Record<string, unknown>;
	state: unknown = null;

	constructor(view: Record<string, unknown> = {}) {
		this.view = view as { file?: TFile | null } & Record<string, unknown>;
	}

	async setViewState(state: unknown): Promise<void> {
		this.state = state;
	}
}

export class ItemView extends Component {
	leaf: WorkspaceLeaf;
	contentEl: HTMLDivElement;

	constructor(leaf: WorkspaceLeaf) {
		super();
		this.leaf = leaf;
		this.contentEl = document.createElement("div");
	}
}

export class Plugin extends Component {
	app: any;
	manifest: any;
	commands: any[] = [];
	settingTabs: any[] = [];
	views = new Map<string, unknown>();
	ribbonIcons: any[] = [];

	constructor(app: any, manifest: any) {
		super();
		this.app = app;
		this.manifest = manifest;
	}

	addCommand(command: any): any {
		this.commands.push(command);
		return command;
	}

	addSettingTab(settingTab: any): void {
		this.settingTabs.push(settingTab);
	}

	addRibbonIcon(icon: string, title: string, callback: (evt: MouseEvent) => unknown): HTMLElement {
		const element = document.createElement("button");
		this.ribbonIcons.push({ icon, title, callback, element });
		return element;
	}

	registerView(type: string, creator: unknown): void {
		this.views.set(type, creator);
	}

	async loadData(): Promise<unknown> {
		return {};
	}

	async saveData(_data: unknown): Promise<void> {}
}

export class PluginSettingTab {
	app: unknown;
	plugin: unknown;
	containerEl: HTMLDivElement;

	constructor(app: unknown, plugin: unknown) {
		this.app = app;
		this.plugin = plugin;
		this.containerEl = document.createElement("div");
	}
}

export class Setting {
	settingEl = document.createElement("div");
	name = "";
	desc = "";

	constructor(public containerEl: HTMLElement) {
		containerEl.appendChild(this.settingEl);
	}

	setName(name: string): this {
		this.name = name;
		return this;
	}

	setDesc(desc: string): this {
		this.desc = desc;
		return this;
	}

	setHeading(): this {
		return this;
	}

	addText(callback: (component: TextComponent) => void): this {
		callback(new TextComponent(this.settingEl));
		return this;
	}

	addTextArea(callback: (component: TextAreaComponent) => void): this {
		callback(new TextAreaComponent(this.settingEl));
		return this;
	}

	addButton(callback: (component: ButtonComponent) => void): this {
		callback(new ButtonComponent(this.settingEl));
		return this;
	}

	addExtraButton(callback: (component: ExtraButtonComponent) => void): this {
		callback(new ExtraButtonComponent(this.settingEl));
		return this;
	}
}

export class TextComponent {
	inputEl = document.createElement("input");

	constructor(containerEl?: HTMLElement) {
		containerEl?.appendChild(this.inputEl);
	}

	setValue(value: string): this {
		this.inputEl.value = value;
		return this;
	}

	getValue(): string {
		return this.inputEl.value;
	}

	setPlaceholder(value: string): this {
		this.inputEl.placeholder = value;
		return this;
	}

	onChange(callback: (value: string) => void): this {
		this.inputEl.addEventListener("input", () => callback(this.inputEl.value));
		return this;
	}
}

export class TextAreaComponent extends TextComponent {
	override inputEl = document.createElement("textarea");
}

export class ButtonComponent {
	buttonEl = document.createElement("button");

	constructor(containerEl?: HTMLElement) {
		containerEl?.appendChild(this.buttonEl);
	}

	setButtonText(value: string): this {
		this.buttonEl.textContent = value;
		return this;
	}

	setCta(): this {
		return this;
	}

	setWarning(): this {
		return this;
	}

	onClick(callback: () => void): this {
		this.buttonEl.addEventListener("click", callback);
		return this;
	}
}

export class ExtraButtonComponent extends ButtonComponent {
	setIcon(_value: string): this {
		return this;
	}

	setTooltip(value: string): this {
		this.buttonEl.title = value;
		return this;
	}
}

export class DropdownComponent {
	selectEl = document.createElement("select");

	constructor(containerEl?: HTMLElement) {
		containerEl?.appendChild(this.selectEl);
	}

	addOption(value: string, label: string): this {
		const option = document.createElement("option");
		option.value = value;
		option.textContent = label;
		this.selectEl.appendChild(option);
		return this;
	}

	setValue(value: string): this {
		this.selectEl.value = value;
		return this;
	}

	onChange(callback: (value: string) => void): this {
		this.selectEl.addEventListener("change", () => callback(this.selectEl.value));
		return this;
	}
}

export class ToggleComponent {
	toggleEl = document.createElement("input");

	constructor(containerEl?: HTMLElement) {
		this.toggleEl.type = "checkbox";
		containerEl?.appendChild(this.toggleEl);
	}

	setValue(value: boolean): this {
		this.toggleEl.checked = value;
		return this;
	}

	onChange(callback: (value: boolean) => void): this {
		this.toggleEl.addEventListener("change", () => callback(this.toggleEl.checked));
		return this;
	}
}

export class Modal extends Component {
	contentEl = document.createElement("div");
	modalEl = document.createElement("div");

	constructor(public app: unknown) {
		super();
	}

	open(): void {
		this.onOpen();
	}

	close(): void {
		this.onClose();
	}

	onOpen(): void {}

	onClose(): void {}
}

export class FuzzySuggestModal<T> extends Modal {
	items: T[] = [];
	placeholder = "";

	setPlaceholder(value: string): void {
		this.placeholder = value;
	}

	getItems(): T[] {
		return this.items;
	}

	getItemText(item: T): string {
		return String(item);
	}

	onChooseItem(_item: T): void {}
}

export class Notice {
	message: string;

	constructor(message: string) {
		this.message = message;
		notices.push(message);
	}
}

export const MarkdownRenderer = {
	render: markdownRenderMock,
};

export function setIcon(element: HTMLElement, icon: string): void {
	element.dataset.icon = icon;
	setIconMock(element, icon);
}

export async function requestUrl(...args: unknown[]): Promise<any> {
	return requestUrlMock(...args);
}

export function resetObsidianMocks(): void {
	notices.length = 0;
	requestUrlMock.mockReset();
	setIconMock.mockReset();
	markdownRenderMock.mockReset();
	markdownRenderMock.mockImplementation(async (_app: unknown, text: string, el: HTMLElement) => {
		el.textContent = text;
	});
}
