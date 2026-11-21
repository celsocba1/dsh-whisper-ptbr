#!/usr/bin/env bash
# Verifica se o ditado por voz continua instalado e funcional, e repara se nao.
#
# Use isto depois de qualquer operacao que mexa no ambiente: atualizacao do dsh,
# `dsh plugin`, `pnpm install` no perfil, ou simplesmente para conferir saude.
#
#   bash ensure.sh               verifica e repara o que faltar
#   bash ensure.sh --check-only  so verifica; sai com codigo 1 se algo estiver quebrado
#
# Os quatro pontos verificados:
#   1. pacote do provedor em <harness>/node_modules
#   2. bloco de registro no patch do perfil
#   3. symlink do perfil apontando para o pacote
#   4. cache do modelo integro (tamanho + sha256 contra o lock)
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
HARNESS="${DSH_HARNESS_DIR:-$HOME/.local/lib/node_modules/@deepseek-ai/dsh}"
DEST="$HARNESS/node_modules/dsh-speech-to-text-whisper"
PROFILE_DIR="${DSH_PROFILE_DIR:-$HOME/.dsh/profiles/web}"
PROFILE="$PROFILE_DIR/cordis.patch.yml"
LINK="$PROFILE_DIR/node_modules/dsh-speech-to-text-whisper"
CACHE="${DSH_DATA_DIR:-$HOME/.dsh/speech-to-text/whisper}"
MARKER="# >>> dsh-speech-to-text-whisper <<<"

CHECK_ONLY=0
[ "${1:-}" = "--check-only" ] && CHECK_ONLY=1

problems=0
ok()   { printf '  [ok]     %s\n' "$*"; }
bad()  { printf '  [FALHA]  %s\n' "$*"; problems=$((problems + 1)); }

echo "Verificando o ditado por voz (Whisper local)"
echo

echo "1. pacote do provedor"
if [ -f "$DEST/lib/index.js" ] && [ -f "$DEST/lib/worker.js" ] && [ -f "$DEST/runtime/assets.json" ]; then
  ok "instalado em $DEST"
  if node --input-type=module -e "import('$DEST/lib/index.js').then(()=>process.exit(0)).catch(()=>process.exit(1))" 2>/dev/null; then
    ok "modulo importavel"
  else
    bad "modulo existe mas nao importa"
  fi
else
  bad "ausente em $DEST"
fi

echo "2. registro no patch do perfil"
if [ -f "$PROFILE" ] && grep -qF "$MARKER" "$PROFILE"; then
  ok "bloco presente em $PROFILE"
  if grep -q 'defaultProvider: whisper-local' "$PROFILE"; then
    ok "whisper-local marcado como padrao"
  else
    bad "bloco presente, mas sem defaultProvider: whisper-local"
  fi
else
  bad "bloco ausente em $PROFILE"
fi

echo "3. symlink do perfil"
if [ -L "$LINK" ]; then
  target=$(readlink "$LINK")
  if [ "$target" = "$DEST" ]; then
    ok "symlink correto -> $target"
  else
    bad "symlink aponta para $target (esperado $DEST)"
  fi
  if [ -f "$LINK/lib/index.js" ]; then
    ok "destino do symlink existe"
  else
    bad "symlink quebrado: o destino nao existe"
  fi
elif [ -e "$LINK" ]; then
  bad "existe, mas e uma COPIA e nao um symlink (vai falhar no import)"
else
  bad "ausente: $LINK"
fi

echo "4. resolucao a partir do diretorio do perfil"
if (cd "$PROFILE_DIR" && node --input-type=module -e "import('dsh-speech-to-text-whisper').then(()=>process.exit(0)).catch(()=>process.exit(1))" 2>/dev/null); then
  ok "o boot vai conseguir importar"
else
  bad "o boot vai registrar 'failed to import'"
fi

echo "5. cache do modelo"
set +e
python3 - "$CACHE" "$DEST/runtime/assets.json" <<'PY'
import hashlib, json, pathlib, sys
cache, lockfile = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
if not lockfile.exists():
    print("  [FALHA]  lock de assets nao encontrado"); sys.exit(1)
lock = json.loads(lockfile.read_text())
checks = [
    (cache / "models/whisper-onnx" / lock["models"]["turbo"]["encoder"]["name"], lock["models"]["turbo"]["encoder"]),
    (cache / "models/whisper-onnx" / lock["models"]["turbo"]["decoder"]["name"], lock["models"]["turbo"]["decoder"]),
    (cache / "models/whisper-onnx" / lock["tokens"]["name"], lock["tokens"]),
    (cache / "models/silero" / lock["vad"]["name"], lock["vad"]),
]
bad = 0
for path, asset in checks:
    if not path.exists():
        print(f"  [FALHA]  ausente: {path.name}"); bad += 1; continue
    if path.stat().st_size != asset["bytes"]:
        print(f"  [FALHA]  tamanho diferente: {path.name}"); bad += 1; continue
    if hashlib.sha256(path.read_bytes()).hexdigest() != asset["sha256"]:
        print(f"  [FALHA]  sha256 diferente: {path.name}"); bad += 1; continue
    print(f"  [ok]     {path.name}")
sys.exit(1 if bad else 0)
PY
[ $? -ne 0 ] && problems=$((problems + 1))

echo
if [ "$problems" -eq 0 ]; then
  echo "TUDO CERTO — $problems problemas. O ditado deve funcionar no proximo carregamento."
  exit 0
fi

echo "ENCONTRADOS $problems PROBLEMAS."
if [ "$CHECK_ONLY" -eq 1 ]; then
  echo "Rode sem --check-only para reparar."
  exit 1
fi

echo
echo "Reparando com install.sh (idempotente)..."
echo
exec bash "$DIR/install.sh"
