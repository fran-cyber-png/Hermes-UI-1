"""voz — TTS y STT para el loop de voz de Ivi (Fase C / docs/25).

Diseño pluggable con degradación limpia:

  - TTS: en producción (geógrafo, Linux) es **Piper** (local, CPU, 0 VRAM). En
    dev (macOS) cae a `say` para poder verificar el loop sin instalar nada. Si no
    hay ninguno, levanta TTSNoDisponible y el server responde 503 legible.
  - STT: **faster-whisper** (import perezoso). Si no está instalado, levanta
    STTNoDisponible; el engine sigue vivo sin la dependencia.

Ni el binario de Piper ni el modelo de whisper son dependencia dura del engine:
se resuelven en runtime. Así el engine se deploya igual y gana voz cuando los
binarios/modelos están presentes en geógrafo.

Configuración por env (defaults pensados para geógrafo):
  IVI_PIPER_BIN     ruta/binario de piper (default "piper" en PATH)
  IVI_PIPER_VOICE   ruta al modelo .onnx de la voz (sin esto, no hay Piper)
  IVI_SAY_VOICE     voz de `say` para dev macOS (default "Paulina", es_MX)
  IVI_WHISPER_MODEL tamaño faster-whisper (default "small")
  IVI_WHISPER_DEVICE "cpu" (default) | "cuda"
"""

import os
import platform
import shutil
import subprocess
import tempfile

PIPER_BIN = os.environ.get("IVI_PIPER_BIN", "piper")
PIPER_VOICE = os.environ.get("IVI_PIPER_VOICE", "")
SAY_VOICE = os.environ.get("IVI_SAY_VOICE", "Paulina")   # dev macOS, es_MX
WHISPER_MODEL = os.environ.get("IVI_WHISPER_MODEL", "small")
WHISPER_DEVICE = os.environ.get("IVI_WHISPER_DEVICE", "cpu")

MAX_TTS_CHARS = 1200   # cap: un resumen hablado, no un informe entero


class TTSNoDisponible(RuntimeError):
    """No hay motor de TTS resoluble (ni Piper ni say)."""


class STTNoDisponible(RuntimeError):
    """faster-whisper no está instalado."""


def _piper_ok() -> bool:
    return bool(PIPER_VOICE) and bool(shutil.which(PIPER_BIN) or os.path.exists(PIPER_BIN))


def _say_ok() -> bool:
    return platform.system() == "Darwin" and bool(shutil.which("say"))


def _whisper_ok() -> bool:
    try:
        import faster_whisper  # noqa: F401
        return True
    except Exception:
        return False


def estado() -> dict:
    """Para /api/health: qué backend de voz serviría ahora."""
    tts = "piper" if _piper_ok() else ("say" if _say_ok() else "no")
    return {"tts": tts, "stt": _whisper_ok()}


# ── TTS ──────────────────────────────────────────────────────────────────────

def tts(text: str) -> bytes:
    """Texto -> WAV (bytes), 22050 Hz mono. Piper en prod, say en dev macOS."""
    text = (text or "").strip()[:MAX_TTS_CHARS]
    if not text:
        raise TTSNoDisponible("texto vacío")
    if _piper_ok():
        return _tts_piper(text)
    if _say_ok():
        return _tts_say(text)
    raise TTSNoDisponible(
        "no hay TTS: configurá IVI_PIPER_VOICE (Piper) o corré en macOS (say)")


def _tts_piper(text: str) -> bytes:
    # Piper lee texto por stdin y escribe el WAV al archivo indicado.
    with tempfile.TemporaryDirectory() as d:
        out = os.path.join(d, "o.wav")
        p = subprocess.run([PIPER_BIN, "--model", PIPER_VOICE, "--output_file", out],
                           input=text.encode(), capture_output=True, timeout=60)
        if p.returncode != 0 or not os.path.exists(out):
            raise TTSNoDisponible(f"piper falló: {p.stderr.decode()[:200]}")
        with open(out, "rb") as f:
            return f.read()


def _tts_say(text: str) -> bytes:
    # Fallback de dev (macOS): say -> aiff -> ffmpeg -> wav 22050 mono.
    with tempfile.TemporaryDirectory() as d:
        aiff = os.path.join(d, "o.aiff")
        wav = os.path.join(d, "o.wav")
        subprocess.run(["say", "-v", SAY_VOICE, "-o", aiff, text], check=True, timeout=60)
        subprocess.run(["ffmpeg", "-y", "-i", aiff, "-ar", "22050", "-ac", "1", wav],
                       capture_output=True, check=True, timeout=60)
        with open(wav, "rb") as f:
            return f.read()


# ── STT ──────────────────────────────────────────────────────────────────────

_whisper_model = None


def stt(audio_bytes: bytes, ext: str = ".webm") -> str:
    """Audio (bytes) -> texto en español. faster-whisper, modelo cacheado."""
    global _whisper_model
    if not audio_bytes:
        raise STTNoDisponible("audio vacío")
    try:
        from faster_whisper import WhisperModel
    except Exception as e:
        raise STTNoDisponible(
            f"faster-whisper no instalado (instalá en geógrafo): {e}") from e
    if _whisper_model is None:
        _whisper_model = WhisperModel(WHISPER_MODEL, device=WHISPER_DEVICE,
                                      compute_type="int8")
    with tempfile.NamedTemporaryFile(suffix=ext, delete=True) as f:
        f.write(audio_bytes)
        f.flush()
        segs, _ = _whisper_model.transcribe(f.name, language="es", vad_filter=True)
        return " ".join(s.text for s in segs).strip()
