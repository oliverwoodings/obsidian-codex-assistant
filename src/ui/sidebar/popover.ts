export function closeOpenPopoverMenus(rootEl: HTMLElement, exceptMenu?: HTMLDetailsElement): void {
	for (const menu of Array.from(rootEl.querySelectorAll<HTMLDetailsElement>(".quick-skills-popover-menu[open]"))) {
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
	menu.removeClass("quick-skills-popover-menu-up");
	const popover = menu.querySelector<HTMLElement>(".quick-skills-actions-popover");
	const trigger = menu.querySelector<HTMLElement>("summary");
	if (!popover || !trigger) {
		return;
	}
	const bounds = menu.closest(".quick-skills-transcript") && transcriptEl
		? transcriptEl.getBoundingClientRect()
		: contentEl.getBoundingClientRect();
	const triggerRect = trigger.getBoundingClientRect();
	const popoverRect = popover.getBoundingClientRect();
	const availableBelow = bounds.bottom - triggerRect.bottom;
	const availableAbove = triggerRect.top - bounds.top;
	if (popoverRect.height > availableBelow && availableAbove > availableBelow) {
		menu.addClass("quick-skills-popover-menu-up");
	}
}
