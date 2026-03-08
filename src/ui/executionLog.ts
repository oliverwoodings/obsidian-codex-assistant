import type { ExecutionLogEntry } from "../types";

export function renderExecutionLog(
	containerEl: HTMLElement,
	entries: ExecutionLogEntry[],
	expandedEntryIds: Set<string>,
	onStopRun: (id: string) => Promise<void>
): void {
	if (entries.length === 0) {
		containerEl.createEl("p", {
			text: "No runs recorded yet.",
			cls: "quick-skills-settings-help"
		});
		return;
	}

	const logContainer = containerEl.createDiv({ cls: "quick-skills-execution-log" });
	for (const entry of entries) {
		const detailsEl = logContainer.createEl("details", { cls: "quick-skills-execution-log-item" });
		detailsEl.open = expandedEntryIds.has(entry.id);
		detailsEl.addEventListener("toggle", () => {
			if (detailsEl.open) {
				expandedEntryIds.add(entry.id);
			} else {
				expandedEntryIds.delete(entry.id);
			}
		});

		const summaryEl = detailsEl.createEl("summary", { cls: "quick-skills-execution-log-summary" });
		summaryEl.createSpan({
			text: `${formatTimestamp(entry.timestamp)} - ${formatRequestType(entry)} - ${entry.sessionId} - ${formatDuration(entry.durationMs)}`
		});

		if (entry.status === "running") {
			summaryEl.createSpan({
				text: " (running)",
				cls: "quick-skills-execution-log-running-label"
			});
			const stopButtonEl = summaryEl.createEl("button", {
				text: "Stop",
				cls: "quick-skills-execution-log-stop-button"
			});
			stopButtonEl.type = "button";
			stopButtonEl.addEventListener("click", (event) => {
				event.preventDefault();
				event.stopPropagation();
				stopButtonEl.disabled = true;
				void onStopRun(entry.id);
			});
		} else if (entry.status === "stopped") {
			summaryEl.createSpan({
				text: " (stopped)",
				cls: "quick-skills-execution-log-stopped-label"
			});
		} else if (entry.status === "error") {
			summaryEl.createSpan({
				text: " (error)",
				cls: "quick-skills-execution-log-error-label"
			});
		}

		const bodyEl = detailsEl.createDiv({ cls: "quick-skills-execution-log-body" });
		bodyEl.createEl("div", { text: `Session: ${entry.sessionId}`, cls: "quick-skills-execution-log-label" });
		bodyEl.createEl("div", { text: `Request type: ${formatRequestType(entry)}`, cls: "quick-skills-execution-log-label" });
		bodyEl.createEl("div", { text: `Duration: ${formatDuration(entry.durationMs)}`, cls: "quick-skills-execution-log-label" });
		bodyEl.createEl("div", {
			text: `Structured events: ${entry.rawEvents.length}`,
			cls: "quick-skills-execution-log-label"
		});

		createExecutionLogTextSection(bodyEl, "Prompt", entry.prompt);
		createExecutionLogTextSection(bodyEl, "XML payload", entry.xmlPayload);
		createExecutionLogTextSection(bodyEl, "Command line", formatCommandLine(entry.command, entry.commandArgs));
		createExecutionLogTextSection(
			bodyEl,
			"Codex config",
			entry.codexConfig ? JSON.stringify(entry.codexConfig, null, 2) : "No Codex SDK config metadata captured."
		);
		createExecutionLogTextSection(
			bodyEl,
			"Structured event stream (JSONL)",
			formatStructuredEventStream(entry)
		);
		createExecutionLogTextSection(
			bodyEl,
			"Diagnostics",
			entry.processOutput.trim() ? entry.processOutput : "No additional diagnostics captured."
		);
		createExecutionLogTextSection(
			bodyEl,
			entry.status === "running" ? "Response (pending)" : (entry.status === "error" ? "Response / error" : "Response"),
			entry.status === "running" ? "In progress..." : (entry.response || entry.errorMessage || "(empty)")
		);
	}
}

function createExecutionLogTextSection(containerEl: HTMLElement, label: string, value: string): void {
	const labelRowEl = containerEl.createDiv({ cls: "quick-skills-execution-log-label-row" });
	labelRowEl.createEl("div", { text: label, cls: "quick-skills-execution-log-label" });

	const copyButton = labelRowEl.createEl("button", {
		text: "Copy",
		cls: "quick-skills-execution-log-copy-button"
	});
	copyButton.type = "button";
	copyButton.addEventListener("click", (event) => {
		event.preventDefault();
		event.stopPropagation();
		void copyExecutionLogText(copyButton, value);
	});

	const preEl = containerEl.createEl("pre", {
		text: value,
		cls: "quick-skills-execution-log-pre"
	});
	preEl.tabIndex = 0;
}

async function copyExecutionLogText(buttonEl: HTMLButtonElement, value: string): Promise<void> {
	const originalLabel = buttonEl.textContent || "Copy";
	try {
		await navigator.clipboard.writeText(value);
		buttonEl.setText("Copied");
	} catch {
		buttonEl.setText("Copy failed");
	}
	window.setTimeout(() => buttonEl.setText(originalLabel), 1200);
}

function formatRequestType(entry: ExecutionLogEntry): string {
	return entry.requestKind === "skill" ? `Skill: ${entry.skillName ?? "Unnamed"}` : "Manual prompt";
}

function formatTimestamp(timestampMs: number): string {
	const date = new Date(timestampMs);
	if (Number.isNaN(date.getTime())) {
		return String(timestampMs);
	}
	return date.toLocaleString();
}

function formatDuration(durationMs: number): string {
	if (Number.isNaN(durationMs)) {
		return "In progress";
	}
	if (durationMs < 1000) {
		return `${durationMs} ms`;
	}
	return `${(durationMs / 1000).toFixed(2)} s`;
}

function formatCommandLine(command: string, args: string[]): string {
	if (!command.trim()) {
		return "Pending...";
	}
	const renderedArgs = args.map((arg) => quoteShellArg(arg)).join(" ");
	return renderedArgs ? `${command} ${renderedArgs}` : command;
}

function formatStructuredEventStream(entry: ExecutionLogEntry): string {
	if (entry.rawEvents.length === 0) {
		return "No structured events captured yet.";
	}
	return entry.rawEvents
		.map((event) => JSON.stringify(event))
		.join("\n");
}

function quoteShellArg(value: string): string {
	if (/^[A-Za-z0-9_./:@%+=,-]+$/u.test(value)) {
		return value;
	}
	return `'${value.replace(/'/g, "'\\''")}'`;
}
