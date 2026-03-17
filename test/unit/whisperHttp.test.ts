import { describe, expect, it, vi } from "vitest";
import { requestUrlMock } from "../helpers/obsidianMock";
import { convertFloat32ToPcm16, normalizeWhisperBaseUrl, postWhisperInference } from "../../src/voice/whisperHttp";

describe("whisperHttp", () => {
	it("normalizes URLs and clips float32 input to PCM16", () => {
		expect(normalizeWhisperBaseUrl("127.0.0.1:8080").toString()).toBe("http://127.0.0.1:8080/");
		expect(normalizeWhisperBaseUrl("https://host/path").toString()).toBe("https://host/path");
		expect(Array.from(convertFloat32ToPcm16(new Float32Array([-2, -1, 0, 1, 2])))).toEqual([
			-32768,
			-32768,
			0,
			32767,
			32767,
		]);
	});

	it("returns early for empty audio", async () => {
		await expect(postWhisperInference({
			baseUrl: "127.0.0.1:8080",
			pcm16: new Int16Array(),
			sampleRate: 16_000,
		})).resolves.toBe("");
		expect(requestUrlMock).not.toHaveBeenCalled();
	});

	it("posts WAV multipart data and extracts transcript text from JSON", async () => {
		requestUrlMock.mockResolvedValue({
			status: 200,
			text: JSON.stringify({ text: "hello world" }),
		});
		const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.5);

		const result = await postWhisperInference({
			baseUrl: "127.0.0.1:8080",
			pcm16: new Int16Array([1, -1, 10]),
			sampleRate: 16_000,
			language: "en",
			timeoutMs: 12_345.4,
		});

		expect(result).toBe("hello world");
		const request = requestUrlMock.mock.calls[0]?.[0] as {
			url: string;
			headers: Record<string, string>;
			body: ArrayBuffer;
		};
		expect(request.url).toBe("http://127.0.0.1:8080/inference");
		expect(request.headers["Content-Type"]).toContain("multipart/form-data; boundary=----obsidian-codex-assistant-");
		const bodyText = new TextDecoder().decode(new Uint8Array(request.body));
		expect(bodyText).toContain('name="language"');
		expect(bodyText).toContain('filename="audio.wav"');
		expect(bodyText).toContain("RIFF");
		randomSpy.mockRestore();
	});

	it("surfaces error responses with a response snippet and trims non-json responses", async () => {
		requestUrlMock
			.mockResolvedValueOnce({ status: 200, text: "  plain response  " })
			.mockResolvedValueOnce({ status: 500, text: "very bad failure" });

		await expect(postWhisperInference({
			baseUrl: "http://127.0.0.1:8080",
			pcm16: new Int16Array([1]),
			sampleRate: 16_000,
		})).resolves.toBe("plain response");

		await expect(postWhisperInference({
			baseUrl: "http://127.0.0.1:8080",
			pcm16: new Int16Array([1]),
			sampleRate: 16_000,
		})).rejects.toThrow("whisper.cpp /inference returned 500: very bad failure");
	});
});
