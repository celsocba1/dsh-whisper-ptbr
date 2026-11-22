# dsh-speech-to-text-whisper — local Whisper (pt-BR) provider for DeepSeek Harness

Drop-in **speech-to-text provider for the DeepSeek Harness (`dsh`)** that replaces the built-in SenseVoice recognizer (which does not cover Portuguese) with **local Whisper large-v3-turbo via sherpa-onnx** — dictation in Brazilian Portuguese (and 15+ other languages), running entirely offline, with sha256-verified model assets.

The provider package (`pkg/dsh-speech-to-text-whisper`) is a fork of the official `@deepseek-ai` SenseVoice provider (MIT), adapted for Whisper: Portuguese language list, VAD-tuned decode, and deterministic custom-term correction. The CPU default threads: 8 — this one runs on CPU, no GPU needed.

> Em português: veja [Como funciona em pt-BR](#como-funciona-em-pt-br) no fim do README. Os comentários do código estão em pt-BR.

## Install

```bash
git clone <this repo> && cd dsh-whisper-ptbr
bash install.sh        # idempotent; backs up your profile patch before editing
```

Prerequisites: the `dsh` harness installed globally (`~/.local/lib/node_modules/@deepseek-ai/dsh` by default — override with `DSH_HARNESS_DIR`), a dsh web profile (default `~/.dsh/profiles/web`), Node ≥ 20.

Optional — pre-seed models (~991 MB) if you already have the ONNX files:

```bash
DSH_WHISPER_MODELS_DIR=/path/with/models/whisper-onnx+silero bash install.sh
```

Otherwise the provider downloads the assets on first use (pinned sha256, from `https://huggingface.co` with HF-Mirror fallback).

Then **restart the dsh web server** and hard-reload the browser (Ctrl+Shift+R). The recognizer shows up as **"Whisper turbo (sherpa-onnx)"** and becomes the default.

### The mandatory symlink

The loader resolves the provider's `name` relative to the **profile directory**, where dependencies like `zod`, `sherpa-onnx-node` and `@deepseek-ai/*` do not exist. So `install.sh` creates a **symlink** `~/.dsh/profiles/web/node_modules/dsh-speech-to-text-whisper → <harness>/node_modules/dsh-speech-to-text-whisper`. A copy in that location will fail with `failed to import`.

## Verify / repair / remove

```bash
bash ensure.sh               # 5-point health check, repairs what is missing
bash ensure.sh --check-only  # check only (exit 1 if broken)
bash uninstall.sh            # remove; keeps the model cache
bash uninstall.sh --purge    # also removes the ~991 MB model cache
```

Checks: package installed and importable, registry block present in the profile patch (`defaultProvider: whisper-local`), symlink correct, module resolvable from the profile directory, model cache intact (size + sha256 against the lock).

## How it is wired

- Package installed at `<harness>/node_modules/dsh-speech-to-text-whisper`.
- Registry block appended to the profile patch (`cordis.patch.yml`), marked with `# >>> dsh-speech-to-text-whisper <<<` markers so `uninstall.sh` can remove it precisely. It inserts the provider, sets it as default, and disables SenseVoice.
- Overridable paths (env): `DSH_HARNESS_DIR`, `DSH_PROFILE_DIR`, `DSH_DATA_DIR`, `DSH_WHISPER_MODELS_DIR`.

## Tuning (provider config)

`providerId`, `model` (`turbo` | `large-v3`), `threads`, `segmentSeconds` (max 29), `minDecodeSeconds`, VAD thresholds, timeouts — see the `Config` schema in `pkg/dsh-speech-to-text-whisper/lib/worker.js` and the provider README inside the package.

**Custom-term corrections**: `lib/worker.js` has a `CORRECOES_NOMES` list (regex → replacement, whole word). Put *your* proper names and jargon there — it's the same idea as a user dictionary.

## Tests

Structure tests with plain Node (no dependencies, no model download):

```bash
node --test tests/    # 12 tests: pinned assets, registry block, custom-term list, repo hygiene
```

## Building the package (maintainers)

The `pkg/` tree was produced from the official SenseVoice package by two verified patch scripts:

```bash
python3 patch-index.py     # adapts index.js (languages, provider wiring) — aborts on any mismatch
python3 patch-decode.py    # groups short VAD segments before decoding
```

Each replacement must match exactly once or the script aborts without writing.

## License

MIT (see `LICENSE` for the repository glue; `pkg/dsh-speech-to-text-whisper/LICENSE` retains **Copyright (c) 2026 DeepSeek** for the upstream-derived code).

---

## Como funciona em pt-BR

Provider de **speech-to-text local para o DeepSeek Harness (`dsh`)** que troca o SenseVoice embutido (que não cobre português) pelo **Whisper large-v3-turbo via sherpa-onnx** — ditado em português do Brasil, **100% offline**, com sha256 conferido.

```bash
bash install.sh      # idempotente; faz backup do patch do perfil
bash ensure.sh       # confere 5 pontos e repara o que faltar
bash uninstall.sh    # desfaz (cache do modelo sai só com --purge)
```

Depois: **reinicie o servidor dsh web** e recarregue o navegador (Ctrl+Shift+R). O reconhecedor aparece como "Whisper turbo (sherpa-onnx)".

Detalhe crítico: o **symlink** em `~/.dsh/profiles/web/node_modules` é obrigatório (o loader resolve o pacote relativo ao perfil; uma cópia no lugar falha com `failed to import` — o `install.sh` cuida disso).
