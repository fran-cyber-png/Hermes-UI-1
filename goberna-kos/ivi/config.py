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
