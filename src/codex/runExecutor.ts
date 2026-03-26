import { Codex, type ModelReasoningEffort, type ThreadOptions } from "@openai/codex-sdk";
import type { ExecutionLogCodexConfig, ExecutionLogRawEvent, RunRequest } from "../types";
import { buildCodexDebugConfig, isNewSessionId } from "./debugConfig";
import { CodexStreamAccumulator, type CodexLiveState } from "./streamAccumulator";
import { RAW_REASONING_CONFIG, SKIP_GIT_REPO_CHECK } from "./constants";

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

export interface CodexRunHandle {
	cancel: () => void;
	promise: Promise<CodexRunResult>;
}

export class CodexRunExecutor {
	private readonly codexBinaryPath: () => string;
	private readonly extraPathEntries: () => string[];

	constructor(codexBinaryPath: () => string, extraPathEntries: () => string[] = () => []) {
		this.codexBinaryPath = codexBinaryPath;
		this.extraPathEntries = extraPathEntries;
	}

	startRun(request: RunRequest, handlers: CodexRunHandlers): CodexRunHandle {
		const abortController = new AbortController();
		return {
			cancel: () => {
				abortController.abort();
			},
			promise: this.run(request, handlers, abortController)
		};
	}

	private async run(request: RunRequest, handlers: CodexRunHandlers, abortController: AbortController): Promise<CodexRunResult> {
		const executablePath = this.getExecutablePath();
		const invocation = buildCodexDebugConfig(request, executablePath);
		handlers.onInvocation?.(invocation.command, invocation.commandArgs, invocation.config);

		const codex = new Codex({
			codexPathOverride: executablePath,
			env: buildCodexEnvironment(this.extraPathEntries()),
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

export function buildCodexEnvironment(extraPathEntries: string[]): Record<string, string> {
	const env = copyProcessEnvironment();
	const mergedPath = mergePathEntries(extraPathEntries, env.PATH);
	if (mergedPath) {
		env.PATH = mergedPath;
	}
	return env;
}

function copyProcessEnvironment(): Record<string, string> {
	const env: Record<string, string> = {};
	for (const [key, value] of Object.entries(process.env)) {
		if (value !== undefined) {
			env[key] = value;
		}
	}
	return env;
}

function mergePathEntries(extraPathEntries: string[], existingPath: string | undefined): string {
	const pathDelimiter = process.platform === "win32" ? ";" : ":";
	const normalized = extraPathEntries
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0);
	const existingEntries = (existingPath ?? "")
		.split(pathDelimiter)
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0);
	const merged = new Set<string>([...normalized, ...existingEntries]);
	return Array.from(merged).join(pathDelimiter);
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
			return `Unable to launch Codex at "${executablePath}". Set an absolute executable path in Codex Assistant settings if Obsidian cannot resolve \`codex\`.`;
		}
		return error.message;
	}
	return `Codex run failed for "${executablePath}".`;
}
