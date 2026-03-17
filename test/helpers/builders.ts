import type {
	ChatActivity,
	ChatMessage,
	ExecutionLogEntry,
	PluginData,
	SessionSummary,
	SkillDefinition,
} from "../../src/types";
import { DEFAULT_SETTINGS } from "../../src/settings";

let idCounter = 0;

export function nextId(prefix: string): string {
	idCounter += 1;
	return `${prefix}-${idCounter}`;
}

export function buildSkill(overrides: Partial<SkillDefinition> = {}): SkillDefinition {
	return {
		id: overrides.id ?? nextId("skill"),
		name: overrides.name ?? "Test skill",
		prompt: overrides.prompt ?? "Do the thing",
		reasoningEffort: overrides.reasoningEffort,
		sandboxMode: overrides.sandboxMode,
		rules: overrides.rules ?? {},
	};
}

export function buildMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
	return {
		id: overrides.id ?? nextId("message"),
		role: overrides.role ?? "assistant",
		content: overrides.content ?? "",
		timestamp: overrides.timestamp ?? 1_700_000_000_000,
		isStreaming: overrides.isStreaming,
		executionLogId: overrides.executionLogId,
		skillName: overrides.skillName,
		activeNotePath: overrides.activeNotePath,
		reasoningTrace: overrides.reasoningTrace,
		turnTrace: overrides.turnTrace,
	};
}

export function buildExecutionLogEntry(overrides: Partial<ExecutionLogEntry> = {}): ExecutionLogEntry {
	return {
		id: overrides.id ?? nextId("run"),
		timestamp: overrides.timestamp ?? 1_700_000_000_000,
		sessionId: overrides.sessionId ?? "session-1",
		requestKind: overrides.requestKind ?? "manual",
		skillName: overrides.skillName,
		prompt: overrides.prompt ?? "Prompt",
		xmlPayload: overrides.xmlPayload ?? "<xml />",
		command: overrides.command ?? "codex",
		commandArgs: overrides.commandArgs ?? [],
		processOutput: overrides.processOutput ?? "",
		rawEvents: overrides.rawEvents ?? [],
		codexConfig: overrides.codexConfig,
		response: overrides.response ?? "",
		errorMessage: overrides.errorMessage ?? "",
		durationMs: overrides.durationMs ?? 1_000,
		status: overrides.status ?? "success",
	};
}

export function buildPluginData(overrides: Partial<PluginData> = {}): PluginData {
	return {
		...DEFAULT_SETTINGS,
		...overrides,
		skills: overrides.skills ?? DEFAULT_SETTINGS.skills.map((skill) => ({ ...skill })),
		managedSessionIds: overrides.managedSessionIds ?? [...DEFAULT_SETTINGS.managedSessionIds],
		transcripts: overrides.transcripts ?? {},
		executionLog: overrides.executionLog ?? [],
	};
}

export function buildSessionSummary(overrides: Partial<SessionSummary> = {}): SessionSummary {
	return {
		id: overrides.id ?? "session-1",
		title: overrides.title ?? "Session 1",
		label: overrides.label ?? "Session 1",
		updatedAt: overrides.updatedAt ?? 1_700_000_000_000,
		startedAt: overrides.startedAt,
		workspaceLabel: overrides.workspaceLabel,
		customTitle: overrides.customTitle,
		tooltip: overrides.tooltip,
	};
}

export function buildActivity(overrides: Partial<ChatActivity> = {}): ChatActivity {
	return {
		id: overrides.id ?? nextId("activity"),
		kind: overrides.kind ?? "command_execution",
		status: overrides.status ?? "running",
		title: overrides.title ?? "Command",
		detail: overrides.detail,
	};
}
