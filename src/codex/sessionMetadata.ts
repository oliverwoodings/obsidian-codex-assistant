import type { Dirent } from "fs";
import { mkdir, open, readFile, readdir, stat, writeFile } from "fs/promises";
import { homedir } from "os";
import { basename, join } from "path";
import type { SessionSummary } from "../types";
import { SESSION_LIST_LIMIT } from "./constants";

interface SessionFile {
	id: string;
	updatedAt: number;
	startedAt?: number;
	workspaceLabel?: string;
	customTitle?: string;
	tooltip?: string;
}

interface SessionMetaPayload {
	timestamp?: string;
	cwd?: string;
	originator?: string;
}

interface SessionOverride {
	name?: string;
	archived?: boolean;
	updatedAt?: number;
}

interface SessionOverridesFile {
	version: 1;
	sessions: Record<string, SessionOverride>;
}

const SESSION_ROOT = join(homedir(), ".codex", "sessions");
const SESSION_OVERRIDES_PATH = join(SESSION_ROOT, "quick-skills-session-overrides.json");

export async function listKnownCodexSessions(): Promise<SessionSummary[]> {
	const [rolloutFiles, overrides] = await Promise.all([
		walkRolloutFiles(SESSION_ROOT),
		readSessionOverrides()
	]);
	const byId = new Map<string, SessionFile>();
	for (const filePath of rolloutFiles) {
		const id = extractSessionId(filePath);
		if (!id) {
			continue;
		}
		let updatedAt = 0;
		try {
			const fileStats = await stat(filePath);
			updatedAt = fileStats.mtimeMs;
		} catch {
			continue;
		}
		const meta = await readSessionMeta(filePath);
		const current = byId.get(id);
		if (!current || updatedAt > current.updatedAt) {
			byId.set(id, {
				id,
				updatedAt,
				startedAt: meta.startedAt,
				workspaceLabel: meta.workspaceLabel,
				tooltip: meta.tooltip
			});
		}
	}
	for (const [id, override] of Object.entries(overrides.sessions)) {
		if (!id.trim()) {
			continue;
		}
		if (override.archived) {
			byId.delete(id);
			continue;
		}
		const existing = byId.get(id);
		const mergedUpdatedAt = override.updatedAt ?? existing?.updatedAt ?? Date.now();
		byId.set(id, {
			id,
			updatedAt: mergedUpdatedAt,
			startedAt: existing?.startedAt,
			workspaceLabel: existing?.workspaceLabel,
			customTitle: normalizeOverrideName(override.name) ?? existing?.customTitle,
			tooltip: existing?.tooltip
		});
	}
	return Array.from(byId.values())
		.sort((a, b) => b.updatedAt - a.updatedAt)
		.slice(0, SESSION_LIST_LIMIT)
		.map((session) => ({
			id: session.id,
			title: session.customTitle || session.workspaceLabel || session.id,
			label: session.customTitle || session.workspaceLabel || session.id,
			updatedAt: session.updatedAt,
			startedAt: session.startedAt,
			workspaceLabel: session.workspaceLabel,
			customTitle: session.customTitle,
			tooltip: session.tooltip
		}));
}

export async function renameCodexSession(sessionId: string, title: string): Promise<void> {
	const normalizedTitle = normalizeOverrideName(title);
	if (!sessionId.trim() || !normalizedTitle) {
		return;
	}
	await updateSessionOverride(sessionId, (current) => ({
		...current,
		name: normalizedTitle,
		archived: false,
		updatedAt: Date.now()
	}));
}

export async function archiveCodexSession(sessionId: string): Promise<void> {
	if (!sessionId.trim()) {
		return;
	}
	await updateSessionOverride(sessionId, (current) => ({
		...current,
		archived: true,
		updatedAt: Date.now()
	}));
}

export async function moveCodexSessionMetadata(previousSessionId: string, resolvedSessionId: string): Promise<void> {
	if (!previousSessionId.trim() || !resolvedSessionId.trim() || previousSessionId === resolvedSessionId) {
		return;
	}
	const overrides = await readSessionOverrides();
	const previous = overrides.sessions[previousSessionId];
	if (!previous) {
		return;
	}
	const existingResolved = overrides.sessions[resolvedSessionId] ?? {};
	overrides.sessions[resolvedSessionId] = {
		...existingResolved,
		...previous,
		updatedAt: previous.updatedAt ?? Date.now()
	};
	delete overrides.sessions[previousSessionId];
	await writeSessionOverrides(overrides);
}

async function walkRolloutFiles(root: string): Promise<string[]> {
	const files: string[] = [];
	const stack = [root];
	while (stack.length > 0) {
		const current = stack.pop();
		if (!current) {
			continue;
		}
		let entries: Dirent[];
		try {
			entries = await readdir(current, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const entry of entries) {
			const entryPath = join(current, entry.name);
			if (entry.isDirectory()) {
				stack.push(entryPath);
				continue;
			}
			if (entry.isFile() && entry.name.startsWith("rollout-") && entry.name.endsWith(".jsonl")) {
				files.push(entryPath);
			}
		}
	}
	return files;
}

function extractSessionId(filePath: string): string | null {
	const match = filePath.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/iu);
	return match?.[1] ?? null;
}

async function readSessionMeta(filePath: string): Promise<{
	startedAt?: number;
	workspaceLabel?: string;
	tooltip?: string;
}> {
	let fileHandle: Awaited<ReturnType<typeof open>> | null = null;
	try {
		fileHandle = await open(filePath, "r");
		const buffer = new Uint8Array(8192);
		const { bytesRead } = await fileHandle.read(buffer, 0, buffer.length, 0);
		const rawText = new TextDecoder().decode(buffer.subarray(0, bytesRead));
		const firstLine = rawText.split("\n", 1)[0];
		if (!firstLine) {
			return {};
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(firstLine);
		} catch {
			return {};
		}
		if (!parsed || typeof parsed !== "object") {
			return {};
		}
		const payload = (parsed as { payload?: unknown }).payload;
		if (!payload || typeof payload !== "object") {
			return {};
		}
		const sessionMeta = payload as SessionMetaPayload;
		const startedAt = parseTimestamp(sessionMeta.timestamp);
		const workspaceLabel = normalizeWorkspaceLabel(sessionMeta.cwd);
		const tooltipParts = [
			sessionMeta.cwd ? `Path: ${sessionMeta.cwd}` : "",
			sessionMeta.originator ? `Origin: ${sessionMeta.originator}` : "",
		].filter((value) => value.length > 0);
		return {
			startedAt,
			workspaceLabel,
			tooltip: tooltipParts.length > 0 ? tooltipParts.join("\n") : undefined
		};
	} catch {
		return {};
	} finally {
		await fileHandle?.close();
	}
}

function parseTimestamp(value: string | undefined): number | undefined {
	if (!value) {
		return undefined;
	}
	const parsed = Date.parse(value);
	return Number.isNaN(parsed) ? undefined : parsed;
}

function normalizeWorkspaceLabel(cwd: string | undefined): string | undefined {
	if (!cwd?.trim()) {
		return undefined;
	}
	const label = basename(cwd.trim());
	return label || undefined;
}

async function readSessionOverrides(): Promise<SessionOverridesFile> {
	try {
		const raw = await readFile(SESSION_OVERRIDES_PATH, "utf8");
		const parsed = JSON.parse(raw) as Partial<SessionOverridesFile>;
		const sessions = parsed.sessions;
		if (!sessions || typeof sessions !== "object" || Array.isArray(sessions)) {
			return emptySessionOverrides();
		}
		const normalizedEntries = Object.entries(sessions).map(([id, override]) => {
			if (!override || typeof override !== "object" || Array.isArray(override)) {
				return [id, {}] as const;
			}
			return [id, {
				name: normalizeOverrideName(override.name),
				archived: override.archived === true,
				updatedAt: typeof override.updatedAt === "number" ? override.updatedAt : undefined
			}] as const;
		});
		return {
			version: 1,
			sessions: Object.fromEntries(normalizedEntries)
		};
	} catch {
		return emptySessionOverrides();
	}
}

async function writeSessionOverrides(overrides: SessionOverridesFile): Promise<void> {
	await ensureSessionRoot();
	const payload = JSON.stringify(overrides, null, 2);
	await writeFile(SESSION_OVERRIDES_PATH, payload, "utf8");
}

async function updateSessionOverride(
	sessionId: string,
	buildNext: (current: SessionOverride | undefined) => SessionOverride
): Promise<void> {
	const overrides = await readSessionOverrides();
	overrides.sessions[sessionId] = buildNext(overrides.sessions[sessionId]);
	await writeSessionOverrides(overrides);
}

function emptySessionOverrides(): SessionOverridesFile {
	return {
		version: 1,
		sessions: {}
	};
}

async function ensureSessionRoot(): Promise<void> {
	await mkdir(SESSION_ROOT, { recursive: true });
}

function normalizeOverrideName(value: string | undefined): string | undefined {
	if (!value?.trim()) {
		return undefined;
	}
	return value.trim();
}
