import { Notice, setIcon } from "obsidian";
import type QuickSkillsPlugin from "../../main";
import { DictationSession } from "../../voice/dictationSession";

const DICTATION_BAR_COUNT = 20;

type DictationUiState = "idle" | "recording" | "transcribing";

export class DictationController {
	private readonly plugin: QuickSkillsPlugin;
	private readonly inputEl: HTMLTextAreaElement;
	private readonly onInputChanged: () => void;
	private readonly onStateChanged: () => void;
	private readonly optionControlsEl: HTMLElement;
	private readonly dictationDisplayEl: HTMLElement;
	private readonly dictationStatusEl: HTMLElement;
	private readonly micButton: HTMLButtonElement;
	private readonly dictationBars: HTMLElement[] = [];
	private dictationState: DictationUiState = "idle";
	private dictationSession: DictationSession | null = null;
	private dictationLevels = Array.from({ length: DICTATION_BAR_COUNT }, () => 0);

	constructor(options: {
		plugin: QuickSkillsPlugin;
		inputEl: HTMLTextAreaElement;
		onInputChanged: () => void;
		onStateChanged: () => void;
		footerEl: HTMLElement;
		actionControlsEl: HTMLElement;
	}) {
		this.plugin = options.plugin;
		this.inputEl = options.inputEl;
		this.onInputChanged = options.onInputChanged;
		this.onStateChanged = options.onStateChanged;
		this.optionControlsEl = options.footerEl.createDiv({ cls: "quick-skills-toolbar-selects" });
		this.dictationDisplayEl = options.footerEl.createDiv({ cls: "quick-skills-dictation-display" });
		this.dictationStatusEl = this.dictationDisplayEl.createDiv({ cls: "quick-skills-dictation-status" });
		const dictationBarsEl = this.dictationDisplayEl.createDiv({ cls: "quick-skills-dictation-bars" });
		for (let index = 0; index < DICTATION_BAR_COUNT; index += 1) {
			this.dictationBars.push(dictationBarsEl.createDiv({ cls: "quick-skills-dictation-bar" }));
		}
		this.micButton = options.actionControlsEl.createEl("button", {
			cls: "quick-skills-toolbar-button quick-skills-toolbar-button-mic",
			attr: { "aria-label": "Voice dictation", title: "Voice dictation" }
		});
		setIcon(this.micButton, "mic");
		this.micButton.addEventListener("click", () => {
			void this.toggle();
		});
	}

	get selectContainerEl(): HTMLElement {
		return this.optionControlsEl;
	}

	isBusy(): boolean {
		return this.dictationState !== "idle";
	}

	render(): void {
		const dictationVisible = this.dictationState !== "idle";
		this.optionControlsEl.hidden = dictationVisible;
		this.dictationDisplayEl.hidden = !dictationVisible;
		this.micButton.disabled = this.plugin.isRunning || this.dictationState === "transcribing";
		this.micButton.toggleClass("is-recording", this.dictationState === "recording");
		this.micButton.toggleClass("is-transcribing", this.dictationState === "transcribing");
		this.micButton.setAttribute(
			"title",
			this.dictationState === "recording"
				? "Stop dictation"
				: (this.dictationState === "transcribing" ? "Transcribing..." : "Start dictation")
		);
		this.micButton.setAttribute(
			"aria-label",
			this.dictationState === "recording"
				? "Stop dictation"
				: (this.dictationState === "transcribing" ? "Transcribing..." : "Start dictation")
		);
		if (this.dictationState === "transcribing") {
			setIcon(this.micButton, "loader");
			this.dictationStatusEl.setText("Transcribing audio...");
		} else {
			setIcon(this.micButton, "mic");
			this.dictationStatusEl.setText("Listening...");
		}
		this.renderLevels();
	}

	async teardown(): Promise<void> {
		if (!this.dictationSession) {
			return;
		}
		await this.dictationSession.abort();
		this.dictationSession = null;
		this.dictationState = "idle";
		this.dictationLevels = Array.from({ length: DICTATION_BAR_COUNT }, () => 0);
		this.onStateChanged();
	}

	private async toggle(): Promise<void> {
		if (this.plugin.isRunning || this.dictationState === "transcribing") {
			return;
		}
		if (this.dictationState === "recording") {
			await this.stop();
			return;
		}
		await this.start();
	}

	private async start(): Promise<void> {
		try {
			this.dictationLevels = Array.from({ length: DICTATION_BAR_COUNT }, () => 0);
			this.dictationSession = new DictationSession({
				baseUrl: this.plugin.settings.whisperBaseUrl,
				language: this.plugin.settings.whisperLanguage,
				timeoutMs: this.plugin.settings.whisperRequestTimeoutMs
			}, {
				onLevel: (level) => {
					this.pushLevel(level);
				}
			});
			await this.dictationSession.start();
			this.dictationState = "recording";
			this.onStateChanged();
		} catch (error) {
			this.dictationSession = null;
			this.dictationState = "idle";
			new Notice(this.getErrorMessage(error, "Failed to start voice dictation."));
			this.onStateChanged();
		}
	}

	private async stop(): Promise<void> {
		if (!this.dictationSession) {
			this.dictationState = "idle";
			this.onStateChanged();
			return;
		}
		this.dictationState = "transcribing";
		this.onStateChanged();
		try {
			const transcript = (await this.dictationSession.stopAndTranscribe()).trim();
			if (!transcript) {
				new Notice("No speech detected.");
			} else {
				this.appendTranscript(transcript);
			}
		} catch (error) {
			new Notice(this.getErrorMessage(error, "Voice dictation transcription failed."));
		} finally {
			this.dictationSession = null;
			this.dictationState = "idle";
			this.dictationLevels = Array.from({ length: DICTATION_BAR_COUNT }, () => 0);
			this.onStateChanged();
		}
	}

	private appendTranscript(transcript: string): void {
		const existing = this.inputEl.value.trim();
		this.inputEl.value = existing ? `${this.inputEl.value.trimEnd()}\n\n${transcript}` : transcript;
		this.onInputChanged();
		this.inputEl.focus();
	}

	private pushLevel(level: number): void {
		this.dictationLevels = [...this.dictationLevels.slice(1), level];
		this.renderLevels();
	}

	private renderLevels(): void {
		this.dictationBars.forEach((bar, index) => {
			const level = this.dictationLevels[index] ?? 0;
			bar.style.setProperty("--quick-skills-dictation-level", `${Math.max(0.12, level)}`);
		});
	}

	private getErrorMessage(error: unknown, fallback: string): string {
		return error instanceof Error && error.message.trim() ? error.message : fallback;
	}
}
