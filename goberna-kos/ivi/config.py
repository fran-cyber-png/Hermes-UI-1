"""Configuration for the Ivi analytical engine."""

# Backend de meta-escuela (Mac, local or via Tailscale).
BACKEND = "http://100.98.60.92:4100"

# Ollama (geógrafo, local).
OLLAMA_URL = "http://localhost:11434/api/generate"
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
