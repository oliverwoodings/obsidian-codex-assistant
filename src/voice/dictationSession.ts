import { convertFloat32ToPcm16, postWhisperInference } from "./whisperHttp";

export interface DictationSessionConfig {
	baseUrl: string;
	language?: string;
	timeoutMs: number;
}

interface DictationSessionHandlers {
	onLevel?: (level: number) => void;
}

const WORKLET_PROCESSOR = "quick-skills-dictation-capture";
const TARGET_SAMPLE_RATE = 16_000;
const WORKLET_SOURCE = `
class QuickSkillsDictationCaptureProcessor extends AudioWorkletProcessor {
	process(inputs) {
		const firstInput = inputs[0];
		const firstChannel = firstInput && firstInput[0];
		if (firstChannel && firstChannel.length > 0) {
			this.port.postMessage(firstChannel);
		}
		return true;
	}
}

registerProcessor('${WORKLET_PROCESSOR}', QuickSkillsDictationCaptureProcessor);
`;

export class DictationSession {
	private readonly config: DictationSessionConfig;
	private readonly handlers: DictationSessionHandlers;
	private mediaStream: MediaStream | null = null;
	private audioContext: AudioContext | null = null;
	private sourceNode: MediaStreamAudioSourceNode | null = null;
	private workletNode: AudioWorkletNode | null = null;
	private silentGainNode: GainNode | null = null;
	private readonly pcmChunks: Int16Array[] = [];
	private sampleCount = 0;
	private starting = false;
	private active = false;

	constructor(config: DictationSessionConfig, handlers: DictationSessionHandlers = {}) {
		this.config = {
			baseUrl: config.baseUrl.trim(),
			language: config.language?.trim(),
			timeoutMs: config.timeoutMs
		};
		this.handlers = handlers;
	}

	get isActive(): boolean {
		return this.active || this.starting;
	}

	async start(): Promise<void> {
		if (this.isActive) {
			return;
		}
		this.starting = true;
		this.pcmChunks.length = 0;
		this.sampleCount = 0;
		try {
			this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
			this.audioContext = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });
			await this.audioContext.resume();
			await this.setupAudioPipeline();
			this.active = true;
		} catch (error) {
			await this.cleanupAudio();
			throw error;
		} finally {
			this.starting = false;
		}
	}

	async stopAndTranscribe(): Promise<string> {
		if (!this.isActive) {
			return "";
		}
		this.active = false;
		this.starting = false;
		const pcm = this.concatPcmChunks();
		const sampleRate = this.audioContext?.sampleRate ?? TARGET_SAMPLE_RATE;
		await this.cleanupAudio();
		this.handlers.onLevel?.(0);
		return await postWhisperInference({
			baseUrl: this.config.baseUrl,
			pcm16: pcm,
			sampleRate,
			language: this.config.language,
			timeoutMs: this.config.timeoutMs
		});
	}

	async abort(): Promise<void> {
		this.active = false;
		this.starting = false;
		this.pcmChunks.length = 0;
		this.sampleCount = 0;
		await this.cleanupAudio();
		this.handlers.onLevel?.(0);
	}

	private async setupAudioPipeline(): Promise<void> {
		if (!this.audioContext || !this.mediaStream) {
			throw new Error("Audio pipeline was not initialized.");
		}
		if (typeof AudioWorkletNode === "undefined") {
			throw new Error("AudioWorklet is not available in this environment.");
		}

		const workletModuleUrl = URL.createObjectURL(new Blob([WORKLET_SOURCE], {
			type: "application/javascript"
		}));
		try {
			await this.audioContext.audioWorklet.addModule(workletModuleUrl);
		} finally {
			URL.revokeObjectURL(workletModuleUrl);
		}

		this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);
		this.workletNode = new AudioWorkletNode(this.audioContext, WORKLET_PROCESSOR, {
			channelCount: 1,
			channelCountMode: "explicit",
			channelInterpretation: "speakers",
			numberOfInputs: 1,
			numberOfOutputs: 1
		});
		this.workletNode.port.addEventListener("message", this.handleWorkletMessage);
		this.workletNode.port.start();
		this.silentGainNode = this.audioContext.createGain();
		this.silentGainNode.gain.value = 0;

		this.sourceNode.connect(this.workletNode);
		this.workletNode.connect(this.silentGainNode);
		this.silentGainNode.connect(this.audioContext.destination);
	}

	private readonly handleWorkletMessage = (event: MessageEvent<Float32Array>): void => {
		if (!this.active) {
			return;
		}
		const frame = event.data;
		if (!(frame instanceof Float32Array) || frame.length === 0) {
			return;
		}
		const pcm = convertFloat32ToPcm16(frame);
		this.pcmChunks.push(pcm);
		this.sampleCount += pcm.length;
		this.handlers.onLevel?.(this.computeRmsLevel(frame));
	};

	private computeRmsLevel(frame: Float32Array): number {
		let energy = 0;
		for (let index = 0; index < frame.length; index += 1) {
			const sample = frame[index] ?? 0;
			energy += sample * sample;
		}
		const rms = Math.sqrt(energy / Math.max(frame.length, 1));
		return Math.max(0, Math.min(1, rms * 8));
	}

	private concatPcmChunks(): Int16Array {
		if (this.sampleCount === 0) {
			return new Int16Array(0);
		}
		const combined = new Int16Array(this.sampleCount);
		let offset = 0;
		for (const chunk of this.pcmChunks) {
			combined.set(chunk, offset);
			offset += chunk.length;
		}
		this.pcmChunks.length = 0;
		this.sampleCount = 0;
		return combined;
	}

	private async cleanupAudio(): Promise<void> {
		this.workletNode?.port.removeEventListener("message", this.handleWorkletMessage);
		try {
			this.workletNode?.disconnect();
		} catch {
			// Best-effort cleanup.
		}
		try {
			this.sourceNode?.disconnect();
		} catch {
			// Best-effort cleanup.
		}
		try {
			this.silentGainNode?.disconnect();
		} catch {
			// Best-effort cleanup.
		}
		this.mediaStream?.getTracks().forEach((track) => track.stop());
		if (this.audioContext) {
			try {
				await this.audioContext.close();
			} catch {
				// Best-effort cleanup.
			}
		}
		this.workletNode = null;
		this.sourceNode = null;
		this.silentGainNode = null;
		this.audioContext = null;
		this.mediaStream = null;
	}
}
