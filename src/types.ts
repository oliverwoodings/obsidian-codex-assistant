export type MessageRole = "user" | "assistant" | "error" | "skill";

export interface ChatMessage {
	id: string;
	role: MessageRole;
	content: string;
	timestamp: number;
	isStreaming?: boolean;
	skillName?: string;
	activeNotePath?: string;
	reasoningPreview?: string;
	reasoningTrace?: string;
	draftPreview?: string;
	activities?: ChatActivity[];
	turnTrace?: ChatTurnTrace;
}

export interface ChatTurnTrace {
	reasoningText?: string;
	completedMessages?: string[];
	activities?: ChatActivity[];
}

export type ChatActivityKind =
	| "command_execution"
	| "todo_list"
	| "web_search"
	| "mcp_tool_call"
	| "file_change"
	| "error";

export type ChatActivityStatus = "running" | "completed" | "failed" | "info";

export interface ChatActivity {
	id: string;
	kind: ChatActivityKind;
	status: ChatActivityStatus;
	title: string;
	detail?: string;
}

export interface SkillRuleSet {
	frontmatterTags?: string[];
	folderPrefix?: string;
}

export interface SkillDefinition {
	id: string;
	name: string;
	prompt: string;
	reasoningEffort?: string;
	sandboxMode?: SandboxMode;
	rules?: SkillRuleSet;
}

export interface SessionSummary {
	id: string;
	title?: string;
	label: string;
	updatedAt?: number;
	startedAt?: number;
	workspaceLabel?: string;
	customTitle?: string;
	tooltip?: string;
}

export interface ModelOption {
	id: string;
	label: string;
	reasoningEfforts: string[];
	defaultReasoningEffort?: string;
}

export interface ModelCatalog {
	models: ModelOption[];
	defaultModelId?: string;
	defaultReasoningEffort?: string;
}

export interface RunRequest {
	xmlPayload: string;
	sessionId: string;
	model?: string;
	reasoningEffort?: string;
	sandboxMode?: SandboxMode;
	workingDirectory?: string;
}

export interface SessionContext {
	vaultRootPath: string;
	activeFilePath: string;
	activeNotePath: string;
	openNotePaths: string[];
	selectedText: string;
}

export type ExecutionLogStatus = "running" | "success" | "error" | "stopped";
export type ExecutionLogRequestKind = "manual" | "skill";
export type SandboxMode = "read-only" | "workspace-write" | "danger-full-access";

export interface ExecutionLogRawEvent {
	timestamp: number;
	type: string;
	payload: Record<string, unknown>;
}

export interface ExecutionLogCodexConfig {
	transport: "codex-sdk";
	streamingProtocol: "experimental-json";
	executablePath: string;
	sessionStrategy: "new" | "resume";
	requestedSessionId: string;
	workingDirectory?: string;
	sandboxMode?: SandboxMode;
	model?: string;
	reasoningEffort?: string;
	skipGitRepoCheck: boolean;
	configOverrides: Record<string, unknown>;
}

export interface ExecutionLogEntry {
	id: string;
	timestamp: number;
	sessionId: string;
	requestKind: ExecutionLogRequestKind;
	skillName?: string;
	prompt: string;
	xmlPayload: string;
	command: string;
	commandArgs: string[];
	processOutput: string;
	rawEvents: ExecutionLogRawEvent[];
	codexConfig?: ExecutionLogCodexConfig;
	response: string;
	errorMessage: string;
	durationMs: number;
	status: ExecutionLogStatus;
}

export interface PluginData {
	skills: SkillDefinition[];
	lastSessionId: string;
	managedSessionIds: string[];
	insertMode: "cursor" | "append";
	transcripts: Record<string, ChatMessage[]>;
	codexBinaryPath: string;
	selectedModel: string;
	selectedReasoningEffort: string;
	sandboxMode: SandboxMode;
	executionLog: ExecutionLogEntry[];
}
