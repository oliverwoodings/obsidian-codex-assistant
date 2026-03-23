import type { ModelCatalog, SessionSummary } from "../types";
import { readModelCatalog } from "./modelCatalog";
import { archiveCodexSession, listKnownCodexSessions, moveCodexSessionMetadata, renameCodexSession } from "./sessionMetadata";
import { NEW_SESSION_PREFIX } from "./constants";

export class CodexService {
	constructor(_codexBinaryPath: () => string) {
		// Intentionally ignored. The workspace service no longer owns execution state.
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
}
