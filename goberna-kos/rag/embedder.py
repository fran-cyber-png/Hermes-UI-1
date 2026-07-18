"""embed(textos) -> vectores 1024-dim. Dos backends, misma firma:

  - ollama  : bge-m3 LOCAL (para docs SENSIBLES y para el modo 'local'). Vía HTTP.
  - bedrock : Cohere embed-multilingual-v3 (para docs PÚBLICOS). Vía el AWS CLI (mismas creds
              del perfil ~/.aws que ya usa `aws sts get-caller-identity`). Sin boto3 (PEP 668).

Regla de los DOS ESPACIOS VECTORIALES: ambos son 1024-dim pero espacios distintos. Nunca se
comparan cruzados; cada fila lleva su `embedder` tag y buscar_docs filtra por uno. Cohere además
distingue input_type (search_document al ingestar, search_query al preguntar) — bge-m3 no.
"""

import json
import math
import os
import subprocess
import tempfile
import urllib.request

from . import config


class EmbedError(RuntimeError):
    pass


def _normalizar(v: list[float]) -> list[float]:
    n = math.sqrt(sum(x * x for x in v))
    return v if n == 0 else [x / n for x in v]


# ── Backend: Ollama (bge-m3 local) ──
def _post(url: str, payload: dict, timeout: int = 120) -> dict:
    req = urllib.request.Request(
        url, data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"}, method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8"))
    except Exception as e:  # noqa: BLE001
        raise EmbedError(f"Ollama embed falló ({url}): {e}") from e


def _embed_ollama(lote: list[str]) -> list[list[float]]:
    url = f"{config.OLLAMA_URL.rstrip('/')}/api/embed"
    data = _post(url, {"model": config.EMBEDDER_MODEL, "input": lote})
    vecs = data.get("embeddings")
    if not vecs or len(vecs) != len(lote):
        raise EmbedError(f"Ollama devolvió {len(vecs or [])} embeddings para {len(lote)}")
    return vecs


# ── Backend: Bedrock (Cohere) vía AWS CLI ──
def _embed_bedrock(lote: list[str], input_type: str) -> list[list[float]]:
    itype = "search_query" if input_type == "query" else "search_document"
    body = json.dumps({
        "texts": lote, "input_type": itype,
        "embedding_types": ["float"], "truncate": "END",
    }).encode("utf-8")
    bf = tempfile.NamedTemporaryFile("wb", suffix=".json", delete=False)
    bf.write(body); bf.close()
    out = bf.name + ".out"
    try:
        r = subprocess.run(
            ["aws", "bedrock-runtime", "invoke-model", "--region", config.BEDROCK_REGION,
             "--model-id", config.BEDROCK_MODEL_ID, "--body", f"fileb://{bf.name}", out],
            capture_output=True, text=True, timeout=120,
        )
        if r.returncode != 0:
            raise EmbedError(f"Bedrock invoke falló: {r.stderr.strip()[:300]}")
        with open(out, encoding="utf-8") as fh:
            data = json.load(fh)
    finally:
        for p in (bf.name, out):
            if os.path.exists(p):
                os.unlink(p)
    vecs = (data.get("embeddings") or {}).get("float")
    if not vecs or len(vecs) != len(lote):
        raise EmbedError(f"Cohere devolvió {len(vecs or [])} embeddings para {len(lote)}")
    return vecs


def _batch_de(backend: str) -> int:
    return 96 if backend == "bedrock" else config.EMBED_BATCH  # Cohere admite hasta 96 por llamada


def embed(textos: list[str], *, backend: str | None = None,
          input_type: str = "document", batch: int | None = None) -> list[list[float]]:
    """Un vector por texto (mismo orden), normalizado para coseno."""
    if not textos:
        return []
    backend = backend or config.EMBEDDER_BACKEND
    batch = batch or _batch_de(backend)
    out: list[list[float]] = []
    for i in range(0, len(textos), batch):
        lote = textos[i : i + batch]
        vecs = _embed_bedrock(lote, input_type) if backend == "bedrock" else _embed_ollama(lote)
        for v in vecs:
            if len(v) != config.EMBEDDING_DIMS:
                raise EmbedError(f"dim {len(v)} != {config.EMBEDDING_DIMS} (backend {backend})")
            # json.loads parsea NaN/Infinity; un embedding degenerado envenenaría el ::vector
            # (pgvector los rechaza) y, como la ingesta es una sola transacción, tumbaría TODO.
            if not all(math.isfinite(x) for x in v):
                raise EmbedError(f"embedding no-finito (NaN/inf) del backend {backend}")
            out.append(_normalizar(v))
    return out


def embed_uno(texto: str, *, backend: str | None = None, input_type: str = "query") -> list[float]:
    return embed([texto], backend=backend, input_type=input_type)[0]


def a_literal(vec: list[float]) -> str:
    """'[0.1,0.2,...]' — lo que pgvector parsea; se castea a ::vector al insertar."""
    return "[" + ",".join(repr(x) for x in vec) + "]"
