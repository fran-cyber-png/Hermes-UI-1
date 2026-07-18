"""Golden set -> recall@k + MRR. La evidencia de que la búsqueda semántica anda ANTES de
cablearla a Ivi, y el harness de regresión para tocar chunking/embedder/k con red.

Uso:  python3 -m rag.evaluar            # corre golden.json
      python3 -m rag.evaluar -k 10     # profundidad máxima a evaluar
"""

import json
import os
import sys

from . import config
from .buscar import buscar_docs

GOLDEN = os.path.join(os.path.dirname(__file__), "golden.json")
KS = [1, 3, 5, 10]


def _docs_ordenados(filas: list[dict]) -> list[str]:
    """Docs distintos en orden de aparición (varios chunks del mismo doc cuentan una vez)."""
    vistos, orden = set(), []
    for f in filas:
        if f["doc"] not in vistos:
            vistos.add(f["doc"])
            orden.append(f["doc"])
    return orden


def main(argv: list[str]) -> int:
    kmax = 10
    if "-k" in argv:
        i = argv.index("-k")
        if i + 1 >= len(argv):
            print("-k requiere un número")
            return 2
        kmax = int(argv[i + 1])
    with open(GOLDEN, encoding="utf-8") as fh:
        items = json.load(fh)["items"]

    recall = {k: 0 for k in KS if k <= kmax}
    rr_total = 0.0
    print(f"Golden set: {len(items)} queries · modo={config.MODO_EMBEDDER} · k={kmax}\n")

    for it in items:
        filas = buscar_docs(it["query"], kmax)
        docs = _docs_ordenados(filas)
        esperados = set(it["esperados"])
        rank = next((i + 1 for i, d in enumerate(docs) if d in esperados), None)
        rr_total += (1.0 / rank) if rank else 0.0
        for k in recall:
            if rank and rank <= k:
                recall[k] += 1
        estado = f"#{rank}" if rank else "✗ MISS"
        top = docs[0] if docs else "—"
        print(f"  {estado:>7}  {it['query'][:58]:58}  → {top}")

    n = len(items)
    print("\n── Resultados ──")
    for k in sorted(recall):
        print(f"  recall@{k}: {recall[k]}/{n} = {recall[k]/n:.0%}")
    print(f"  MRR:       {rr_total/n:.3f}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
