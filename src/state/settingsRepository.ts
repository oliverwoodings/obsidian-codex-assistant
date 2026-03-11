import { DEFAULT_SETTINGS } from "../settings";
import type {
	ExecutionLogCodexConfig,
	ExecutionLogEntry,
	ExecutionLogRawEvent,
	ExecutionLogStatus,
	PluginData,
	SandboxMode,
	SkillDefinition
} from "../types";
import { createId } from "../utils/id";
import { MAX_EXECUTION_LOG_ENTRIES } from "./constants";

export class SettingsRepository {
	private readonly loadData: () => Promise<unknown>;
	private readonly saveData: (data: PluginData) => Promise<void>;
	private saveTimeoutId: number | null = null;

	constructor(options: {
		loadData: () => Promise<unknown>;
		saveData: (data: PluginData) => Promise<void>;
	}) {
		this.loadData = options.loadData;
		this.saveData = options.saveData;
	}

	async load(): Promise<PluginData> {
		return this.normalizePluginData(await this.loadData());
	}

	saveSoon(settings: PluginData): void {
		if (this.saveTimeoutId !== null) {
			return;
		}
		this.saveTimeoutId = window.setTimeout(() => {
			this.saveTimeoutId = null;
			void this.saveData(settings);
		}, 100);
	}

	async saveNow(settings: PluginData): Promise<void> {
		if (this.saveTimeoutId !== null) {
			window.clearTimeout(this.saveTimeoutId);
			this.saveTimeoutId = null;
		}
		await this.saveData(settings);
	}

	async flush(settings: PluginData): Promise<void> {
		if (this.saveTimeoutId === null) {
			return;
		}
		await this.saveNow(settings);
	}

	private normalizePluginData(value: unknown): PluginData {
		const settings = Object.assign({}, DEFAULT_SETTINGS, value as Partial<PluginData>);
		settings.skills = this.normalizeSkills(settings.skills);
		settings.transcripts = settings.transcripts ?? {};
		settings.managedSessionIds = this.normalizeManagedSessionIds(settings.managedSessionIds);
		if (settings.managedSessionIds.length === 0) {
			settings.managedSessionIds = this.normalizeManagedSessionIds(Object.keys(settings.transcripts));
		}
		if (settings.lastSessionId && !settings.managedSessionIds.includes(settings.lastSessionId)) {
			settings.lastSessionId = settings.managedSessionIds[0] ?? "";
		}
		settings.codexBinaryPath = settings.codexBinaryPath || "codex";
		settings.selectedModel = settings.selectedModel || DEFAULT_SETTINGS.selectedModel;
		settings.selectedReasoningEffort = settings.selectedReasoningEffort || DEFAULT_SETTINGS.selectedReasoningEffort;
		settings.sandboxMode = this.normalizeSandboxMode(settings.sandboxMode);
		settings.whisperBaseUrl = this.normalizeWhisperBaseUrl(settings.whisperBaseUrl);
		settings.whisperLanguage = this.normalizeWhisperLanguage(settings.whisperLanguage);
		settings.whisperRequestTimeoutMs = this.normalizeWhisperRequestTimeout(settings.whisperRequestTimeoutMs);
		settings.executionLog = this.normalizeExecutionLog(settings.executionLog);
		return settings;
	}

	private normalizeExecutionLog(entries: unknown): ExecutionLogEntry[] {
		if (!Array.isArray(entries)) {
			return [];
		}
		return entries
			.map((entry) => this.normalizeExecutionLogEntry(entry))
			.filter((entry): entry is ExecutionLogEntry => Boolean(entry))
			.slice(0, MAX_EXECUTION_LOG_ENTRIES);
	}

	private normalizeExecutionLogEntry(value: unknown): ExecutionLogEntry | null {
		if (!value || typeof value !== "object") {
			return null;
		}
		const raw = value as Partial<ExecutionLogEntry>;
		const status = this.normalizeExecutionStatus(raw.status);
		return {
			id: typeof raw.id === "string" ? raw.id : createId("run"),
			timestamp: typeof raw.timestamp === "number" ? raw.timestamp : Date.now(),
			sessionId: typeof raw.sessionId === "string" ? raw.sessionId : "",
			requestKind: raw.requestKind === "skill" ? "skill" : "manual",
			skillName: typeof raw.skillName === "string" ? raw.skillName : undefined,
			prompt: typeof raw.prompt === "string" ? raw.prompt : "",
			xmlPayload: typeof raw.xmlPayload === "string" ? raw.xmlPayload : "",
			command: typeof raw.command === "string" ? raw.command : "",
			commandArgs: Array.isArray(raw.commandArgs)
				? raw.commandArgs.filter((item): item is string => typeof item === "string")
				: [],
			processOutput: typeof raw.processOutput === "string" ? raw.processOutput : "",
			rawEvents: this.normalizeExecutionLogRawEvents(raw.rawEvents),
			codexConfig: this.normalizeExecutionLogCodexConfig(raw.codexConfig),
			response: typeof raw.response === "string" ? raw.response : "",
			errorMessage: typeof raw.errorMessage === "string" ? raw.errorMessage : "",
			durationMs: typeof raw.durationMs === "number" ? raw.durationMs : Number.NaN,
			status
		};
	}

	private normalizeExecutionLogRawEvents(value: unknown): ExecutionLogRawEvent[] {
		if (!Array.isArray(value)) {
			return [];
		}
		const events: ExecutionLogRawEvent[] = [];
		for (const entry of value) {
			if (!entry || typeof entry !== "object") {
				continue;
			}
			const raw = entry as Partial<ExecutionLogRawEvent>;
			const payload = raw.payload;
			if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
				continue;
			}
			events.push({
				timestamp: typeof raw.timestamp === "number" ? raw.timestamp : Date.now(),
				type: typeof raw.type === "string" ? raw.type : "unknown",
				payload
			});
		}
		return events;
	}

	private normalizeExecutionLogCodexConfig(value: unknown): ExecutionLogCodexConfig | undefined {
		if (!value || typeof value !== "object") {
			return undefined;
		}
		const raw = value as Partial<ExecutionLogCodexConfig>;
		if (raw.transport !== "codex-sdk" || raw.streamingProtocol !== "experimental-json") {
			return undefined;
		}
		if (typeof raw.executablePath !== "string" || typeof raw.requestedSessionId !== "string") {
			return undefined;
		}
		const configOverrides = raw.configOverrides;
		return {
			transport: "codex-sdk",
			streamingProtocol: "experimental-json",
			executablePath: raw.executablePath,
			sessionStrategy: raw.sessionStrategy === "resume" ? "resume" : "new",
			requestedSessionId: raw.requestedSessionId,
			workingDirectory: typeof raw.workingDirectory === "string" ? raw.workingDirectory : undefined,
			sandboxMode: raw.sandboxMode,
			model: typeof raw.model === "string" ? raw.model : undefined,
			reasoningEffort: typeof raw.reasoningEffort === "string" ? raw.reasoningEffort : undefined,
			skipGitRepoCheck: raw.skipGitRepoCheck === true,
			configOverrides: configOverrides && typeof configOverrides === "object" && !Array.isArray(configOverrides)
				? configOverrides
				: {}
		};
	}

	private normalizeExecutionStatus(value: unknown): ExecutionLogStatus {
		if (value === "running") {
			return "error";
		}
		if (value === "success" || value === "error" || value === "stopped") {
			return value;
		}
		return "error";
	}

	private normalizeManagedSessionIds(value: unknown): string[] {
		if (!Array.isArray(value)) {
			return [];
		}
		const normalized: string[] = [];
		for (const item of value) {
			if (typeof item !== "string") {
				continue;
			}
			const id = item.trim();
			if (!id || normalized.includes(id)) {
				continue;
			}
			normalized.push(id);
		}
		return normalized;
	}

	private normalizeSkills(value: unknown): SkillDefinition[] {
		if (!Array.isArray(value)) {
			return [...DEFAULT_SETTINGS.skills];
		}
		const normalized = value
			.map((entry) => this.normalizeSkill(entry))
			.filter((entry): entry is SkillDefinition => Boolean(entry));
		return normalized.length > 0 ? normalized : [...DEFAULT_SETTINGS.skills];
	}

	private normalizeSkill(value: unknown): SkillDefinition | null {
		if (!value || typeof value !== "object") {
			return null;
		}
		const raw = value as {
			id?: unknown;
			name?: unknown;
			prompt?: unknown;
			promptTemplate?: unknown;
			reasoningEffort?: unknown;
			sandboxMode?: unknown;
			rules?: unknown;
		};
		const id = typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : createId("skill");
		const name = typeof raw.name === "string" ? raw.name.trim() : "";
		const prompt = typeof raw.prompt === "string"
			? raw.prompt.trim()
			: (typeof raw.promptTemplate === "string" ? raw.promptTemplate.trim() : "");
		if (!name || !prompt) {
			return null;
		}
		return {
			id,
			name,
			prompt,
			reasoningEffort: typeof raw.reasoningEffort === "string" && raw.reasoningEffort.trim()
				? raw.reasoningEffort.trim()
				: undefined,
			sandboxMode: this.normalizeOptionalSandboxMode(raw.sandboxMode),
			rules: this.normalizeSkillRules(raw.rules)
		};
	}

	private normalizeSkillRules(value: unknown): SkillDefinition["rules"] {
		if (!value || typeof value !== "object") {
			return {};
		}
		const raw = value as { frontmatterTag?: unknown; frontmatterTags?: unknown; folderPrefix?: unknown };
		return {
			frontmatterTags: this.normalizeSkillTags(raw.frontmatterTags ?? raw.frontmatterTag),
			folderPrefix: typeof raw.folderPrefix === "string" && raw.folderPrefix.trim()
				? raw.folderPrefix.trim()
				: undefined
		};
	}

	private normalizeSkillTags(value: unknown): string[] | undefined {
		if (typeof value === "string") {
			const normalized = this.parseSkillTagList(value.split(","));
			return normalized.length > 0 ? normalized : undefined;
		}
		if (!Array.isArray(value)) {
			return undefined;
		}
		const normalized = this.parseSkillTagList(value);
		return normalized.length > 0 ? normalized : undefined;
	}

	private parseSkillTagList(values: unknown[]): string[] {
		const normalized: string[] = [];
		for (const entry of values) {
			if (typeof entry !== "string") {
				continue;
			}
			const tag = entry.replace(/^#/, "").trim();
			if (!tag) {
				continue;
			}
			const existingIndex = normalized.findIndex((candidate) => candidate.toLowerCase() === tag.toLowerCase());
			if (existingIndex >= 0) {
				continue;
			}
			normalized.push(tag);
		}
		return normalized;
	}

	private normalizeSandboxMode(value: unknown): SandboxMode {
		if (value === "workspace-write" || value === "danger-full-access") {
			return value;
		}
		return "read-only";
	}

	private normalizeOptionalSandboxMode(value: unknown): SandboxMode | undefined {
		if (value === "read-only" || value === "workspace-write" || value === "danger-full-access") {
			return value;
		}
		return undefined;
	}

	private normalizeWhisperBaseUrl(value: unknown): string {
		if (typeof value !== "string" || !value.trim()) {
			return DEFAULT_SETTINGS.whisperBaseUrl;
		}
		return value.trim();
	}

	private normalizeWhisperLanguage(value: unknown): string {
		return typeof value === "string" ? value.trim() : DEFAULT_SETTINGS.whisperLanguage;
	}

	private normalizeWhisperRequestTimeout(value: unknown): number {
		if (typeof value !== "number" || !Number.isFinite(value)) {
			return DEFAULT_SETTINGS.whisperRequestTimeoutMs;
		}
		const rounded = Math.round(value);
		if (rounded < 5_000) {
			return 5_000;
		}
		if (rounded > 300_000) {
			return 300_000;
		}
		return rounded;
	}
}
