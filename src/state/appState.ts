import type { ModelCatalog, PluginData, SessionSummary } from "../types";

export interface CodexAssistantAppState {
	settings: PluginData;
	sessions: SessionSummary[];
	activeSessionId: string;
	lastFocusedNotePath: string | null;
	modelCatalog: ModelCatalog;
}
