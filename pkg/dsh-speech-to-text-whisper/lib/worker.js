//#region corrigirNomes
// Correcoes deterministicas de nomes/termos (edite com o SEU vocabulario):
// [regex palavra inteira, troca]. Exemplo generico abaixo.
const CORRECOES_NOMES = [
	[/(?<![\p{L}\p{N}_])mikrofone(?![\p{L}\p{N}_])/giu, "microfone"]
];
function corrigirNomes(texto) {
	for (const [rx, troca] of CORRECOES_NOMES) texto = texto.replace(rx, troca);
	return texto;
}
//#endregion
import { createRequire } from "node:module";
import { z } from "zod";
import z$1 from "@deepseek-ai/schemastery";
import { MAX_TIMER_DELAY_MS } from "@deepseek-ai/dsh-timeout";
import { validateWave } from "@deepseek-ai/dsh-experimental-speech-to-text/wave";
import { createServer } from "node:http";
import net from "node:net";
import { timingSafeEqual } from "node:crypto";
//#region lib/types/config.js
/** Deployment configuration for the managed local Whisper recognizer. */
/** Validate deployment-varying runtime choices at plugin activation. */
const Config = z$1.object({
	providerId: z$1.string().min(1).default("whisper-local"),
	dataRoot: z$1.string().min(1).required(),
	modelDirectory: z$1.union([z$1.string().min(1), z$1.const(void 0)]),
	vadModelPath: z$1.union([z$1.string().min(1), z$1.const(void 0)]),
	model: z$1.union(["turbo", "large-v3"]).default("turbo"),
	modelOrigin: z$1.union([z$1.string().pattern(/^https?:\/\/[^/\s?#@]+\/?$/), z$1.const(void 0)]),
	modelOrigins: z$1.array(z$1.string().pattern(/^https?:\/\/[^/\s?#@]+\/?$/)).min(1).default(["https://huggingface.co", "https://hf-mirror.com"]),
	modelProbeTimeoutMs: z$1.natural().min(1).max(MAX_TIMER_DELAY_MS).default(3e3),
	threads: z$1.natural().min(1).default(8),
	segmentSeconds: z$1.number().min(1).max(29).default(28),
	minDecodeSeconds: z$1.number().min(0.5).max(29).default(6),
	vadThreshold: z$1.number().min(0).max(1).default(.5),
	minSpeechSeconds: z$1.number().min(0).default(.25),
	minSilenceSeconds: z$1.number().min(.01).default(.5),
	maxAudioBytes: z$1.natural().min(46).default(8 * 1024 * 1024),
	prepareTimeoutMs: z$1.natural().min(1).max(MAX_TIMER_DELAY_MS).default(36e5),
	inferenceTimeoutMs: z$1.natural().min(1).max(MAX_TIMER_DELAY_MS).default(12e4),
	idleTimeoutMs: z$1.natural().max(MAX_TIMER_DELAY_MS).default(3e5),
	maxPending: z$1.natural().min(1).default(4),
	graceMs: z$1.natural().min(1).max(MAX_TIMER_DELAY_MS).default(1e3),
	maxLogBytes: z$1.natural().min(1).default(64 * 1024),
	maxResponseBytes: z$1.natural().min(1).default(128 * 1024),
	progressIntervalMs: z$1.natural().min(1).max(MAX_TIMER_DELAY_MS).default(100)
});
//#endregion
//#region lib/types/input.js
/** Whisper language support and input failures that leave native inference untouched. */
/** Language hints accepted by both provider metadata and native inference. */
const languages = [
	"auto",
	"pt",
	"en",
	"es",
	"fr",
	"de",
	"it",
	"nl",
	"pl",
	"ru",
	"uk",
	"tr",
	"ar",
	"hi",
	"vi",
	"id",
	"th",
	"zh",
	"ja",
	"ko"
];
/** A request rejected before native inference; the loaded worker remains reusable. */
var SpeechInputError = class extends Error {};
/**
 * Translate the provider-neutral hint into the native Whisper language argument.
 * Whisper spells automatic detection as an empty string and rejects the literal "auto".
 * @param language - requested language hint.
 * @returns the native language argument.
 */
function nativeLanguage(language) {
	return language === "auto" ? "" : language;
}
/**
 * Validate a recording before touching the native recognizer.
 * @param audio - untrusted WAV request bytes.
 * @param language - requested Whisper language hint.
 * @param maxAudioBytes - configured worker byte limit.
 * @returns validated audio duration in seconds; invalid inputs throw SpeechInputError.
 */
function validateInput(audio, language, maxAudioBytes) {
	if (!languages.includes(language)) throw new SpeechInputError("Unsupported Whisper language");
	if (audio.byteLength > maxAudioBytes) throw new SpeechInputError("Speech audio exceeds the worker byte limit");
	try {
		return validateWave(audio, maxAudioBytes / 32e3);
	} catch (error) {
		throw new SpeechInputError("Invalid speech WAV", { cause: error });
	}
}
//#endregion
//#region lib/types/inference.js
/** CPU Whisper inference and Silero segmentation, confined to the recognition process. */
/**
 * Load the Whisper encoder/decoder pair; every recording resets VAD and updates its language hint.
 * @param config - verified ONNX paths and explicit CPU/VAD limits.
 * @returns synchronous inference confined to its dedicated process.
 */
function createTranscriber(config) {
	const sherpa = createRequire(import.meta.url)("sherpa-onnx-node");
	const nativeConfig = {
		featConfig: {
			sampleRate: 16e3,
			featureDim: 80
		},
		modelConfig: {
			whisper: {
				encoder: config.encoder,
				decoder: config.decoder,
				language: "",
				task: "transcribe"
			},
			tokens: config.tokens,
			numThreads: config.threads,
			provider: "cpu",
			debug: 0
		}
	};
	const recognizer = new sherpa.OfflineRecognizer(nativeConfig);
	const detector = new sherpa.Vad({
		sileroVad: {
			model: config.vad,
			threshold: config.vadThreshold,
			minSilenceDuration: config.minSilenceSeconds,
			minSpeechDuration: config.minSpeechSeconds,
			maxSpeechDuration: config.segmentSeconds,
			windowSize: 512
		},
		sampleRate: 16e3,
		numThreads: config.threads,
		provider: "cpu",
		debug: 0
	}, config.segmentSeconds + config.minSilenceSeconds + 1);
	return (audio, language) => {
		const audioSeconds = validateInput(audio, language, config.maxAudioBytes);
		const pcm = new DataView(audio.buffer, audio.byteOffset + 44, audio.byteLength - 44);
		const samples = Float32Array.from({ length: pcm.byteLength / 2 }, (_, i) => pcm.getInt16(i * 2, true) / 32768);
		nativeConfig.modelConfig.whisper.language = nativeLanguage(language);
		recognizer.setConfig(nativeConfig);
		detector.reset();
		const started = performance.now(), texts = [];
		const minimumSamples = Math.floor(16e3 * config.minDecodeSeconds);
		let pending = new Float32Array(0);
		const decodePending = () => {
			if (pending.length < 8e3) {
				pending = new Float32Array(0);
				return;
			}
			const stream = recognizer.createStream();
			stream.acceptWaveform({
				sampleRate: 16e3,
				samples: pending
			});
			recognizer.decode(stream);
			const text = recognizer.getResult(stream).text.trim();
			if (text) texts.push(text);
			pending = new Float32Array(0);
		};
		const drain = () => {
			while (!detector.isEmpty()) {
				const segment = detector.front(false);
				const merged = new Float32Array(pending.length + segment.samples.length);
				merged.set(pending, 0);
				merged.set(segment.samples, pending.length);
				pending = merged;
				detector.pop();
				if (pending.length >= minimumSamples) decodePending();
			}
		};
		for (let offset = 0; offset < samples.length; offset += 512) {
			detector.acceptWaveform(samples.subarray(offset, offset + 512));
			drain();
		}
		detector.flush();
		drain();
		decodePending();
		return {
			text: corrigirNomes(texts.filter(Boolean).join(" ").trim()),
			audioSeconds,
			inferenceSeconds: (performance.now() - started) / 1e3
		};
	};
}
//#endregion
//#region lib/types/process-server.js
/** Authenticated loopback transport for one serial native recognizer. */
/**
 * Bind an ephemeral loopback listener; model loading completes before readiness is published.
 * @param token - private per-process authentication secret.
 * @param maxAudioBytes - maximum retained request bytes.
 * @param transcribe - synchronous inference owned by this process.
 * @returns the listening server and its dynamically assigned port.
 */
async function startRecognitionServer(token, maxAudioBytes, transcribe) {
	const expected = Buffer.from(`Bearer ${token}`);
	const server = createServer((request, response) => {
		const reply = (status, value) => {
			response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(value));
		};
		const authorization = Buffer.from(request.headers.authorization ?? "");
		if (authorization.length !== expected.length || !timingSafeEqual(authorization, expected)) {
			request.resume();
			reply(401, { error: "Unauthorized" });
			return;
		}
		const url = new URL(request.url, "http://localhost");
		if (request.method !== "POST" || url.pathname !== "/transcribe") {
			request.resume();
			reply(404, { error: "Unknown endpoint" });
			return;
		}
		const length = Number(request.headers["content-length"]);
		if (!Number.isSafeInteger(length) || length < 46 || length > maxAudioBytes) {
			request.resume();
			reply(413, {
				error: "Invalid speech audio size",
				code: "invalid-input"
			});
			return;
		}
		(async () => {
			try {
				const chunks = [];
				for await (const chunk of request) {
					const bytes = chunk;
					chunks.push(bytes);
				}
				reply(200, await transcribe(Buffer.concat(chunks), url.searchParams.get("language") ?? "auto"));
			} catch (error) {
				reply(error instanceof SpeechInputError ? 400 : 500, {
					error: error instanceof Error ? error.message : String(error),
					...error instanceof SpeechInputError ? { code: "invalid-input" } : {}
				});
			}
		})();
	});
	await new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			server.off("error", reject);
			resolve();
		});
	});
	return {
		server,
		port: server.address().port
	};
}
//#endregion
//#region ditado local (21/11/2026)
/** Reconhecimento pelo serviço local ditado-stream (Whisper turbo na GPU + dicionário); CPU/sherpa só de reserva. */
const DITADO_SOCK = process.env.DITADO_SOCK || "/tmp/ditado_stream.sock";
function viaDitado(audio, language, config) {
	const audioSeconds = validateInput(audio, language, config.maxAudioBytes);
	const pcm = audio.subarray(44);
	const started = performance.now();
	return new Promise((resolve, reject) => {
		const sock = net.connect(DITADO_SOCK);
		let buf = "", fim = false;
		const acabar = (fn, v) => { if (fim) return; fim = true; clearTimeout(t); sock.destroy(); fn(v); };
		const t = setTimeout(() => acabar(reject, new Error("ditado-stream: tempo esgotado")), 60000);
		sock.on("error", (e) => acabar(reject, e));
		sock.on("close", () => acabar(reject, new Error("ditado-stream fechou")));
		sock.on("connect", () => sock.write(JSON.stringify({ cmd: "texto", id: 1, pcm_b64: Buffer.from(pcm).toString("base64") }) + "\n"));
		sock.on("data", (d) => {
			buf += d.toString("utf8");
			let i;
			while ((i = buf.indexOf("\n")) >= 0) {
				const linha = buf.slice(0, i); buf = buf.slice(i + 1);
				let m; try { m = JSON.parse(linha); } catch { continue; }
				if (m.tipo === "final") acabar(resolve, { text: String(m.texto || "").trim(), audioSeconds, inferenceSeconds: (performance.now() - started) / 1e3 });
				else if (m.tipo === "erro") acabar(reject, new Error(m.msg || "erro do ditado-stream"));
			}
		});
	});
}
function createHybrid(config) {
	let cpu = null;
	return async (audio, language) => {
		try {
			return await viaDitado(audio, language, config);
		} catch (error) {
			if (error instanceof SpeechInputError) throw error;
			process.stderr.write(`[whisper-ptbr] ditado-stream indisponível (${error.message}); usando sherpa/CPU\n`);
			cpu ??= createTranscriber(config);
			return cpu(audio, language);
		}
	};
}
//#endregion
//#region lib/types/worker.js
/** Private child entry; the Host owns termination, and stdout carries only readiness. */
const raw = JSON.parse(z.string().parse(process.argv[2]));
const paths = z.object({
	encoder: z.string().min(1),
	decoder: z.string().min(1),
	tokens: z.string().min(1),
	vad: z.string().min(1)
}).parse(raw);
const config = Object.assign(Config(raw), paths);
const token = z.string().regex(/^[a-f0-9]{64}$/).parse(process.env.DSH_SPEECH_TOKEN);
delete process.env.DSH_SPEECH_TOKEN;
const { port } = await startRecognitionServer(token, config.maxAudioBytes, createHybrid(config));
process.stdout.write(`${JSON.stringify({ port })}\n`);
//#endregion
export {};
