import { requestUrl } from "obsidian";

export interface WhisperInferenceRequest {
	baseUrl: string;
	pcm16: Int16Array;
	sampleRate: number;
	language?: string;
	timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 90_000;
const MULTIPART_BOUNDARY_PREFIX = "----obsidian-codex-assistant-";

export function normalizeWhisperBaseUrl(baseUrl: string): URL {
	const trimmed = baseUrl.trim();
	const withProtocol = /^[a-zA-Z][a-zA-Z0-9+\-.]*:\/\//u.test(trimmed)
		? trimmed
		: `http://${trimmed}`;
	return new URL(withProtocol);
}

export function convertFloat32ToPcm16(input: Float32Array): Int16Array {
	const pcm = new Int16Array(input.length);
	for (let index = 0; index < input.length; index += 1) {
		const sample = Math.max(-1, Math.min(1, input[index] ?? 0));
		pcm[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
	}
	return pcm;
}

export async function postWhisperInference(request: WhisperInferenceRequest): Promise<string> {
	if (request.pcm16.length === 0) {
		return "";
	}

	const wavBytes = pcm16ToWavBytes(request.pcm16, request.sampleRate);
	const fields: Record<string, string> = {
		response_format: "json",
		temperature: "0.0",
		no_timestamps: "true"
	};
	const language = request.language?.trim();
	if (language) {
		fields.language = language;
	}

	const multipart = buildMultipartBody(fields, {
		fieldName: "file",
		filename: "audio.wav",
		contentType: "audio/wav",
		data: wavBytes
	});
	const response = await requestWithTimeout({
		url: new URL("/inference", normalizeWhisperBaseUrl(request.baseUrl)).toString(),
		method: "POST",
		headers: {
			"Content-Type": multipart.contentType
		},
		body: multipart.body.buffer
	}, coerceTimeoutMs(request.timeoutMs));

	if (!response.ok) {
		const snippet = response.text.slice(0, 300);
		throw new Error(`whisper.cpp /inference returned ${response.status}: ${snippet}`);
	}

	return extractTranscriptText(response.text);
}

function pcm16ToWavBytes(input: Int16Array, sampleRate: number): Uint8Array {
	const numChannels = 1;
	const bitsPerSample = 16;
	const blockAlign = numChannels * (bitsPerSample / 8);
	const byteRate = sampleRate * blockAlign;
	const dataSize = input.length * 2;
	const wavSize = 44 + dataSize;
	const wav = new Uint8Array(wavSize);
	const view = new DataView(wav.buffer);

	writeAscii(wav, 0, "RIFF");
	view.setUint32(4, 36 + dataSize, true);
	writeAscii(wav, 8, "WAVE");
	writeAscii(wav, 12, "fmt ");
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true);
	view.setUint16(22, numChannels, true);
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, byteRate, true);
	view.setUint16(32, blockAlign, true);
	view.setUint16(34, bitsPerSample, true);
	writeAscii(wav, 36, "data");
	view.setUint32(40, dataSize, true);

	for (let index = 0; index < input.length; index += 1) {
		view.setInt16(44 + index * 2, input[index] ?? 0, true);
	}

	return wav;
}

function buildMultipartBody(
	fields: Record<string, string>,
	file: {
		fieldName: string;
		filename: string;
		contentType: string;
		data: Uint8Array;
	}
): {
	contentType: string;
	body: Uint8Array;
} {
	const boundary = `${MULTIPART_BOUNDARY_PREFIX}${Math.random().toString(16).slice(2)}`;
	const encoder = new TextEncoder();
	const chunks: Uint8Array[] = [];

	for (const [key, value] of Object.entries(fields)) {
		chunks.push(encoder.encode(
			`--${boundary}\r\nContent-Disposition: form-data; name="${escapeQuoted(key)}"\r\n\r\n${value}\r\n`
		));
	}

	chunks.push(encoder.encode(
		`--${boundary}\r\nContent-Disposition: form-data; name="${escapeQuoted(file.fieldName)}"; filename="${escapeQuoted(file.filename)}"\r\nContent-Type: ${file.contentType}\r\n\r\n`
	));
	chunks.push(file.data);
	chunks.push(encoder.encode("\r\n"));
	chunks.push(encoder.encode(`--${boundary}--\r\n`));

	const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
	const body = new Uint8Array(totalLength);
	let offset = 0;
	for (const chunk of chunks) {
		body.set(chunk, offset);
		offset += chunk.length;
	}

	return {
		contentType: `multipart/form-data; boundary=${boundary}`,
		body
	};
}

function extractTranscriptText(rawResponse: string): string {
	const trimmed = rawResponse.trim();
	if (!trimmed) {
		return "";
	}
	try {
		const parsed = JSON.parse(trimmed) as unknown;
		if (typeof parsed === "string") {
			return parsed.trim();
		}
		if (parsed && typeof parsed === "object") {
			const record = parsed as Record<string, unknown>;
			for (const key of ["text", "transcript", "result"]) {
				const value = record[key];
				if (typeof value === "string") {
					return value.trim();
				}
			}
		}
	} catch {
		// Fall back to the raw response text if whisper.cpp does not return JSON.
	}
	return trimmed;
}

async function requestWithTimeout(
	request: {
		url: string;
		method: string;
		headers?: Record<string, string>;
		body?: string | ArrayBuffer;
	},
	timeoutMs: number
): Promise<{ status: number; ok: boolean; text: string }> {
	let timeoutId: number | null = null;
	try {
		const timeoutPromise = new Promise<never>((_, reject) => {
			timeoutId = window.setTimeout(() => {
				reject(new Error(`Request timed out after ${timeoutMs}ms.`));
			}, timeoutMs);
		});
		const response = await Promise.race([
			requestUrl(request),
			timeoutPromise
		]);
		return {
			status: response.status,
			ok: response.status >= 200 && response.status < 300,
			text: response.text
		};
	} finally {
		if (timeoutId !== null) {
			window.clearTimeout(timeoutId);
		}
	}
}

function coerceTimeoutMs(timeoutMs: number | undefined): number {
	if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
		return DEFAULT_TIMEOUT_MS;
	}
	return Math.round(timeoutMs);
}

function writeAscii(output: Uint8Array, offset: number, text: string): void {
	for (let index = 0; index < text.length; index += 1) {
		output[offset + index] = text.charCodeAt(index);
	}
}

function escapeQuoted(value: string): string {
	return value.split("\"").join("\\\"");
}
