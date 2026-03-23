import type { App } from "obsidian";
import type { CodexService } from "../codex/service";
import type { CodexLiveState } from "../codex/streamAccumulator";
import type { ChatMessage, SessionSummary } from "../types";
import type { CodexAssistantAppState } from "./appState";
import type { SettingsRepository } from "./settingsRepository";
import type { AppViewUpdate } from "./uiChange";

export class SessionStore {
	private readonly app: App;
	private readonly state: CodexAssistantAppState;
	private readonly codex: CodexService;
	private readonly settingsRepository: SettingsRepository;
	private readonly notifyUi: (change: AppViewUpdate) => void;

	constructor(options: {
		app: App;
		state: CodexAssistantAppState;
		codex: CodexService;
		settingsRepository: SettingsRepository;
		notifyUi: (change: AppViewUpdate) => void;
	}) {
		this.app = options.app;
		this.state = options.state;
		this.codex = options.codex;
		this.settingsRepository = options.settingsRepository;
		this.notifyUi = options.notifyUi;
	}

	async createAndSelectSession(): Promise<SessionSummary> {
		const created = this.codex.createSession();
		this.registerManagedSessionId(created.id);
		this.upsertSession(created);
		await this.setActiveSession(created.id);
		return created;
	}

	async setActiveSession(sessionId: string): Promise<void> {
		if (!this.isManagedSessionId(sessionId)) {
			return;
		}
		this.state.activeSessionId = sessionId;
		this.registerManagedSessionId(sessionId);
		this.state.settings.lastSessionId = sessionId;
		if (!this.state.settings.transcripts[sessionId]) {
			this.state.settings.transcripts[sessionId] = [];
		}
		await this.settingsRepository.saveNow(this.state.settings);
		this.notifyUi("all");
	}

	getCurrentTranscript(): ChatMessage[] {
		if (!this.state.activeSessionId) {
			return [];
		}
		return this.state.settings.transcripts[this.state.activeSessionId] ?? [];
	}

	getActiveSessionSummary(): SessionSummary | undefined {
		return this.state.sessions.find((session) => session.id === this.state.activeSessionId);
	}

	appendMessage(message: ChatMessage): void {
		if (!this.state.activeSessionId) {
			return;
		}
		if (!this.state.settings.transcripts[this.state.activeSessionId]) {
			this.state.settings.transcripts[this.state.activeSessionId] = [];
		}
		this.state.settings.transcripts[this.state.activeSessionId]?.push(message);
		this.settingsRepository.saveSoon(this.state.settings);
		this.notifyUi("transcript");
	}

	replaceAssistantMessage(messageId: string, content: string): void {
		const message = this.findMessageById(messageId);
		if (!message) {
			return;
		}
		message.content = content;
		this.settingsRepository.saveSoon(this.state.settings);
		this.notifyUi("transcript");
	}

	setAssistantLiveState(messageId: string, liveState: CodexLiveState): void {
		const message = this.findMessageById(messageId);
		if (!message) {
			return;
		}
		if (liveState.traceItems.length > 0) {
			message.turnTrace = {
				items: liveState.traceItems.map((item) => ({
					id: item.id,
					kind: item.kind,
					text: item.text,
					activity: item.activity ? { ...item.activity } : undefined,
					isDraft: item.isDraft
				})),
				durationMs: message.turnTrace?.durationMs
			};
		} else if (message.turnTrace) {
			delete message.turnTrace;
		}
		this.settingsRepository.saveSoon(this.state.settings);
		this.notifyUi("transcript");
	}

	finishAssistantMessage(messageId: string): void {
		const message = this.findMessageById(messageId);
		if (message) {
			message.isStreaming = false;
		}
		this.settingsRepository.saveSoon(this.state.settings);
		this.notifyUi("transcript");
	}

	setAssistantTurnDuration(messageId: string, durationMs: number): void {
		const message = this.findMessageById(messageId);
		if (!message?.turnTrace) {
			return;
		}
		message.turnTrace.durationMs = durationMs;
		this.settingsRepository.saveSoon(this.state.settings);
		this.notifyUi("transcript");
	}

	findMessageById(messageId: string): ChatMessage | null {
		for (const transcript of Object.values(this.state.settings.transcripts)) {
			const found = transcript.find((message) => message.id === messageId);
			if (found) {
				return found;
			}
		}
		return null;
	}

	async refreshSessions(): Promise<void> {
		const discoveredSessions = await this.codex.listSessions();
		const discoveredById = new Map(discoveredSessions.map((session) => [session.id, session]));
		const managedIds = this.state.settings.managedSessionIds.filter(
			(id, index, values) => id.length > 0 && values.indexOf(id) === index
		);

		this.state.sessions = managedIds.map((id) => this.buildManagedSessionSummary(id, discoveredById.get(id)));

		if (this.state.sessions.length === 0) {
			const created = this.codex.createSession();
			this.registerManagedSessionId(created.id);
			this.state.sessions = [created];
		}
		const fallbackSession = this.state.sessions[0];
		if (!fallbackSession) {
			return;
		}
		const selected = this.state.settings.lastSessionId && this.isManagedSessionId(this.state.settings.lastSessionId)
			? this.state.settings.lastSessionId
			: fallbackSession.id;
		await this.setActiveSession(selected);
	}

	async adoptResolvedSessionId(previousSessionId: string, resolvedSessionId: string): Promise<void> {
		if (previousSessionId === resolvedSessionId) {
			return;
		}
		await this.codex.adoptSessionMetadata(previousSessionId, resolvedSessionId);
		const previousTranscript = this.state.settings.transcripts[previousSessionId];
		const resolvedTranscript = this.state.settings.transcripts[resolvedSessionId] ?? [];
		if (previousTranscript?.length) {
			this.state.settings.transcripts[resolvedSessionId] = [...resolvedTranscript, ...previousTranscript];
		} else if (!this.state.settings.transcripts[resolvedSessionId]) {
			this.state.settings.transcripts[resolvedSessionId] = [];
		}
		if (previousSessionId in this.state.settings.transcripts) {
			delete this.state.settings.transcripts[previousSessionId];
		}

		if (this.state.activeSessionId === previousSessionId) {
			this.state.activeSessionId = resolvedSessionId;
		}
		if (this.state.settings.lastSessionId === previousSessionId) {
			this.state.settings.lastSessionId = resolvedSessionId;
		}
		this.replaceManagedSessionId(previousSessionId, resolvedSessionId);

		this.state.sessions = this.state.sessions.filter((entry) => entry.id !== previousSessionId);
		const discoveredSession = (await this.codex.listSessions()).find((session) => session.id === resolvedSessionId);
		this.upsertSession(this.buildManagedSessionSummary(resolvedSessionId, discoveredSession));
	}

	async renameSession(sessionId: string, title: string): Promise<void> {
		const normalizedTitle = title.trim();
		if (!sessionId || !normalizedTitle) {
			return;
		}
		await this.codex.renameSession(sessionId, normalizedTitle);
		await this.refreshSessions();
	}

	async archiveSession(sessionId: string): Promise<void> {
		if (!sessionId) {
			return;
		}
		await this.codex.archiveSession(sessionId);
		delete this.state.settings.transcripts[sessionId];
		this.unregisterManagedSessionId(sessionId);
		if (this.state.activeSessionId === sessionId) {
			this.state.activeSessionId = "";
		}
		if (this.state.settings.lastSessionId === sessionId) {
			this.state.settings.lastSessionId = "";
		}
		this.state.sessions = this.state.sessions.filter((session) => session.id !== sessionId);
		await this.refreshSessions();
	}

	private upsertSession(session: SessionSummary): void {
		const existingIndex = this.state.sessions.findIndex((entry) => entry.id === session.id);
		if (existingIndex >= 0) {
			this.state.sessions[existingIndex] = session;
			return;
		}
		this.state.sessions = [session, ...this.state.sessions.filter((entry) => entry.id !== session.id)];
	}

	private isManagedSessionId(sessionId: string): boolean {
		return this.state.settings.managedSessionIds.includes(sessionId);
	}

	private registerManagedSessionId(sessionId: string, prepend = true): void {
		if (!sessionId) {
			return;
		}
		const existing = this.state.settings.managedSessionIds.filter((id) => id !== sessionId);
		this.state.settings.managedSessionIds = prepend
			? [sessionId, ...existing]
			: [...existing, sessionId];
	}

	private unregisterManagedSessionId(sessionId: string): void {
		this.state.settings.managedSessionIds = this.state.settings.managedSessionIds.filter((id) => id !== sessionId);
	}

	private replaceManagedSessionId(previousSessionId: string, resolvedSessionId: string): void {
		if (!resolvedSessionId) {
			return;
		}
		const nextIds: string[] = [];
		let replaced = false;
		for (const sessionId of this.state.settings.managedSessionIds) {
			if (sessionId === previousSessionId) {
				if (!nextIds.includes(resolvedSessionId)) {
					nextIds.push(resolvedSessionId);
				}
				replaced = true;
				continue;
			}
			if (sessionId === resolvedSessionId || nextIds.includes(sessionId)) {
				continue;
			}
			nextIds.push(sessionId);
		}
		if (!replaced && !nextIds.includes(resolvedSessionId)) {
			nextIds.unshift(resolvedSessionId);
		}
		this.state.settings.managedSessionIds = nextIds;
	}

	private buildManagedSessionSummary(sessionId: string, discovered?: SessionSummary): SessionSummary {
		const transcript = this.state.settings.transcripts[sessionId] ?? [];
		const lastMessage = transcript.length > 0 ? transcript[transcript.length - 1] : undefined;
		const updatedAt = discovered?.updatedAt ?? lastMessage?.timestamp ?? this.extractTimestampFromSessionId(sessionId) ?? Date.now();
		const startedAt = discovered?.startedAt ?? transcript[0]?.timestamp ?? this.extractTimestampFromSessionId(sessionId);
		const workspaceLabel = discovered?.workspaceLabel;
		const customTitle = discovered?.customTitle;
		const title = this.buildSessionTitle(sessionId, transcript, workspaceLabel, customTitle);
		return {
			id: sessionId,
			title,
			label: this.buildSessionDisplayLabel(title, updatedAt),
			updatedAt,
			startedAt,
			workspaceLabel,
			customTitle,
			tooltip: this.buildSessionTooltip(sessionId, updatedAt, startedAt, workspaceLabel, customTitle, discovered?.tooltip)
		};
	}

	private buildSessionTitle(
		sessionId: string,
		transcript: ChatMessage[],
		workspaceLabel: string | undefined,
		customTitle: string | undefined
	): string {
		return customTitle
			|| this.deriveSessionTitle(transcript)
			|| workspaceLabel
			|| this.fallbackSessionTitle(sessionId);
	}

	private buildSessionDisplayLabel(title: string, updatedAt: number | undefined): string {
		const timestampLabel = updatedAt ? this.formatSessionTimestamp(updatedAt) : "";
		return timestampLabel ? `${title} · ${timestampLabel}` : title;
	}

	private buildSessionTooltip(
		sessionId: string,
		updatedAt: number | undefined,
		startedAt: number | undefined,
		workspaceLabel: string | undefined,
		customTitle: string | undefined,
		sourceTooltip?: string
	): string {
		const parts = [
			`Session ID: ${sessionId}`,
			customTitle ? `Name: ${customTitle}` : "",
			workspaceLabel ? `Workspace: ${workspaceLabel}` : "",
			startedAt ? `Started: ${new Date(startedAt).toLocaleString()}` : "",
			updatedAt ? `Updated: ${new Date(updatedAt).toLocaleString()}` : "",
			sourceTooltip ?? ""
		].filter((value) => value.length > 0);
		return parts.join("\n");
	}

	private deriveSessionTitle(transcript: ChatMessage[]): string | undefined {
		for (const message of transcript) {
			if (message.role === "skill" && message.skillName?.trim()) {
				return `Skill: ${message.skillName.trim()}`;
			}
			if (message.role === "user") {
				const summary = this.summarizeSessionText(message.content);
				if (summary) {
					return summary;
				}
			}
		}
		return undefined;
	}

	private summarizeSessionText(value: string): string | undefined {
		const normalized = value
			.replace(/\s+/gu, " ")
			.replace(/^#+\s*/u, "")
			.trim();
		if (!normalized) {
			return undefined;
		}
		return normalized.length > 48 ? `${normalized.slice(0, 45).trimEnd()}...` : normalized;
	}

	private fallbackSessionTitle(sessionId: string): string {
		if (sessionId.startsWith("new-session-") || sessionId.startsWith("session-")) {
			return "New session";
		}
		if (sessionId.length > 12) {
			return sessionId.slice(0, 12);
		}
		return sessionId;
	}

	private formatSessionTimestamp(timestamp: number): string {
		const date = new Date(timestamp);
		const now = new Date();
		const sameYear = date.getFullYear() === now.getFullYear();
		return date.toLocaleString([], sameYear
			? { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }
			: { year: "numeric", month: "short", day: "numeric" });
	}

	private extractTimestampFromSessionId(sessionId: string): number | undefined {
		const prefixedMatch = sessionId.match(/^(?:new-session|session)-(\d{10,})/u);
		if (prefixedMatch?.[1]) {
			const parsed = Number(prefixedMatch[1]);
			return Number.isFinite(parsed) ? parsed : undefined;
		}
		return undefined;
	}
}
