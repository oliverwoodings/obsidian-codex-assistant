import type { PluginData, SkillDefinition } from "./types";

const DEFAULT_SKILLS: SkillDefinition[] = [
	{
		id: "summarize-note",
		name: "Summarize this note",
		prompt: "Summarize the active note and its surrounding context as concisely as possible.",
		rules: {}
	}
];

export const DEFAULT_SETTINGS: PluginData = {
	skills: DEFAULT_SKILLS,
	lastSessionId: "",
	managedSessionIds: [],
	insertMode: "cursor",
	transcripts: {},
	codexBinaryPath: "codex",
	extraPathEntries: [],
	globalInstructions: "",
	selectedModel: "gpt-5.3-codex",
	selectedReasoningEffort: "high",
	sandboxMode: "read-only",
	whisperBaseUrl: "http://127.0.0.1:8080",
	whisperLanguage: "en",
	whisperRequestTimeoutMs: 90_000,
	executionLog: []
};
