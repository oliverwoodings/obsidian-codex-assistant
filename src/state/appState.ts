import type { ModelCatalog, PluginData, SessionSummary } from "../types";

export interface CodexAssistantAppState {
	settings: PluginData;
	sessions: SessionSummary[];
	activeSessionId: string;
	isRunning: boolean;
	currentAssistantMessageId: string | null;
	currentRunLogId: string | null;
	cancelRequested: boolean;
	lastFocusedNotePath: string | null;
	modelCatalog: ModelCatalog;
}
