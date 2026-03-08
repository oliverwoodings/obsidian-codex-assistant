import type { ModelOption } from "../types";

export const NEW_SESSION_PREFIX = "new-session-";
export const SESSION_LIST_LIMIT = 50;
export const SKIP_GIT_REPO_CHECK = true;
export const RAW_REASONING_CONFIG = {
	show_raw_agent_reasoning: true
} as const;
export const DEFAULT_REASONING_EFFORTS = ["low", "medium", "high", "xhigh"];

export const FALLBACK_MODELS: ModelOption[] = [
	{
		id: "gpt-5.3-codex",
		label: "GPT-5.3-Codex",
		reasoningEfforts: DEFAULT_REASONING_EFFORTS,
		defaultReasoningEffort: "high"
	},
	{
		id: "gpt-5.2-codex",
		label: "GPT-5.2-Codex",
		reasoningEfforts: DEFAULT_REASONING_EFFORTS,
		defaultReasoningEffort: "high"
	},
	{
		id: "gpt-5.1-codex-max",
		label: "GPT-5.1-Codex-Max",
		reasoningEfforts: DEFAULT_REASONING_EFFORTS,
		defaultReasoningEffort: "high"
	},
	{
		id: "gpt-5.2",
		label: "GPT-5.2",
		reasoningEfforts: DEFAULT_REASONING_EFFORTS,
		defaultReasoningEffort: "high"
	},
	{
		id: "gpt-5.1-codex-mini",
		label: "GPT-5.1-Codex-Mini",
		reasoningEfforts: DEFAULT_REASONING_EFFORTS,
		defaultReasoningEffort: "high"
	}
];
