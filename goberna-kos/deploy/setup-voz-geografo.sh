#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# setup-voz-geografo.sh — instala la voz de Ivi en geógrafo (100.117.204.80).
#
#   TTS: Piper (binario standalone, CPU, 0 VRAM) + voz español es_MX.
#   STT: faster-whisper (small int8) en un venv, importado por el engine vía
#        PYTHONPATH (el engine sigue corriendo con el system python3.14).
#
# DESPLEGADO Y VERIFICADO el 2026-07-17 con estos mismos pasos (TTS Piper es_MX +
# STT whisper small, loop cerrado OK). CORRELO EN GEÓGRAFO (shell del usuario =
# fish, por eso el engine/deploy usan `bash`). Idempotente.
#
# Notas reales del deploy:
#   - geógrafo es EXTERNALLY-MANAGED (Arch/PEP 668) -> nada de pip al sistema;
#     faster-whisper va en un venv. ctranslate2 4.8.1 SÍ tiene wheel para py3.14.
#   - El engine NO cambia de intérprete (ExecStart intacto): se le pasa el
#     site-packages del venv por PYTHONPATH en un drop-in de systemd.
#   - La descarga de la voz (~63MB) puede cortarse; el script reintenta con -C -.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

BASE=/home/geografo/ia-local
PIPER_DIR="$BASE/piper"
VOICES="$BASE/piper-voices"
VENV="$BASE/venv"
mkdir -p "$VOICES"

# 1) Piper (binario standalone Linux x86_64; trae onnxruntime + espeak-ng-data).
if [ ! -x "$PIPER_DIR/piper" ]; then
  echo ">> Piper"
  curl -fsSL -o /tmp/piper.tar.gz \
    https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_linux_x86_64.tar.gz
  tar -xzf /tmp/piper.tar.gz -C "$BASE"   # crea $BASE/piper/
fi

# 2) Voz español es_MX (baseline). Descarga robusta (resume) + verificación.
VOICE="$VOICES/es_MX-claude-high.onnx"
URL="https://huggingface.co/rhasspy/piper-voices/resolve/main/es/es_MX/claude/high/es_MX-claude-high.onnx"
for try in 1 2 3; do
  [ -f "$VOICE.json" ] || curl -fsSL -o "$VOICE.json" "$URL.json"
  curl -fsSL -C - -o "$VOICE" "$URL" || true
  # valida que sea un ONNX parseable (si está truncado, piper aborta)
  if echo "prueba" | "$PIPER_DIR/piper" --model "$VOICE" --output_file /tmp/_v.wav 2>/dev/null; then
    echo ">> voz OK"; break
  fi
  echo ">> voz incompleta, reintento $try"
done

# 3) faster-whisper en un venv (NO al sistema).
[ -d "$VENV" ] || python3 -m venv "$VENV"
"$VENV/bin/pip" install -q --upgrade pip
"$VENV/bin/pip" install -q faster-whisper
"$VENV/bin/python" - <<'PY'
from faster_whisper import WhisperModel
WhisperModel("small", device="cpu", compute_type="int8")   # pre-cachea el modelo
print("faster-whisper small OK")
PY

# 4) Drop-in de systemd: env de voz + el site-packages del venv por PYTHONPATH.
SITE="$VENV/lib/python3.14/site-packages"
sudo tee /etc/systemd/system/ivi.service.d/voz.conf >/dev/null <<CONF
[Service]
Environment=IVI_PIPER_BIN=$PIPER_DIR/piper
Environment=IVI_PIPER_VOICE=$VOICE
Environment=IVI_WHISPER_MODEL=small
Environment=IVI_WHISPER_DEVICE=cpu
Environment=PYTHONPATH=$SITE
CONF
sudo systemctl daemon-reload
sudo systemctl restart ivi
sleep 3
echo ">> health.voz:"; curl -s -m 6 http://localhost:8080/api/health \
  | python3 -c 'import sys,json;print(json.load(sys.stdin).get("voz"))'
echo ">> esperado: {'tts': 'piper', 'stt': True}"
