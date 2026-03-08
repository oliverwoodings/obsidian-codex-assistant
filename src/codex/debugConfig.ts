import type { ExecutionLogCodexConfig, RunRequest } from "../types";
import { NEW_SESSION_PREFIX, RAW_REASONING_CONFIG, SKIP_GIT_REPO_CHECK } from "./constants";

export function isNewSessionId(sessionId: string): boolean {
	return sessionId.startsWith(NEW_SESSION_PREFIX);
}

export function buildCodexDebugConfig(
	request: RunRequest,
	executablePath: string
): { command: string; commandArgs: string[]; config: ExecutionLogCodexConfig } {
	const sanitizedExecutablePath = executablePath.trim() || "codex";
	const commandArgs = ["exec", "--experimental-json"];
	for (const override of serializeConfigOverrides(RAW_REASONING_CONFIG)) {
		commandArgs.push("--config", override);
	}
	if (request.model?.trim()) {
		commandArgs.push("--model", request.model.trim());
	}
	if (request.sandboxMode?.trim()) {
		commandArgs.push("--sandbox", request.sandboxMode.trim());
	}
	if (request.workingDirectory?.trim()) {
		commandArgs.push("--cd", request.workingDirectory.trim());
	}
	if (SKIP_GIT_REPO_CHECK) {
		commandArgs.push("--skip-git-repo-check");
	}
	if (request.reasoningEffort?.trim()) {
		commandArgs.push("--config", `model_reasoning_effort="${request.reasoningEffort.trim()}"`);
	}
	if (!isNewSessionId(request.sessionId)) {
		commandArgs.push("resume", request.sessionId);
	}
	const config: ExecutionLogCodexConfig = {
		transport: "codex-sdk",
		streamingProtocol: "experimental-json",
		executablePath: sanitizedExecutablePath,
		sessionStrategy: isNewSessionId(request.sessionId) ? "new" : "resume",
		requestedSessionId: request.sessionId,
		workingDirectory: normalizeOptionalString(request.workingDirectory),
		sandboxMode: request.sandboxMode,
		model: normalizeOptionalString(request.model),
		reasoningEffort: normalizeOptionalString(request.reasoningEffort),
		skipGitRepoCheck: SKIP_GIT_REPO_CHECK,
		configOverrides: RAW_REASONING_CONFIG
	};
	return {
		command: sanitizedExecutablePath,
		commandArgs,
		config
	};
}

function serializeConfigOverrides(config: Record<string, unknown>): string[] {
	const overrides: string[] = [];
	flattenConfigOverrides(config, "", overrides);
	return overrides;
}

function flattenConfigOverrides(value: unknown, prefix: string, overrides: string[]): void {
	if (!isPlainObject(value)) {
		if (!prefix) {
			throw new Error("Codex config overrides must be a plain object");
		}
		overrides.push(`${prefix}=${toTomlValue(value, prefix)}`);
		return;
	}
	const entries = Object.entries(value);
	if (!prefix && entries.length === 0) {
		return;
	}
	if (prefix && entries.length === 0) {
		overrides.push(`${prefix}={}`);
		return;
	}
	for (const [key, child] of entries) {
		if (!key || child === undefined) {
			continue;
		}
		const nextPath = prefix ? `${prefix}.${key}` : key;
		if (isPlainObject(child)) {
			flattenConfigOverrides(child, nextPath, overrides);
			continue;
		}
		overrides.push(`${nextPath}=${toTomlValue(child, nextPath)}`);
	}
}

function toTomlValue(value: unknown, path: string): string {
	if (typeof value === "string") {
		return JSON.stringify(value);
	}
	if (typeof value === "number") {
		if (!Number.isFinite(value)) {
			throw new Error(`Codex config override at ${path} must be a finite number`);
		}
		return String(value);
	}
	if (typeof value === "boolean") {
		return value ? "true" : "false";
	}
	if (Array.isArray(value)) {
		const rendered = value.map((entry, index) => toTomlValue(entry, `${path}[${index}]`));
		return `[${rendered.join(", ")}]`;
	}
	if (isPlainObject(value)) {
		const parts: string[] = [];
		for (const [key, child] of Object.entries(value)) {
			if (!key || child === undefined) {
				continue;
			}
			parts.push(`${formatTomlKey(key)} = ${toTomlValue(child, `${path}.${key}`)}`);
		}
		return `{${parts.join(", ")}}`;
	}
	throw new Error(`Unsupported Codex config override value at ${path}`);
}

function formatTomlKey(key: string): string {
	return /^[A-Za-z0-9_-]+$/u.test(key) ? key : JSON.stringify(key);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeOptionalString(value: string | undefined): string | undefined {
	const normalized = value?.trim();
	return normalized ? normalized : undefined;
}
