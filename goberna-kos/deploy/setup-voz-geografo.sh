#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# setup-voz-geografo.sh — instala la voz de Ivi en geógrafo (100.117.204.80).
#
#   TTS: Piper (local, CPU, 0 VRAM) + una voz español.
#   STT: faster-whisper (small int8) en el venv del engine.
#
# CORRELO EN GEÓGRAFO, no desde un agente (necesita el box y su red). Idempotente.
# Después, en el service del engine (systemd), exportá:
#   IVI_PIPER_BIN=/srv/ia-local/piper/piper
#   IVI_PIPER_VOICE=/srv/ia-local/piper-voices/es_MX-claude-high.onnx
#   IVI_WHISPER_MODEL=small   IVI_WHISPER_DEVICE=cpu   (o cuda si hay VRAM libre)
# y reiniciá ivi.service. Probá con: curl -s localhost:8080/api/health | jq .voz
#
# NOTA (Ley I del deploy): las URLs/versiones de abajo hay que CONFIRMARLAS al
# correr (Piper se movió de rhasspy a OHF-Voice; las voces viven en HF). No las
# tomes como fijas: verificá el release vigente.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

BASE=/srv/ia-local
PIPER_DIR="$BASE/piper"
VOICES="$BASE/piper-voices"
mkdir -p "$PIPER_DIR" "$VOICES"

# 1) Piper (binario standalone Linux x86_64; sin Python). CONFIRMÁ el release.
if [ ! -x "$PIPER_DIR/piper" ]; then
  echo ">> Bajando Piper (confirmá la última release en github.com/OHF-Voice/piper1-gpl/releases)"
  # Ejemplo (ajustá la versión):
  # curl -fsSL -o /tmp/piper.tar.gz \
  #   https://github.com/OHF-Voice/piper1-gpl/releases/download/<VER>/piper_linux_x86_64.tar.gz
  # tar -xzf /tmp/piper.tar.gz -C "$PIPER_DIR" --strip-components=1
  echo "!! Descomentá y ajustá la URL del release de Piper antes de correr." ; exit 2
fi

# 2) Voz español baseline (es_MX). Para probar la calidad, bajá varias y escuchá.
#    (es-PE no existe en Piper; ver docs/26 para la voz peruana buena.)
grab_voice () { # $1 = ruta relativa en HF piper-voices
  local f; f="$(basename "$1")"
  [ -f "$VOICES/$f" ] || curl -fsSL -o "$VOICES/$f" \
    "https://huggingface.co/rhasspy/piper-voices/resolve/main/$1"
  [ -f "$VOICES/$f.json" ] || curl -fsSL -o "$VOICES/$f.json" \
    "https://huggingface.co/rhasspy/piper-voices/resolve/main/$1.json"
}
grab_voice "es/es_MX/claude/high/es_MX-claude-high.onnx"
grab_voice "es/es_AR/daniela/high/es_AR-daniela-high.onnx"   # opción a escuchar
echo ">> Voces en $VOICES. Probá: echo 'Hola, soy Ivi.' | $PIPER_DIR/piper -m $VOICES/es_MX-claude-high.onnx -f /tmp/ivi.wav"

# 3) faster-whisper en el venv del engine (NO en el Python del sistema).
#    En geógrafo hay Python de sobra; usá el mismo venv donde corre el engine.
VENV="$BASE/venv"
[ -d "$VENV" ] || python3 -m venv "$VENV"
"$VENV/bin/pip" install -q --upgrade pip
"$VENV/bin/pip" install -q faster-whisper
# El modelo se baja solo la 1ª vez a ~/.cache/huggingface (small int8 ~1-2GB VRAM,
# o CPU). Pre-cacheá:
"$VENV/bin/python" - <<'PY'
from faster_whisper import WhisperModel
WhisperModel("small", device="cpu", compute_type="int8")
print("faster-whisper small OK")
PY

echo ">> Listo. Exportá las env vars en ivi.service y reiniciá. Probá /api/health."
