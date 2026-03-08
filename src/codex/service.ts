import { Codex, type ModelReasoningEffort, type ThreadOptions } from "@openai/codex-sdk";
import type { ExecutionLogCodexConfig, ExecutionLogRawEvent, ModelCatalog, RunRequest, SessionSummary } from "../types";
import { buildCodexDebugConfig, isNewSessionId } from "./debugConfig";
import { readModelCatalog } from "./modelCatalog";
import { archiveCodexSession, listKnownCodexSessions, moveCodexSessionMetadata, renameCodexSession } from "./sessionMetadata";
import { CodexStreamAccumulator, type CodexLiveState } from "./streamAccumulator";
import { NEW_SESSION_PREFIX, RAW_REASONING_CONFIG, SKIP_GIT_REPO_CHECK } from "./constants";

export type { CodexLiveState } from "./streamAccumulator";

export interface CodexRunHandlers {
	onInvocation?: (command: string, args: string[], config: ExecutionLogCodexConfig) => void;
	onEvent?: (event: ExecutionLogRawEvent) => void;
	onLiveState?: (state: CodexLiveState) => void;
	onFinalContent?: (content: string) => void;
}

export interface CodexRunResult {
	sessionId?: string;
	finalContent: string;
	cancelled: boolean;
	errorMessage: string;
}

export class CodexService {
	private activeAbortController: AbortController | null = null;
	private readonly codexBinaryPath: () => string;

	constructor(codexBinaryPath: () => string) {
		this.codexBinaryPath = codexBinaryPath;
	}

	async run(request: RunRequest, handlers: CodexRunHandlers): Promise<CodexRunResult> {
		this.cancel();
		const abortController = new AbortController();
		this.activeAbortController = abortController;

		const executablePath = this.getExecutablePath();
		const invocation = buildCodexDebugConfig(request, executablePath);
		handlers.onInvocation?.(invocation.command, invocation.commandArgs, invocation.config);

		const codex = new Codex({
			codexPathOverride: executablePath,
			config: RAW_REASONING_CONFIG
		});
		const threadOptions = this.buildThreadOptions(request);
		const thread = isNewSessionId(request.sessionId)
			? codex.startThread(threadOptions)
			: codex.resumeThread(request.sessionId, threadOptions);
		const accumulator = new CodexStreamAccumulator();
		let cancelled = false;
		let errorMessage = "";

		try {
			const { events } = await thread.runStreamed(request.xmlPayload, { signal: abortController.signal });
			for await (const event of events) {
				handlers.onEvent?.(this.toRawEvent(event));
				const update = accumulator.apply(event);
				if (update.liveStateChanged) {
					handlers.onLiveState?.(update.liveState);
				}
				if (update.finalContentChanged) {
					handlers.onFinalContent?.(update.finalContent);
				}
				if (event.type === "turn.failed") {
					errorMessage = event.error.message || "Codex turn failed.";
					break;
				}
				if (event.type === "error") {
					errorMessage = event.message || "Codex stream failed.";
					break;
				}
			}
		} catch (error) {
			if (isAbortError(error)) {
				cancelled = true;
			} else {
				errorMessage = formatRunError(error, executablePath);
			}
		} finally {
			if (this.activeAbortController === abortController) {
				this.activeAbortController = null;
			}
		}

		const finalContent = accumulator.getFinalContent();
		handlers.onFinalContent?.(finalContent);
		return {
			sessionId: accumulator.getResolvedSessionId() ?? thread.id ?? (isNewSessionId(request.sessionId) ? undefined : request.sessionId),
			finalContent,
			cancelled,
			errorMessage
		};
	}

	cancel(): void {
		if (!this.activeAbortController) {
			return;
		}
		this.activeAbortController.abort();
		this.activeAbortController = null;
	}

	async listSessions(): Promise<SessionSummary[]> {
		return await listKnownCodexSessions();
	}

	async renameSession(sessionId: string, title: string): Promise<void> {
		await renameCodexSession(sessionId, title);
	}

	async archiveSession(sessionId: string): Promise<void> {
		await archiveCodexSession(sessionId);
	}

	async adoptSessionMetadata(previousSessionId: string, resolvedSessionId: string): Promise<void> {
		await moveCodexSessionMetadata(previousSessionId, resolvedSessionId);
	}

	createSession(): SessionSummary {
		const timestamp = Date.now();
		const suffix = Math.random().toString(16).slice(2, 8);
		return {
			id: `${NEW_SESSION_PREFIX}${timestamp}-${suffix}`,
			title: "New session",
			label: "New session",
			updatedAt: timestamp
		};
	}

	async getModelCatalog(): Promise<ModelCatalog> {
		return await readModelCatalog();
	}

	private buildThreadOptions(request: RunRequest): ThreadOptions {
		const options: ThreadOptions = {
			skipGitRepoCheck: SKIP_GIT_REPO_CHECK
		};
		if (request.model?.trim()) {
			options.model = request.model.trim();
		}
		if (request.sandboxMode?.trim()) {
			options.sandboxMode = request.sandboxMode;
		}
		if (request.workingDirectory?.trim()) {
			options.workingDirectory = request.workingDirectory.trim();
		}
		const reasoningEffort = normalizeReasoningEffort(request.reasoningEffort);
		if (reasoningEffort) {
			options.modelReasoningEffort = reasoningEffort;
		}
		return options;
	}

	private getExecutablePath(): string {
		return this.codexBinaryPath().trim() || "codex";
	}

	private toRawEvent(event: unknown): ExecutionLogRawEvent {
		const payload = JSON.parse(JSON.stringify(event)) as Record<string, unknown>;
		return {
			timestamp: Date.now(),
			type: typeof payload.type === "string" ? payload.type : "unknown",
			payload
		};
	}
}

function normalizeReasoningEffort(value: string | undefined): ModelReasoningEffort | undefined {
	if (!value) {
		return undefined;
	}
	switch (value.trim().toLowerCase()) {
		case "minimal":
		case "low":
		case "medium":
		case "high":
		case "xhigh":
			return value.trim().toLowerCase() as ModelReasoningEffort;
		default:
			return undefined;
	}
}

function isAbortError(error: unknown): boolean {
	return error instanceof Error && (error.name === "AbortError" || error.message.includes("AbortError"));
}

function formatRunError(error: unknown, executablePath: string): string {
	if (error instanceof Error) {
		if (error.message.includes("ENOENT") || error.message.includes("spawn")) {
			return `Unable to launch Codex at "${executablePath}". Set an absolute executable path in Quick Skills settings if Obsidian cannot resolve \`codex\`.`;
		}
		return error.message;
	}
	return `Codex run failed for "${executablePath}".`;
}
