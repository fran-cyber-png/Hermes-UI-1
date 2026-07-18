"""Configuración del RAG. Todo env-overridable; los defaults apuntan al entorno LOCAL de dev."""

import os

# ── Postgres (el mismo que opera meta-escuela; pgvector ya instalado) ──
# DSN de dev LOCAL: las credenciales viven en docker-compose.yml (no son secreto — solo loopback).
# En otro entorno, override con RAG_DATABASE_URL (o el DATABASE_URL del backend).
DATABASE_URL = os.environ.get(
    "RAG_DATABASE_URL",
    os.environ.get("DATABASE_URL", "postgresql://meta_escuela:meta_escuela_dev@localhost:5434/meta_escuela"),
)

# ── Embedder(s) ──
# Dos backends 1024-dim: bge-m3 LOCAL (Ollama) y Cohere embed-multilingual-v3 (Bedrock, vía AWS CLI).
#   MODO local → TODO con bge-m3 (un solo espacio; sin nube; default seguro/offline).
#   MODO split → docs PÚBLICOS con Cohere (aplica el crédito AWS), docs SENSIBLES con bge-m3 (Ley I:
#                el texto sensible NUNCA sale a la nube). Dos espacios vectoriales: cada fila lleva su
#                `embedder` y buscar_docs consulta cada espacio por separado (nunca compara cruzado).
MODO_EMBEDDER = os.environ.get("RAG_MODO_EMBEDDER", "local")   # local | split

# El embedder LOCAL (bge-m3) vive en GEOGRAFO (la A4000, always-on donde corre Ivi), NO en la Mac
# (decisión de Estephano 2026-07-18): así no depende de que la workstation esté prendida y usa la
# GPU. bge-m3 es el mismo modelo en cualquier host → mismos vectores; solo cambia dónde corre.
# Default = IP Tailscale de geografo; override con RAG_OLLAMA_URL (p.ej. localhost si el tool corre
# EN geografo).
OLLAMA_URL = os.environ.get("RAG_OLLAMA_URL", "http://100.117.204.80:11434")
EMBEDDER_MODEL = os.environ.get("RAG_EMBEDDER_MODEL", "bge-m3")
EMBEDDING_DIMS = 1024
EMBEDDER_BACKEND = os.environ.get("RAG_EMBEDDER_BACKEND", "ollama")  # backend del modo 'local'

# Etiquetas de la columna documentos.embedder. NUNCA se comparan vectores de tags distintos.
TAG_LOCAL = os.environ.get("RAG_TAG_LOCAL", "ollama:bge-m3")
TAG_COHERE = os.environ.get("RAG_TAG_COHERE", "bedrock:cohere-embed-multilingual-v3")

# Bedrock (Cohere) vía AWS CLI — mismas creds del perfil ~/.aws que `aws sts get-caller-identity`.
BEDROCK_REGION = os.environ.get("RAG_BEDROCK_REGION", "us-east-1")
BEDROCK_MODEL_ID = os.environ.get("RAG_BEDROCK_MODEL_ID", "cohere.embed-multilingual-v3")


def embedder_para(sensible: bool) -> tuple[str, str]:
    """(backend, tag) para INGESTAR un doc. Sensible SIEMPRE local (Ley I); público → Cohere en
    split, bge-m3 en local."""
    if MODO_EMBEDDER == "split" and not sensible:
        return ("bedrock", TAG_COHERE)
    return (EMBEDDER_BACKEND, TAG_LOCAL)


# Hybrid search (vector + full-text español, RRF). OFF por default: con el golden set de n=18 no
# mostró mejora de recall@3 y regresó recall@1 (RRF aplana la confianza del denso, que ya es fuerte).
# El código + índice GIN quedan listos; re-evaluar y prender cuando el golden set sea grande (Tier 0).
HIBRIDO = os.environ.get("RAG_HIBRIDO", "0") == "1"

# Curación SOFT: penaliza (suma a la distancia coseno) los docs categoría 'dev'/meta (specs, prompts,
# bitácoras, notas de ingeniería) para que no contaminen las respuestas de NEGOCIO, sin excluirlos.
# 0.03 es una nudge suave (el rango relevante de distancia es ~0.35-0.55). 0 = sin penalización.
PENALIZAR_DEV = float(os.environ.get("RAG_PENALIZAR_DEV", "0.03"))


def tags_busqueda(incluir_sensibles: bool) -> list[tuple[str, str]]:
    """Los espacios (backend, tag) que buscar_docs consulta, según el modo."""
    if MODO_EMBEDDER == "split":
        espacios = [("bedrock", TAG_COHERE)]                     # público (Cohere)
        if incluir_sensibles:
            espacios.append((EMBEDDER_BACKEND, TAG_LOCAL))       # sensible (local)
        return espacios
    return [(EMBEDDER_BACKEND, TAG_LOCAL)]                        # local: un solo espacio

# ── Chunking ──
# Tamaños en CARACTERES (aprox). bge-m3 admite hasta 8192 tokens, pero chunks chicos y enfocados
# recuperan mejor (menos dilución). ~1200 chars ≈ 300-400 tokens; solape para no cortar ideas.
CHUNK_CHARS = int(os.environ.get("RAG_CHUNK_CHARS", "1200"))
CHUNK_OVERLAP = int(os.environ.get("RAG_CHUNK_OVERLAP", "200"))
CHUNK_MIN = int(os.environ.get("RAG_CHUNK_MIN", "120"))  # descarta fragmentos-basura más cortos

# Lote de embeddings por request a Ollama (bge-m3 acepta lista en `input`).
EMBED_BATCH = int(os.environ.get("RAG_EMBED_BATCH", "32"))

# ── Backend meta-escuela (la ruta ESTRUCTURADA: el catálogo SDK governa.*) ──
# consultar_bi() invoca POST {BACKEND}/api/sdk/invocar/:nombre (read-only, idempotente).
BACKEND = os.environ.get("RAG_BACKEND", "http://localhost:4100")

# Chat LLM opcional para redactar la prosa (Ley I: solo REDACTA hechos ya calculados). Si no hay
# modelo de chat local, ask() devuelve la evidencia estructurada + un resumen templado (sin prosa).
CHAT_MODEL = os.environ.get("RAG_CHAT_MODEL", "")  # p.ej. "qwen3:8b"; vacío = sin prosa LLM

# ── Corpus ──
# Raíz del repo (meta-escuela/meta-escuela). Este archivo vive en goberna-kos/rag/.
REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
DOCS_DIR = os.path.join(REPO_ROOT, "docs")
CQ_CATALOG = os.path.join(REPO_ROOT, "goberna-kos", "cqs", "catalog.json")

# Clasificación de sensibilidad por RUTA (primer corte, nivel-archivo). Cualquier doc cuya ruta
# relativa matchee uno de estos prefijos lleva sensible=true (cifras reales ROAS/CAC/ventas).
# La clasificación por CHUNK (un párrafo con cifras dentro de un doc público) es un refinamiento
# documentado para la capa del split de embedders.
SENSIBLE_PREFIJOS = ["docs/loops"]
