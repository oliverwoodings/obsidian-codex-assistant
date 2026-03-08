import { readFile } from "fs/promises";
import { homedir } from "os";
import { join } from "path";
import type { ModelCatalog, ModelOption } from "../types";
import { DEFAULT_REASONING_EFFORTS, FALLBACK_MODELS } from "./constants";

interface RawModel {
	slug?: string;
	display_name?: string;
	priority?: number;
	visibility?: string;
	default_reasoning_level?: string;
	supported_reasoning_levels?: Array<{ effort?: string } | string>;
}

export async function readModelCatalog(): Promise<ModelCatalog> {
	const discoveredModels = await readModelsFromCache();
	const defaults = await readDefaultsFromConfig();
	return {
		models: discoveredModels.length > 0 ? discoveredModels : FALLBACK_MODELS,
		defaultModelId: defaults.model,
		defaultReasoningEffort: defaults.reasoningEffort
	};
}

async function readModelsFromCache(): Promise<ModelOption[]> {
	const cachePath = join(homedir(), ".codex", "models_cache.json");
	let rawText = "";
	try {
		rawText = await readFile(cachePath, "utf8");
	} catch {
		return [];
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(rawText);
	} catch {
		return [];
	}
	if (!parsed || typeof parsed !== "object") {
		return [];
	}
	const rawModels = (parsed as { models?: unknown }).models;
	if (!Array.isArray(rawModels)) {
		return [];
	}

	const candidates: Array<{ option: ModelOption; priority: number; index: number }> = [];
	for (let index = 0; index < rawModels.length; index += 1) {
		const rawModel = rawModels[index] as RawModel;
		const slug = rawModel?.slug?.trim();
		if (!slug || rawModel.visibility === "hidden") {
			continue;
		}
		const reasoningEfforts = parseReasoningEfforts(rawModel.supported_reasoning_levels);
		const defaultReasoningEffort = normalizeReasoningEffort(rawModel.default_reasoning_level);
		candidates.push({
			option: {
				id: slug,
				label: formatModelLabel(rawModel.display_name ?? slug),
				reasoningEfforts: reasoningEfforts.length > 0 ? reasoningEfforts : DEFAULT_REASONING_EFFORTS,
				defaultReasoningEffort: defaultReasoningEffort ?? (reasoningEfforts[0] ?? "high")
			},
			priority: typeof rawModel.priority === "number" ? rawModel.priority : Number.MAX_SAFE_INTEGER,
			index
		});
	}

	candidates.sort((a, b) => (a.priority - b.priority) || (a.index - b.index));
	const seen = new Set<string>();
	const options: ModelOption[] = [];
	for (const candidate of candidates) {
		if (seen.has(candidate.option.id)) {
			continue;
		}
		seen.add(candidate.option.id);
		options.push(candidate.option);
	}
	return options;
}

async function readDefaultsFromConfig(): Promise<{ model?: string; reasoningEffort?: string }> {
	const configPath = join(homedir(), ".codex", "config.toml");
	let rawText = "";
	try {
		rawText = await readFile(configPath, "utf8");
	} catch {
		return {};
	}
	const modelMatch = rawText.match(/^\s*model\s*=\s*"([^"]+)"/m);
	const reasoningMatch = rawText.match(/^\s*model_reasoning_effort\s*=\s*"([^"]+)"/m);
	const model = modelMatch?.[1]?.trim();
	return {
		model: model ? model : undefined,
		reasoningEffort: normalizeReasoningEffort(reasoningMatch?.[1])
	};
}

function parseReasoningEfforts(value: RawModel["supported_reasoning_levels"]): string[] {
	if (!Array.isArray(value)) {
		return [];
	}
	const efforts: string[] = [];
	const seen = new Set<string>();
	for (const entry of value) {
		const effort = typeof entry === "string"
			? normalizeReasoningEffort(entry)
			: normalizeReasoningEffort(entry?.effort);
		if (!effort || seen.has(effort)) {
			continue;
		}
		seen.add(effort);
		efforts.push(effort);
	}
	return efforts;
}

function normalizeReasoningEffort(value: unknown): string | undefined {
	if (typeof value !== "string") {
		return undefined;
	}
	const normalized = value.trim().toLowerCase();
	return normalized.length > 0 ? normalized : undefined;
}

function formatModelLabel(value: string): string {
	return value
		.split("-")
		.map((part) => {
			const lower = part.toLowerCase();
			if (lower === "gpt") {
				return "GPT";
			}
			if (lower === "codex") {
				return "Codex";
			}
			if (lower === "max") {
				return "Max";
			}
			if (lower === "mini") {
				return "Mini";
			}
			if (/^[0-9.]+$/u.test(part)) {
				return part;
			}
			return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
		})
		.join("-");
}
