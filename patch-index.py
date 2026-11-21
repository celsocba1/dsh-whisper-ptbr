#!/usr/bin/env python3
"""Adapta o provider SenseVoice copiado para um provider Whisper (sherpa-onnx).

Cada substituição é verificada: se o padrão não aparecer exatamente uma vez,
o script aborta sem gravar, para nunca deixar o arquivo pela metade.
"""
import sys
import pathlib

TARGET = pathlib.Path(__file__).resolve().parent / "pkg" / "dsh-speech-to-text-whisper" / "lib" / "index.js"

LANGUAGES = '''const languages = [
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
];'''

REPLACEMENTS = [
    # --- idiomas suportados -------------------------------------------------
    (
        'const languages = [\n\t"auto",\n\t"zh",\n\t"en",\n\t"yue",\n\t"ja",\n\t"ko"\n];',
        LANGUAGES,
    ),
    # --- resolveRuntime: dois arquivos ONNX (encoder + decoder) --------------
    (
        '\tconst modelRoot = config.modelDirectory ?? join(config.dataRoot, "models", "sensevoice-onnx");\n'
        "\treturn {\n"
        "\t\tlock,\n"
        "\t\tmodelRoot,\n"
        "\t\tpaths: {\n"
        "\t\t\tmodel: join(modelRoot, lock.models[config.precision].name),\n"
        "\t\t\ttokens: join(modelRoot, lock.tokens.name),",
        '\tconst modelRoot = config.modelDirectory ?? join(config.dataRoot, "models", "whisper-onnx");\n'
        "\tconst variant = lock.models[config.model];\n"
        "\treturn {\n"
        "\t\tlock,\n"
        "\t\tmodelRoot,\n"
        "\t\tvariant,\n"
        "\t\tpaths: {\n"
        "\t\t\tencoder: join(modelRoot, variant.encoder.name),\n"
        "\t\t\tdecoder: join(modelRoot, variant.decoder.name),\n"
        "\t\t\ttokens: join(modelRoot, lock.tokens.name),",
    ),
    # --- verifyRuntime: assinatura + arquivos verificados --------------------
    (
        "async function verifyRuntime(config, paths, lock, signal) {\n"
        "\tsignal.throwIfAborted();\n"
        "\ttry {\n"
        "\t\tawait Promise.all([\n"
        "\t\t\tpaths.model,\n"
        "\t\t\tpaths.tokens,\n"
        "\t\t\tpaths.vad\n"
        "\t\t].map((path) => access(path)));",
        "async function verifyRuntime(config, paths, lock, variant, signal) {\n"
        "\tsignal.throwIfAborted();\n"
        "\ttry {\n"
        "\t\tawait Promise.all([\n"
        "\t\t\tpaths.encoder,\n"
        "\t\t\tpaths.decoder,\n"
        "\t\t\tpaths.tokens,\n"
        "\t\t\tpaths.vad\n"
        "\t\t].map((path) => access(path)));",
    ),
    (
        "\tconst verified = [...config.modelDirectory === void 0 ? "
        "[[paths.model, lock.models[config.precision]], [paths.tokens, lock.tokens]] : [], "
        "...config.vadModelPath === void 0 ? [[paths.vad, lock.vad]] : []];",
        "\tconst verified = [...config.modelDirectory === void 0 ? "
        "[[paths.encoder, variant.encoder], [paths.decoder, variant.decoder], [paths.tokens, lock.tokens]] : [], "
        "...config.vadModelPath === void 0 ? [[paths.vad, lock.vad]] : []];",
    ),
    # --- inspectRuntime ------------------------------------------------------
    (
        "\tconst { lock, paths } = resolveRuntime(config);\n"
        "\treturn await verifyRuntime(config, paths, lock, signal) ? paths : void 0;",
        "\tconst { lock, paths, variant } = resolveRuntime(config);\n"
        "\treturn await verifyRuntime(config, paths, lock, variant, signal) ? paths : void 0;",
    ),
    # --- prepareRuntime ------------------------------------------------------
    (
        "\tconst { lock, modelRoot, paths } = resolveRuntime(config);",
        "\tconst { lock, modelRoot, paths, variant } = resolveRuntime(config);",
    ),
    (
        "\t\tawait download(lock.models[config.precision], modelRoot, \"model\");\n"
        "\t\tawait download(lock.tokens, modelRoot, \"model\");",
        "\t\tawait download(variant.encoder, modelRoot, \"model\");\n"
        "\t\tawait download(variant.decoder, modelRoot, \"model\");\n"
        "\t\tawait download(lock.tokens, modelRoot, \"model\");",
    ),
    (
        '\tif (!await verifyRuntime(config, paths, lock, signal)) throw new Error("Speech model verification failed: missing or corrupted model files");',
        '\tif (!await verifyRuntime(config, paths, lock, variant, signal)) throw new Error("Speech model verification failed: missing or corrupted model files");',
    ),
    # --- Config do index.js --------------------------------------------------
    (
        '\tproviderId: z$1.string().min(1).default("sensevoice-local"),',
        '\tproviderId: z$1.string().min(1).default("whisper-local"),',
    ),
    (
        '\tprecision: z$1.union(["int8", "fp32"]).default("int8"),',
        '\tmodel: z$1.union(["turbo", "large-v3"]).default("turbo"),',
    ),
    (
        "\tthreads: z$1.natural().min(1).default(2),",
        "\tthreads: z$1.natural().min(1).default(8),",
    ),
    (
        "\tinferenceTimeoutMs: z$1.natural().min(1).max(MAX_TIMER_DELAY_MS).default(12e4),",
        "\tinferenceTimeoutMs: z$1.natural().min(1).max(MAX_TIMER_DELAY_MS).default(3e5),",
    ),
    # --- apply() -------------------------------------------------------------
    (
        "]) if (path !== void 0 && !isAbsolute(path)) throw new Error(`SenseVoice paths must be absolute: ${path}`);",
        "]) if (path !== void 0 && !isAbsolute(path)) throw new Error(`Whisper paths must be absolute: ${path}`);",
    ),
    (
        '\tconst estimatedBytes = config.precision === "int8" ? 1e9 : 2e9;',
        '\tconst estimatedBytes = config.model === "turbo" ? 1.25e9 : 2e9;',
    ),
    (
        "\t\t\t\tname: `SenseVoiceSmall (${config.precision.toUpperCase()})`,",
        "\t\t\t\tname: `Whisper ${config.model} (sherpa-onnx)`,",
    ),
    (
        'const name = "experimental-speech-to-text-sensevoice";',
        'const name = "speech-to-text-whisper";',
    ),
    (
        '\t\tthis.lifetime.abort(/* @__PURE__ */ new Error("SenseVoice provider disposed"));',
        '\t\tthis.lifetime.abort(/* @__PURE__ */ new Error("Whisper provider disposed"));',
    ),
    # --- renomeia a classe do worker ----------------------------------------
    ("var SenseVoiceWorker = class {", "var WhisperWorker = class {"),
    (
        "\tconst worker = new SenseVoiceWorker(ctx, config);",
        "\tconst worker = new WhisperWorker(ctx, config);",
    ),
    # --- CORRECAO DO BUG: entrega os caminhos achatados ao worker ------------
    (
        "\t\t\t\t\tJSON.stringify(Object.assign({}, this.config, runtime))",
        "\t\t\t\t\tJSON.stringify(Object.assign({}, this.config, runtime, runtime.paths))",
    ),
]

source = TARGET.read_text(encoding="utf-8")
original = source

for index, (old, new) in enumerate(REPLACEMENTS, start=1):
    count = source.count(old)
    if count != 1:
        print(f"ABORTADO: substituicao {index} encontrou {count} ocorrencias (esperado 1)")
        print("trecho procurado:", repr(old[:120]))
        sys.exit(1)
    source = source.replace(old, new)
    print(f"ok {index:2d}/{len(REPLACEMENTS)}  {old.strip().splitlines()[0][:64]}")

if source == original:
    print("nada mudou")
    sys.exit(1)

TARGET.write_text(source, encoding="utf-8")
print(f"\nindex.js atualizado ({len(original)} -> {len(source)} bytes)")
