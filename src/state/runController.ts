import type { App } from "obsidian";
import { buildSessionContext } from "../services/context";
import { buildXmlPayload } from "../services/xmlPayload";
import type { CodexRunExecutor, CodexRunResult } from "../codex/runExecutor";
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
import type { CodexAssistantAppState } from "./appState";
import { MAX_EXECUTION_LOG_ENTRIES } from "./constants";
import type { SessionRunSnapshot } from "./sessionRunRegistry";
import { SessionRunRegistry } from "./sessionRunRegistry";
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
	private readonly state: CodexAssistantAppState;
	private readonly runExecutor: CodexRunExecutor;
	private readonly sessionStore: SessionStore;
	private readonly settingsRepository: SettingsRepository;
	private readonly notifyUi: (change: AppViewUpdate) => void;
	private readonly notifyExecutionLogUpdated: () => void;
	private readonly runRegistry = new SessionRunRegistry();

	constructor(options: {
		app: App;
		state: CodexAssistantAppState;
		runExecutor: CodexRunExecutor;
		sessionStore: SessionStore;
		settingsRepository: SettingsRepository;
		notifyUi: (change: AppViewUpdate) => void;
		notifyExecutionLogUpdated: () => void;
	}) {
		this.app = options.app;
		this.state = options.state;
		this.runExecutor = options.runExecutor;
		this.sessionStore = options.sessionStore;
		this.settingsRepository = options.settingsRepository;
		this.notifyUi = options.notifyUi;
		this.notifyExecutionLogUpdated = options.notifyExecutionLogUpdated;
	}

	isSessionRunning(sessionId: string): boolean {
		return this.runRegistry.isSessionRunning(sessionId);
	}

	getSessionRunState(sessionId: string): SessionRunSnapshot | undefined {
		return this.runRegistry.getRun(sessionId);
	}

	getActiveSessionRunState(): SessionRunSnapshot | undefined {
		return this.getSessionRunState(this.state.activeSessionId);
	}

	async runManualPrompt(prompt: string): Promise<boolean> {
		await this.ensureActiveSession();
		const requestSessionId = this.state.activeSessionId;
		if (this.runRegistry.isSessionRunning(requestSessionId)) {
			return false;
		}
		const context = buildSessionContext(this.app, this.state.lastFocusedNotePath);
		const xmlPayload = buildXmlPayload({
			kind: "manual",
			prompt,
			context,
			globalInstructions: this.state.settings.globalInstructions
		});
		this.sessionStore.appendMessage({
			id: createId("user"),
			role: "user",
			content: prompt,
			timestamp: Date.now()
		});
		return await this.runRequest(requestSessionId, xmlPayload, {
			requestKind: "manual",
			prompt,
			vaultRootPath: context.vaultRootPath
		});
	}

	async runSkill(skill: SkillDefinition, reasoningEffort?: string, sandboxMode?: SkillDefinition["sandboxMode"]): Promise<boolean> {
		await this.ensureActiveSession();
		const requestSessionId = this.state.activeSessionId;
		if (this.runRegistry.isSessionRunning(requestSessionId)) {
			return false;
		}
		const context = buildSessionContext(this.app, this.state.lastFocusedNotePath);
		const renderedPrompt = skill.prompt.trim();
		const xmlPayload = buildXmlPayload({
			kind: "skill",
			skillName: skill.name,
			prompt: renderedPrompt,
			context,
			globalInstructions: this.state.settings.globalInstructions
		});
		this.sessionStore.appendMessage({
			id: createId("skill"),
			role: "skill",
			skillName: skill.name,
			activeNotePath: context.activeNotePath || undefined,
			content: renderedPrompt,
			timestamp: Date.now()
		});
		return await this.runRequest(requestSessionId, xmlPayload, {
			requestKind: "skill",
			prompt: renderedPrompt,
			skillName: skill.name,
			vaultRootPath: context.vaultRootPath,
			reasoningEffort,
			sandboxMode
		});
	}

	cancelCurrentRun(): void {
		const run = this.getActiveSessionRunState();
		if (!run) {
			return;
		}
		this.sessionStore.finishAssistantMessage(run.assistantMessageId);
		this.runRegistry.cancelRun(run.sessionId);
		this.notifyUi("controls");
	}

	cancelSessionRun(sessionId: string): boolean {
		const run = this.runRegistry.getRun(sessionId);
		if (!run) {
			return false;
		}
		this.sessionStore.finishAssistantMessage(run.assistantMessageId);
		const cancelled = this.runRegistry.cancelRun(sessionId);
		if (cancelled) {
			this.notifyUi("controls");
		}
		return cancelled;
	}

	cancelExecutionLogRun(logId: string): boolean {
		const sessionId = this.runRegistry.findSessionIdByExecutionLogId(logId);
		if (!sessionId) {
			return false;
		}
		return this.cancelSessionRun(sessionId);
	}

	cancelAllRuns(): void {
		const runningSessionIds = this.runRegistry.getRunningSessionIds();
		for (const sessionId of runningSessionIds) {
			const run = this.runRegistry.getRun(sessionId);
			if (run) {
				this.sessionStore.finishAssistantMessage(run.assistantMessageId);
			}
		}
		this.runRegistry.cancelAllRuns();
		if (runningSessionIds.length > 0) {
			this.notifyUi("controls");
		}
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

	private async runRequest(
		requestSessionId: string,
		xmlPayload: string,
		metadata: RunMetadata
	): Promise<boolean> {
		const runStartedAt = Date.now();
		const logId = this.startExecutionLog({
			sessionId: requestSessionId,
			requestKind: metadata.requestKind,
			skillName: metadata.skillName,
			prompt: metadata.prompt,
			xmlPayload
		});
		const assistantMessageId = createId("assistant");
		this.sessionStore.appendMessage({
			id: assistantMessageId,
			role: "assistant",
			content: "",
			executionLogId: logId,
			timestamp: Date.now(),
			isStreaming: true
		});

		const handle = this.runExecutor.startRun({
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

		if (!this.runRegistry.beginRun(requestSessionId, {
			assistantMessageId,
			executionLogId: logId,
			startedAt: runStartedAt,
			cancelRequested: false,
			cancel: handle.cancel
		})) {
			handle.cancel();
			return false;
		}

		this.notifyUi("controls");

		let result: CodexRunResult;
		let finalSessionId = requestSessionId;
		try {
			result = await handle.promise;
			finalSessionId = result.sessionId && result.sessionId !== requestSessionId
				? result.sessionId
				: requestSessionId;
			if (result.sessionId && result.sessionId !== requestSessionId) {
				this.runRegistry.adoptResolvedSessionId(requestSessionId, result.sessionId);
				await this.sessionStore.adoptResolvedSessionId(requestSessionId, result.sessionId);
				this.setExecutionLogSession(logId, result.sessionId);
			}
			this.sessionStore.finishAssistantMessage(assistantMessageId);
			if (result.errorMessage && !result.cancelled) {
				this.sessionStore.appendMessage({
					id: createId("error"),
					role: "error",
					content: result.errorMessage,
					timestamp: Date.now()
				});
			}
			const assistantMessage = this.sessionStore.findMessageById(assistantMessageId);
			const durationMs = Date.now() - runStartedAt;
			this.sessionStore.setAssistantTurnDuration(assistantMessageId, durationMs);
			const runState = this.runRegistry.getRun(finalSessionId) ?? this.runRegistry.getRun(requestSessionId);
			const finalStatus: ExecutionLogStatus = (runState?.cancelRequested || result.cancelled)
				? "stopped"
				: (result.errorMessage ? "error" : "success");
			this.completeExecutionLog(logId, {
				status: finalStatus,
				response: result.finalContent || (assistantMessage?.content ?? ""),
				errorMessage: result.errorMessage,
				durationMs
			});
			return true;
		} finally {
			if (!this.runRegistry.completeRun(finalSessionId)) {
				this.runRegistry.completeRun(requestSessionId);
			}
			await this.settingsRepository.saveNow(this.state.settings);
			this.notifyUi("controls");
		}
	}

	private async ensureActiveSession(): Promise<void> {
		if (!this.state.activeSessionId) {
			await this.sessionStore.createAndSelectSession();
		}
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
