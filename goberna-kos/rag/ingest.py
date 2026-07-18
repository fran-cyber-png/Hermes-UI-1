"""Ingestión del corpus -> rag.documentos. Idempotente por documento.

Uso:
  python3 -m rag.ingest              # ingesta todo el corpus (docs/ + catalog.json)
  python3 -m rag.ingest --solo plataformas   # solo docs cuya ruta contenga 'plataformas'
  python3 -m rag.ingest --stats      # no ingesta: reporta lo que ya hay

Corre desde goberna-kos/ (para que `-m rag.ingest` resuelva). Requiere Ollama sirviendo bge-m3
y el Postgres local con pgvector (docker compose up).
"""

import json
import os
import sys

from . import config, store
from .chunker import chunk_markdown
from .embedder import embed


def _fuente_de(relpath: str) -> str:
    """La categoría: el directorio relativo. 'docs/plataformas/x.md' -> 'docs/plataformas'."""
    d = os.path.dirname(relpath)
    return d or "docs"


def _es_sensible(relpath: str) -> bool:
    return any(relpath.startswith(p) for p in config.SENSIBLE_PREFIJOS)


def _docs_markdown() -> list[str]:
    """Todas las rutas .md bajo docs/, relativas al repo."""
    rutas = []
    for base, _dirs, files in os.walk(config.DOCS_DIR):
        for f in files:
            if f.endswith(".md"):
                rutas.append(os.path.relpath(os.path.join(base, f), config.REPO_ROOT))
    return sorted(rutas)


def _chunks_de_catalogo() -> list[dict]:
    """Una unidad recuperable por CQ: pregunta canónica + respuesta esperada. Doble como few-shot."""
    if not os.path.exists(config.CQ_CATALOG):
        return []
    with open(config.CQ_CATALOG, encoding="utf-8") as fh:
        data = json.load(fh)
    items = data if isinstance(data, list) else data.get("cqs") or data.get("items") or []
    chunks = []
    for i, cq in enumerate(items):
        texto = (cq.get("text") or cq.get("pregunta") or "").strip()
        resp = (cq.get("expectedAnswer") or cq.get("respuesta") or "").strip()
        if not texto:
            continue
        cuerpo = f"P: {texto}\nR: {resp}".strip()
        chunks.append({
            "texto": cuerpo,
            "posicion": i,
            "headings": [cq.get("domain") or cq.get("dominio") or ""],
            "meta": {
                "cq_id": cq.get("id"),
                "slug": cq.get("slug"),
                "dominio": cq.get("domain") or cq.get("dominio"),
                "tipo": cq.get("type") or cq.get("tipo"),
            },
        })
    return chunks


def _ingestar_chunks(cur, *, doc: str, fuente: str, sensible: bool, chunks: list[dict]) -> int:
    """Embebe con el backend que le toca al doc (split: público→Cohere, sensible→bge-m3) y upserta."""
    backend, tag = config.embedder_para(sensible)
    vectores = embed([c["texto"] for c in chunks], backend=backend, input_type="document")
    return store.upsert_doc(cur, doc=doc, fuente=fuente, sensible=sensible,
                            chunks=chunks, vectores=vectores, embedder=tag)


def _ingestar_doc(cur, relpath: str) -> int:
    abspath = os.path.join(config.REPO_ROOT, relpath)
    with open(abspath, encoding="utf-8") as fh:
        md = fh.read()
    chunks = chunk_markdown(md)
    if not chunks:
        return 0
    return _ingestar_chunks(cur, doc=relpath, fuente=_fuente_de(relpath),
                            sensible=_es_sensible(relpath), chunks=chunks)


def main(argv: list[str]) -> int:
    solo = None
    if "--solo" in argv:
        i = argv.index("--solo")
        if i + 1 >= len(argv):
            print("--solo requiere un valor (substring de la ruta)")
            return 2
        solo = argv[i + 1]

    conn = store.conectar()
    conn.autocommit = False
    try:
        with conn.cursor() as cur:
            if "--stats" in argv:
                print(json.dumps(store.stats_por_embedder(cur), ensure_ascii=False, indent=2))
                return 0

            print(f"modo={config.MODO_EMBEDDER}")
            total_docs = total_chunks = 0

            # 1) Markdown
            for relpath in _docs_markdown():
                if solo and solo not in relpath:
                    continue
                n = _ingestar_doc(cur, relpath)
                if n:
                    total_docs += 1
                    total_chunks += n
                    _b, tag = config.embedder_para(_es_sensible(relpath))
                    marca = " [sensible]" if _es_sensible(relpath) else ""
                    print(f"  ✓ {relpath}{marca}: {n} chunks ({tag})")

            # 2) Catálogo de CQs (JSON-aware, público)
            if not solo or solo == "cq-catalog":
                cq_chunks = _chunks_de_catalogo()
                if cq_chunks:
                    n = _ingestar_chunks(cur, doc="cq-catalog", fuente="cq-catalog",
                                         sensible=False, chunks=cq_chunks)
                    total_docs += 1
                    total_chunks += n
                    print(f"  ✓ cq-catalog: {n} chunks")

        conn.commit()
        with conn.cursor() as cur:
            por = store.stats_por_embedder(cur)
        print(f"\nOK — {total_docs} docs, {total_chunks} chunks (modo {config.MODO_EMBEDDER}).")
        for row in por:
            print(f"    {row['embedder']}: {row['chunks']} chunks / {row['docs']} docs")
        return 0
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
