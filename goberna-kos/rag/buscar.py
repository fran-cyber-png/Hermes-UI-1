"""buscar_docs(query, k) — la herramienta SEMÁNTICA de Ivi.

Embebe la consulta con el MISMO embedder que ingestó, corre el KNN por coseno sobre pgvector, y
devuelve chunks con su similitud y su cita (doc + encabezados). NUNCA cruza embedders distintos.

Uso CLI:  python3 -m rag.buscar "ROAS por país" -k 5
"""

import sys

from . import config, store
from .embedder import embed_uno


def buscar_docs(query: str, k: int = 5, *, incluir_sensibles: bool = True,
                fuentes: list[str] | None = None) -> list[dict]:
    """KNN por coseno. En modo 'split' consulta cada espacio (público=Cohere, sensible=bge-m3) con
    la consulta embebida por SU backend, y mergea — nunca compara vectores de espacios distintos."""
    filas: list[dict] = []
    conn = store.conectar()
    try:
        with conn.cursor() as cur:
            for backend, tag in config.tags_busqueda(incluir_sensibles):
                qvec = embed_uno(query, backend=backend, input_type="query")
                filas.extend(store.buscar(
                    cur, vector=qvec, query=query, k=k, embedder=tag,
                    incluir_sensibles=incluir_sensibles, fuentes=fuentes, hibrido=config.HIBRIDO,
                ))
    finally:
        conn.close()
    # Un solo espacio (default): ya viene fusionado (RRF) y ordenado. Multi (split): re-ordenar por
    # el score RRF (o similitud si faltara). Público/sensible son disjuntos → casi no compiten.
    filas.sort(key=lambda f: f.get("rrf", f.get("similitud") or 0.0), reverse=True)
    filas = filas[:k]
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
