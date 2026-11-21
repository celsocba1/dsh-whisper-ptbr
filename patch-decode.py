#!/usr/bin/env python3
"""Agrupa segmentos curtos do VAD antes de decodificar no provider Whisper.

O bloco do decodificador e localizado por span (inicio conhecido ate o fecho
correspondente), em vez de casar a indentacao inteira na mao.
"""
import sys
import pathlib

PKG = pathlib.Path(__file__).resolve().parent / "pkg" / "dsh-speech-to-text-whisper"
WORKER = PKG / "lib/worker.js"

OLD_SEGMENT = "\tsegmentSeconds: z$1.number().min(1).max(120).default(30),"
NEW_SEGMENT = "\tsegmentSeconds: z$1.number().min(1).max(29).default(28),"

START_MARK = "\treturn (audio, language) => {"

NEW_DECODE = '''\treturn (audio, language) => {
\t\tconst audioSeconds = validateInput(audio, language, config.maxAudioBytes);
\t\tconst pcm = new DataView(audio.buffer, audio.byteOffset + 44, audio.byteLength - 44);
\t\tconst samples = Float32Array.from({ length: pcm.byteLength / 2 }, (_, i) => pcm.getInt16(i * 2, true) / 32768);
\t\tnativeConfig.modelConfig.whisper.language = nativeLanguage(language);
\t\trecognizer.setConfig(nativeConfig);
\t\tdetector.reset();
\t\tconst started = performance.now(), texts = [];
\t\tconst minimumSamples = Math.floor(16e3 * config.minDecodeSeconds);
\t\tlet pending = new Float32Array(0);
\t\tconst decodePending = () => {
\t\t\tif (pending.length < 8e3) {
\t\t\t\tpending = new Float32Array(0);
\t\t\t\treturn;
\t\t\t}
\t\t\tconst stream = recognizer.createStream();
\t\t\tstream.acceptWaveform({
\t\t\t\tsampleRate: 16e3,
\t\t\t\tsamples: pending
\t\t\t});
\t\t\trecognizer.decode(stream);
\t\t\tconst text = recognizer.getResult(stream).text.trim();
\t\t\tif (text) texts.push(text);
\t\t\tpending = new Float32Array(0);
\t\t};
\t\tconst drain = () => {
\t\t\twhile (!detector.isEmpty()) {
\t\t\t\tconst segment = detector.front(false);
\t\t\t\tconst merged = new Float32Array(pending.length + segment.samples.length);
\t\t\t\tmerged.set(pending, 0);
\t\t\t\tmerged.set(segment.samples, pending.length);
\t\t\t\tpending = merged;
\t\t\t\tdetector.pop();
\t\t\t\tif (pending.length >= minimumSamples) decodePending();
\t\t\t}
\t\t};
\t\tfor (let offset = 0; offset < samples.length; offset += 512) {
\t\t\tdetector.acceptWaveform(samples.subarray(offset, offset + 512));
\t\t\tdrain();
\t\t}
\t\tdetector.flush();
\t\tdrain();
\t\tdecodePending();
\t\treturn {
\t\t\ttext: texts.filter(Boolean).join(" ").trim(),
\t\t\taudioSeconds,
\t\t\tinferenceSeconds: (performance.now() - started) / 1e3
\t\t};
\t};'''

source = WORKER.read_text(encoding="utf-8")

# 1) limite de duracao do segmento + novo campo de agrupamento
if source.count(OLD_SEGMENT) != 1:
    print("ABORTADO: segmentSeconds nao encontrado uma vez")
    sys.exit(1)
source = source.replace(
    OLD_SEGMENT,
    NEW_SEGMENT,
).replace(
    NEW_SEGMENT,
    NEW_SEGMENT + "\n\tminDecodeSeconds: z$1.number().min(0.5).max(29).default(6),",
)
print("ok  segmentSeconds -> 28 e minDecodeSeconds -> 6")

# 2) troca o bloco do decodificador por span
start = source.find(START_MARK)
if start < 0:
    print("ABORTADO: inicio do bloco de decodificacao nao encontrado")
    sys.exit(1)
end = source.find("\n\t};", start)
if end < 0:
    print("ABORTADO: fim do bloco de decodificacao nao encontrado")
    sys.exit(1)
end += len("\n\t};")
old_block = source[start:end]
if "detector.front(false)" not in old_block or "recognizer.decode(stream)" not in old_block:
    print("ABORTADO: span localizado nao parece ser o decodificador")
    print(repr(old_block[:200]))
    sys.exit(1)
source = source[:start] + NEW_DECODE + source[end:]
print(f"ok  bloco do decodificador trocado ({len(old_block)} -> {len(NEW_DECODE)} bytes)")

WORKER.write_text(source, encoding="utf-8")
print("\nworker.js atualizado")
