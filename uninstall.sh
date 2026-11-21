#!/usr/bin/env bash
# Desfaz a instalacao do provider Whisper de ditado.
#
# Remove exatamente o que este projeto criou, nesta ordem:
#   1. o symlink em ~/.dsh/profiles/web/node_modules
#   2. o pacote em <harness>/node_modules
#   3. o bloco marcado no patch do perfil
#   4. a entrada de dependencia no manifesto do perfil (se existir)
# O cache do modelo so sai com --purge.
#
# Nao restaura o backup inteiro do perfil, para nao descartar outras alteracoes
# que voce tenha feito depois. Todo arquivo alterado ganha backup ao lado.
#
#   bash uninstall.sh           mantem o cache do modelo
#   bash uninstall.sh --purge   remove tambem os ~991 MB de modelo
set -euo pipefail

HARNESS="${DSH_HARNESS_DIR:-$HOME/.local/lib/node_modules/@deepseek-ai/dsh}"
DEST="$HARNESS/node_modules/dsh-speech-to-text-whisper"
PROFILE_DIR="${DSH_PROFILE_DIR:-$HOME/.dsh/profiles/web}"
PROFILE="$PROFILE_DIR/cordis.patch.yml"
MANIFEST="$PROFILE_DIR/package.json"
LINK="$PROFILE_DIR/node_modules/dsh-speech-to-text-whisper"
CACHE="${DSH_DATA_DIR:-$HOME/.dsh/speech-to-text/whisper}"
MARKER="# >>> dsh-speech-to-text-whisper <<<"
BUNDLE="dsh-speech-to-text-whisper"

say() { printf '  %s\n' "$*"; }

echo "1/4  removendo o symlink do perfil"
if [ -L "$LINK" ]; then
  rm -f "$LINK"
  say "symlink removido: $LINK"
elif [ -e "$LINK" ]; then
  rm -rf "$LINK"
  say "copia removida: $LINK"
else
  say "sem symlink (nada a fazer)"
fi

echo "2/4  removendo o pacote instalado"
if [ -d "$DEST" ]; then
  rm -rf "$DEST"
  say "removido: $DEST"
else
  say "nao estava instalado (nada a fazer)"
fi

echo "3/4  removendo o bloco de registro no patch do perfil"
if grep -qF "$MARKER" "$PROFILE"; then
  cp -a "$PROFILE" "$PROFILE.bak-uninstall-$(date +%Y%m%d-%H%M%S)"
  python3 - "$PROFILE" "$MARKER" <<'PY'
import sys, pathlib
path, marker = pathlib.Path(sys.argv[1]), sys.argv[2]
lines = path.read_text(encoding="utf-8").splitlines(keepends=True)
out, state, removed = [], "keep", 0
for line in lines:
    if line.strip() == marker:
        state = "skip" if state == "keep" else "keep"
        continue
    if state == "skip":
        removed += 1
        continue
    out.append(line)
while out and not out[-1].strip():
    out.pop()
path.write_text("".join(out) + "\n", encoding="utf-8")
print(f"  removidas {removed} linhas do bloco")
PY
  say "backup do perfil salvo ao lado"
else
  say "bloco nao encontrado (nada a fazer)"
fi

echo "4/4  limpando a dependencia no manifesto do perfil, se existir"
if [ -f "$MANIFEST" ]; then
  python3 - "$MANIFEST" "$BUNDLE" <<'PY'
import json, sys, pathlib, shutil, datetime
path, bundle = pathlib.Path(sys.argv[1]), sys.argv[2]
data = json.loads(path.read_text(encoding="utf-8"))
deps = data.get("dependencies") or {}
if bundle in deps:
    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    shutil.copy2(path, f"{path}.bak-uninstall-{stamp}")
    deps.pop(bundle)
    data["dependencies"] = deps
    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    print(f"  dependencia '{bundle}' removida (o nome nao existe no npm)")
else
    print("  sem dependencia a remover")
PY
else
  say "manifesto nao encontrado"
fi

if [ "${1:-}" = "--purge" ]; then
  echo "extra  removendo o cache do modelo"
  if [ -d "$CACHE" ]; then
    rm -rf "$CACHE"
    say "cache removido: $CACHE"
  else
    say "cache ja nao existia"
  fi
else
  say "cache mantido em $CACHE (use --purge para remover)"
fi

echo
echo "DESINSTALACAO CONCLUIDA"
echo
echo "Reinicie o servidor dsh web para o perfil voltar ao estado sem o provedor."
echo "O bundle Voice Input continua ligado; so o reconhecedor Whisper foi removido."
echo "O diretorio ~/.dsh/profiles/web/node_modules foi mantido (pode estar vazio)."
