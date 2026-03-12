import type { App } from "obsidian";
import { buildSessionContext } from "../services/context";
import { buildXmlPayload } from "../services/xmlPayload";
import type { CodexService } from "../codex/service";
import type {
	ChatMessage,
	ExecutionLogCodexConfig,
	ExecutionLogEntry,
	ExecutionLogRawEvent,
	ExecutionLogRequestKind,
	ExecutionLogStatus,
	SkillDefinition
} from "../types";
import { createId } from "../utils/id";
import type { QuickSkillsAppState } from "./appState";
import { MAX_EXECUTION_LOG_ENTRIES } from "./constants";
import type { SessionStore } from "./sessionStore";
import type { SettingsRepository } from "./settingsRepository";
import type { AppViewUpdate } from "./uiChange";

interface RunMetadata {
	requestKind: ExecutionLogRequestKind;
	prompt: string;
	skillName?: string;
	vaultRootPath: string;
	reasoningEffort?: string;
	sandboxMode?: "read-only" | "workspace-write" | "danger-full-access";
}

export class RunController {
	private readonly app: App;
	private readonly state: QuickSkillsAppState;
	private readonly codex: CodexService;
	private readonly sessionStore: SessionStore;
	private readonly settingsRepository: SettingsRepository;
	private readonly notifyUi: (change: AppViewUpdate) => void;
	private readonly notifyExecutionLogUpdated: () => void;

	constructor(options: {
		app: App;
		state: QuickSkillsAppState;
		codex: CodexService;
		sessionStore: SessionStore;
		settingsRepository: SettingsRepository;
		notifyUi: (change: AppViewUpdate) => void;
		notifyExecutionLogUpdated: () => void;
	}) {
		this.app = options.app;
		this.state = options.state;
		this.codex = options.codex;
		this.sessionStore = options.sessionStore;
		this.settingsRepository = options.settingsRepository;
		this.notifyUi = options.notifyUi;
		this.notifyExecutionLogUpdated = options.notifyExecutionLogUpdated;
	}

	async runManualPrompt(prompt: string): Promise<void> {
		const context = buildSessionContext(this.app, this.state.lastFocusedNotePath);
		this.sessionStore.appendMessage({
			id: createId("user"),
			role: "user",
			content: prompt,
			timestamp: Date.now()
		});
		const xmlPayload = buildXmlPayload({
			kind: "manual",
			prompt,
			context,
			globalInstructions: this.state.settings.globalInstructions
		});
		await this.runRequest(xmlPayload, {
			requestKind: "manual",
			prompt,
			vaultRootPath: context.vaultRootPath
		});
	}

	async runSkill(skill: SkillDefinition, reasoningEffort?: string, sandboxMode?: SkillDefinition["sandboxMode"]): Promise<void> {
		const context = buildSessionContext(this.app, this.state.lastFocusedNotePath);
		const renderedPrompt = skill.prompt.trim();
		this.sessionStore.appendMessage({
			id: createId("skill"),
			role: "skill",
			skillName: skill.name,
			activeNotePath: context.activeNotePath || undefined,
			content: renderedPrompt,
			timestamp: Date.now()
		});
		const xmlPayload = buildXmlPayload({
			kind: "skill",
			skillName: skill.name,
			prompt: renderedPrompt,
			context,
			globalInstructions: this.state.settings.globalInstructions
		});
		await this.runRequest(xmlPayload, {
			requestKind: "skill",
			prompt: renderedPrompt,
			skillName: skill.name,
			vaultRootPath: context.vaultRootPath,
			reasoningEffort,
			sandboxMode
		});
	}

	cancelCurrentRun(): void {
		if (this.state.isRunning) {
			this.state.cancelRequested = true;
		}
		this.codex.cancel();
		this.state.isRunning = false;
		if (this.state.currentAssistantMessageId) {
			this.sessionStore.finishAssistantMessage(this.state.currentAssistantMessageId);
		}
		this.settingsRepository.saveSoon(this.state.settings);
		this.notifyUi("controls");
	}

	cancelExecutionLogRun(logId: string): boolean {
		if (!this.state.isRunning || this.state.currentRunLogId !== logId) {
			return false;
		}
		this.cancelCurrentRun();
		return true;
	}

	getExecutionLogForAssistantMessage(message: ChatMessage): ExecutionLogEntry | undefined {
		if (message.executionLogId) {
			return this.state.settings.executionLog.find((entry) => entry.id === message.executionLogId);
		}
		return this.state.settings.executionLog.find((entry) => (
			entry.sessionId === this.state.activeSessionId &&
			entry.response === message.content &&
			Math.abs(entry.timestamp - message.timestamp) < 5 * 60 * 1000
		));
	}

	private async runRequest(xmlPayload: string, metadata: RunMetadata): Promise<void> {
		if (!this.state.activeSessionId) {
			await this.sessionStore.createAndSelectSession();
		}
		const requestSessionId = this.state.activeSessionId;
		const runStartedAt = Date.now();
		const logId = this.startExecutionLog({
			sessionId: requestSessionId,
			requestKind: metadata.requestKind,
			skillName: metadata.skillName,
			prompt: metadata.prompt,
			xmlPayload
		});
		this.state.currentRunLogId = logId;
		const assistantMessageId = createId("assistant");
		this.state.currentAssistantMessageId = assistantMessageId;
		this.sessionStore.appendMessage({
			id: assistantMessageId,
			role: "assistant",
			content: "",
			executionLogId: logId,
			timestamp: Date.now(),
			isStreaming: true
		});

		this.state.isRunning = true;
		this.state.cancelRequested = false;
		this.notifyUi("controls");
		const result = await this.codex.run({
			xmlPayload,
			sessionId: requestSessionId,
			model: this.state.settings.selectedModel,
			reasoningEffort: metadata.reasoningEffort ?? this.state.settings.selectedReasoningEffort,
			sandboxMode: metadata.sandboxMode ?? this.state.settings.sandboxMode,
			workingDirectory: metadata.vaultRootPath
		}, {
			onInvocation: (command, args, config) => {
				this.setExecutionLogInvocation(logId, command, args, config);
			},
			onEvent: (event) => {
				this.appendExecutionLogEvent(logId, event);
			},
			onLiveState: (liveState) => {
				this.sessionStore.setAssistantLiveState(assistantMessageId, liveState);
			},
			onFinalContent: (content) => {
				this.sessionStore.replaceAssistantMessage(assistantMessageId, content);
			}
		});
		this.sessionStore.finishAssistantMessage(assistantMessageId);
		if (result.errorMessage && !result.cancelled) {
			this.sessionStore.appendMessage({
				id: createId("error"),
				role: "error",
				content: result.errorMessage,
				timestamp: Date.now()
			});
		}
		if (result.sessionId && result.sessionId !== requestSessionId) {
			await this.sessionStore.adoptResolvedSessionId(requestSessionId, result.sessionId);
			this.setExecutionLogSession(logId, result.sessionId);
		}
		const assistantMessage = this.sessionStore.findMessageById(assistantMessageId);
		const durationMs = Date.now() - runStartedAt;
		this.sessionStore.setAssistantTurnDuration(assistantMessageId, durationMs);
		const finalStatus: ExecutionLogStatus = (this.state.cancelRequested || result.cancelled)
			? "stopped"
			: (result.errorMessage ? "error" : "success");
		this.completeExecutionLog(logId, {
			status: finalStatus,
			response: result.finalContent || (assistantMessage?.content ?? ""),
			errorMessage: result.errorMessage,
			durationMs
		});
		this.state.isRunning = false;
		this.state.currentRunLogId = null;
		this.state.cancelRequested = false;
		await this.settingsRepository.saveNow(this.state.settings);
		this.notifyUi("controls");
	}

	private startExecutionLog(entry: {
		sessionId: string;
		requestKind: ExecutionLogRequestKind;
		prompt: string;
		xmlPayload: string;
		skillName?: string;
	}): string {
		const id = createId("run");
		this.state.settings.executionLog.unshift({
			id,
			timestamp: Date.now(),
			sessionId: entry.sessionId,
			requestKind: entry.requestKind,
			skillName: entry.skillName,
			prompt: entry.prompt,
			xmlPayload: entry.xmlPayload,
			command: "",
			commandArgs: [],
			processOutput: "",
			rawEvents: [],
			response: "",
			errorMessage: "",
			durationMs: Number.NaN,
			status: "running"
		});
		if (this.state.settings.executionLog.length > MAX_EXECUTION_LOG_ENTRIES) {
			this.state.settings.executionLog = this.state.settings.executionLog.slice(0, MAX_EXECUTION_LOG_ENTRIES);
		}
		this.settingsRepository.saveSoon(this.state.settings);
		this.notifyExecutionLogUpdated();
		return id;
	}

	private setExecutionLogInvocation(id: string, command: string, args: string[], config: ExecutionLogCodexConfig): void {
		const entry = this.state.settings.executionLog.find((item) => item.id === id);
		if (!entry) {
			return;
		}
		entry.command = command;
		entry.commandArgs = [...args];
		entry.codexConfig = config;
		this.settingsRepository.saveSoon(this.state.settings);
		this.notifyExecutionLogUpdated();
	}

	private setExecutionLogSession(id: string, sessionId: string): void {
		const entry = this.state.settings.executionLog.find((item) => item.id === id);
		if (!entry) {
			return;
		}
		entry.sessionId = sessionId;
		this.settingsRepository.saveSoon(this.state.settings);
		this.notifyExecutionLogUpdated();
	}

	private appendExecutionLogEvent(id: string, event: ExecutionLogRawEvent): void {
		const entry = this.state.settings.executionLog.find((item) => item.id === id);
		if (!entry) {
			return;
		}
		entry.rawEvents.push(event);
		this.settingsRepository.saveSoon(this.state.settings);
		this.notifyExecutionLogUpdated();
	}

	private completeExecutionLog(id: string, update: {
		status: ExecutionLogStatus;
		response: string;
		errorMessage: string;
		durationMs: number;
	}): void {
		const entry = this.state.settings.executionLog.find((item) => item.id === id);
		if (!entry) {
			return;
		}
		entry.status = update.status;
		entry.response = update.response;
		entry.errorMessage = update.errorMessage;
		if (update.errorMessage && !entry.processOutput.trim()) {
			entry.processOutput = update.errorMessage;
		}
		entry.durationMs = update.durationMs;
		this.settingsRepository.saveSoon(this.state.settings);
		this.notifyExecutionLogUpdated();
	}
}
