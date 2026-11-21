#!/usr/bin/env bash
# Instala (ou repara) o provider Whisper local de ditado em portugues do Brasil.
#
# Estado final que este script garante -- o mesmo que foi validado em uso:
#   1. pacote em <harness>/node_modules/dsh-speech-to-text-whisper;
#   2. cache do modelo pre-semeado (~991 MB, sha256 conferido);
#   3. bloco de registro no patch do perfil (insert + defaultProvider);
#   4. SYMLINK em ~/.dsh/profiles/web/node_modules apontando para o pacote.
#
# O symlink e obrigatorio: o loader resolve o `name` da entrada relativamente ao
# diretorio do perfil. Sem ele o boot emite "failed to import". Uma COPIA no
# lugar do symlink tambem falha, porque as dependencias (zod, sherpa-onnx-node,
# @deepseek-ai/*) nao existem dentro do perfil.
#
# Idempotente. Faz backup antes de alterar o perfil.
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
SRC="$DIR/pkg/dsh-speech-to-text-whisper"
HARNESS="${DSH_HARNESS_DIR:-$HOME/.local/lib/node_modules/@deepseek-ai/dsh}"
DEST="$HARNESS/node_modules/dsh-speech-to-text-whisper"
PROFILE_DIR="${DSH_PROFILE_DIR:-$HOME/.dsh/profiles/web}"
PROFILE="$PROFILE_DIR/cordis.patch.yml"
LINK="$PROFILE_DIR/node_modules/dsh-speech-to-text-whisper"
CACHE="${DSH_DATA_DIR:-$HOME/.dsh/speech-to-text/whisper}"
# Modelos pre-semeados (opcional): se voce ja tiver os ONNX baixados, aponte
# DSH_WHISPER_MODELS_DIR para a pasta com models/whisper-onnx e models/silero.
# Sem isso, o provider baixa os assets na primeira execucao (origens e sha256 fixados
# em pkg/dsh-speech-to-text-whisper/runtime/assets.json).
STAGE="${DSH_WHISPER_MODELS_DIR:-}"
MARKER="# >>> dsh-speech-to-text-whisper <<<"

say() { printf '  %s\n' "$*"; }
fail() { printf 'ERRO: %s\n' "$*" >&2; exit 1; }

echo "1/6  conferindo pre-requisitos"
[ -d "$SRC/lib" ] || fail "pacote de origem nao encontrado em $SRC"
[ -f "$HARNESS/package.json" ] || fail "harness nao encontrado em $HARNESS"
[ -f "$PROFILE" ] || fail "perfil nao encontrado em $PROFILE"
if [ -n "$STAGE" ]; then
  for f in turbo-encoder.int8.onnx turbo-decoder.int8.onnx whisper-tokens.txt; do
    [ -f "$STAGE/models/whisper-onnx/$f" ] || fail "modelo ausente: $STAGE/models/whisper-onnx/$f"
  done
  [ -f "$STAGE/models/silero/silero_vad.onnx" ] || fail "VAD ausente em $STAGE/models/silero/"
fi
say "ok"

echo "2/6  instalando o pacote em $DEST"
rm -rf "$DEST"
mkdir -p "$DEST"
tar -C "$SRC" --exclude=./node_modules -cf - . | tar -C "$DEST" -xf -
say "instalado: $(find "$DEST" -type f | wc -l) arquivos"
node --input-type=module -e "import('$DEST/lib/index.js').then(m=>console.log('  import ok ->',Object.keys(m).join(','))).catch(e=>{console.error('  FALHA no import:',e.message);process.exit(1)})"

echo "3/6  cache do modelo em $CACHE"
mkdir -p "$CACHE/models/whisper-onnx" "$CACHE/models/silero"
if [ -n "$STAGE" ]; then
  for f in turbo-encoder.int8.onnx turbo-decoder.int8.onnx whisper-tokens.txt; do
    install -m 0644 "$STAGE/models/whisper-onnx/$f" "$CACHE/models/whisper-onnx/$f"
  done
  install -m 0644 "$STAGE/models/silero/silero_vad.onnx" "$CACHE/models/silero/silero_vad.onnx"
  say "cache pronto: $(du -sh "$CACHE" | cut -f1)"
else
  say "sem modelos locais: o provider baixa na 1a execucao (sha256 conferido) ~991 MB"
fi

echo "4/6  garantindo o bloco de registro no patch do perfil"
if grep -qF "$MARKER" "$PROFILE"; then
  say "bloco ja presente"
else
  cp -a "$PROFILE" "$PROFILE.bak-$(date +%Y%m%d-%H%M%S)"
  cat >> "$PROFILE" <<'PATCHEOF'

# >>> dsh-speech-to-text-whisper <<<
# Ditado em portugues do Brasil. O SenseVoice embutido nao cobre portugues e,
# neste build, o worker dele nao sobe (paths aninhados no index.js x planos no worker.js).
- insert:
    - id: speech-to-text-whisper
      name: 'dsh-speech-to-text-whisper'
      config:
        providerId: whisper-local
        dataRoot: !!js dshHomePath('speech-to-text', 'whisper')
        model: turbo
        threads: 8
- id: speech-to-text
  config:
    defaultProvider: whisper-local
- id: speech-to-text-sensevoice
  disabled: true
# >>> dsh-speech-to-text-whisper <<<
PATCHEOF
  say "bloco adicionado (backup do perfil salvo ao lado)"
fi

echo "5/6  criando o symlink no node_modules do perfil"
mkdir -p "$PROFILE_DIR/node_modules"
if [ -L "$LINK" ]; then
  say "symlink ja existe -> $(readlink "$LINK")"
elif [ -e "$LINK" ]; then
  rm -rf "$LINK"
  ln -sfn "$DEST" "$LINK"
  say "copia substituida por symlink -> $DEST"
else
  ln -sfn "$DEST" "$LINK"
  say "symlink criado -> $DEST"
fi

echo "6/6  verificando a resolucao a partir do diretorio do perfil"
cd "$PROFILE_DIR"
node --input-type=module -e "
import('dsh-speech-to-text-whisper').then(m => {
  const c = m.Config({ providerId: 'whisper-local', dataRoot: '$CACHE', model: 'turbo', threads: 8 });
  console.log('  resolucao ok ->', Object.keys(m).join(','));
  console.log('  config ok    -> providerId:', c.providerId, '| model:', c.model,
              '| minDecodeSeconds:', c.minDecodeSeconds, '| segmentSeconds:', c.segmentSeconds);
}).catch(e => { console.error('  FALHOU:', e.code, '|', e.message.split('\n')[0]); process.exit(1); });
" || fail "resolucao falhou: o boot vai registrar 'failed to import'"

echo
echo "INSTALACAO CONCLUIDA"
echo
echo "Reinicie o servidor dsh web e recarregue o navegador com Ctrl+Shift+R."
echo "O reconhecedor deve aparecer como 'Whisper turbo (sherpa-onnx)', com portugues."
echo
