export function closeOpenPopoverMenus(rootEl: HTMLElement, exceptMenu?: HTMLDetailsElement): void {
	for (const menu of Array.from(rootEl.querySelectorAll<HTMLDetailsElement>(".codex-assistant-popover-menu[open]"))) {
		if (exceptMenu && menu === exceptMenu) {
			continue;
		}
		menu.open = false;
	}
}

export function updatePopoverDirection(
	menu: HTMLDetailsElement,
	contentEl: HTMLElement,
	transcriptEl?: HTMLElement
): void {
	menu.removeClass("codex-assistant-popover-menu-up");
	const popover = menu.querySelector<HTMLElement>(".codex-assistant-actions-popover");
	const trigger = menu.querySelector<HTMLElement>("summary");
	if (!popover || !trigger) {
		return;
	}
	const bounds = menu.closest(".codex-assistant-transcript") && transcriptEl
		? transcriptEl.getBoundingClientRect()
		: contentEl.getBoundingClientRect();
	const triggerRect = trigger.getBoundingClientRect();
	const popoverRect = popover.getBoundingClientRect();
	const availableBelow = bounds.bottom - triggerRect.bottom;
	const availableAbove = triggerRect.top - bounds.top;
	if (popoverRect.height > availableBelow && availableAbove > availableBelow) {
		menu.addClass("codex-assistant-popover-menu-up");
	}
}
