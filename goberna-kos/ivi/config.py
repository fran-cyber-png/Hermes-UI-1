"""Configuration for the Ivi analytical engine."""

import os

# Backend de meta-escuela (Mac, local or via Tailscale). Override por env para
# dev local del engine fuera de geógrafo. systemd no setea env -> default intacto.
BACKEND = os.environ.get("IVI_BACKEND", "http://100.98.60.92:4100")

# Ollama (geógrafo, local). Override por env: dev local apunta a la A4000 por
# Tailscale (IVI_OLLAMA_URL=http://100.117.204.80:11434/api/generate).
OLLAMA_URL = os.environ.get("IVI_OLLAMA_URL", "http://localhost:11434/api/generate")
MODEL = "ivi-ventas"

PORT = 8080

# Cache TTL for backend responses, in seconds. The backend data is slow-moving
# (it is a mirror of Cerberus), so a short TTL avoids hammering Postgres while
# keeping numbers fresh enough for analysis.
CACHE_TTL = 60

# Context window for Ollama.
OLLAMA_CTX = 8192
OLLAMA_TEMP = 0.3

# How long to wait for Ollama before giving up, in seconds.
# Ollama serves OLLAMA_NUM_PARALLEL requests at a time and queues the rest, so
# this budget covers queue wait + inference. One inference costs ~25s on the
# A4000; with 4 parallel slots the queue only grows past this under a burst well
# beyond normal use, and a request that waits this long is better failed than
# left hanging.
OLLAMA_TIMEOUT = 300

# ── P1/P2 (docs/19): caché de respuestas + warmer ──
# Las preguntas frecuentes: fuente ÚNICA — la UI las renderiza por inyección
# y el warmer las precalienta en background.
PREGUNTAS_SUGERIDAS = [
    "ventas por semana", "tendencia de ventas", "ventas por producto",
    "ventas por sede", "comparación mensual", "qué se vende más",
    "riesgos comerciales", "embudo de estados", "cartera y mora",
    "lazo con Meta y pérdidas", "ticket promedio", "forecast de ventas",
]

# ── Ivi Studio (Fase B): set de exploración creativa ──
# El warmer TAMBIÉN precalienta estas para que las chips del estudio den hit
# (≤19ms). NO entran a PREGUNTAS_SUGERIDAS (esas son las 12 de la UI BI): son un
# pool aparte que el drawer del estudio manda SIN `contexto` (hechos de negocio,
# Brief-independientes) para que el prompt calce con el que calienta el warmer.
PREGUNTAS_STUDIO = [
    "ROAS por país",
    "CAC por país",
    "atribución por país y canal",
    "Facebook vs Instagram",
    "qué país conviene para escalar la pauta",
    "ticket promedio por producto",
]

# Persistencia del caché de respuestas. Ruta relativa al WorkingDirectory
# (~/ia-local bajo systemd en geógrafo).
ANSWERS_CACHE = "answers-cache.json"

# Cada cuánto re-mira el warmer si hay que recalentar (collect() tiene TTL 60s
# y el hash da hit si nada cambió, así que el tick es casi gratis).
WARM_INTERVAL = 600
# Pausa entre generaciones del warmer: deja 3 slots libres para usuarios en vivo.
WARM_PAUSA = 2.0
