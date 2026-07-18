"""buscar_docs(query, k) — la herramienta SEMÁNTICA de Ivi.

Embebe la consulta con el MISMO embedder que ingestó, corre el KNN por coseno sobre pgvector, y
devuelve chunks con su similitud y su cita (doc + encabezados). NUNCA cruza embedders distintos.

Uso CLI:  python3 -m rag.buscar "ROAS por país" -k 5
"""

import json
import sys
import urllib.request

from . import config, store
from .embedder import embed_uno


def _rerank(query: str, filas: list[dict], k: int) -> list[dict]:
    """Reordena con el cross-encoder (bge-reranker-v2-m3) sobre los top-N recuperados. Si el
    servicio falla, deja el orden del vector/RRF (degradación limpia)."""
    if not (config.RERANKER_URL and len(filas) > 1):
        return filas[:k]
    try:
        body = json.dumps({"query": query, "documents": [f["chunk"] for f in filas]}).encode()
        req = urllib.request.Request(config.RERANKER_URL.rstrip("/") + "/rerank", data=body,
                                     headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=20) as r:
            scores = json.loads(r.read().decode()).get("scores") or []
        for f, s in zip(filas, scores):
            f["rerank_score"] = round(float(s), 4)
        filas.sort(key=lambda f: f.get("rerank_score", -1), reverse=True)
    except Exception:  # noqa: BLE001 — el reranker es un plus, no un punto de falla
        pass
    return filas[:k]


def buscar_docs(query: str, k: int = 5, *, incluir_sensibles: bool = True,
                fuentes: list[str] | None = None) -> list[dict]:
    """KNN por coseno + (opcional) rerank cross-encoder. En modo 'split' consulta cada espacio con
    la consulta embebida por SU backend y mergea — nunca compara vectores de espacios distintos."""
    n_ret = max(k, config.RERANK_TOPN) if config.RERANKER_URL else k  # ventana ancha si hay reranker
    filas: list[dict] = []
    conn = store.conectar()
    try:
        with conn.cursor() as cur:
            for backend, tag in config.tags_busqueda(incluir_sensibles):
                qvec = embed_uno(query, backend=backend, input_type="query")
                filas.extend(store.buscar(
                    cur, vector=qvec, query=query, k=n_ret, embedder=tag,
                    incluir_sensibles=incluir_sensibles, fuentes=fuentes, hibrido=config.HIBRIDO,
                ))
    finally:
        conn.close()
    # Ordenar por RRF/similitud, tomar top-N, y reordenar a k con el cross-encoder si está.
    filas.sort(key=lambda f: f.get("rrf", f.get("similitud") or 0.0), reverse=True)
    filas = _rerank(query, filas[:n_ret], k)
    for f in filas:
        heads = [h for h in ((f.get("metadata") or {}).get("headings") or []) if h]
        f["cita"] = f["doc"] + ((" › " + " › ".join(heads)) if heads else "")
    return filas


def _cli(argv: list[str]) -> int:
    if not argv:
        print('uso: python3 -m rag.buscar "tu pregunta" [-k 5] [--publicos]')
        return 2
    k = 5
    if "-k" in argv:
        i = argv.index("-k")
        if i + 1 >= len(argv):
            print("-k requiere un número")
            return 2
        k = int(argv[i + 1])
    incluir = "--publicos" not in argv
    query = argv[0]
    for f in buscar_docs(query, k, incluir_sensibles=incluir):
        s = f["similitud"]
        marca = " [sensible]" if f["sensible"] else ""
        print(f"\n[{s:.3f}]{marca} {f['cita']}")
        txt = f["chunk"].replace("\n", " ")
        print("   " + (txt[:220] + "…" if len(txt) > 220 else txt))
    return 0


if __name__ == "__main__":
    sys.exit(_cli(sys.argv[1:]))
