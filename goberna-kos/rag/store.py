"""Capa de datos sobre rag.documentos (pgvector). psycopg2 directo — es un tool aparte del
engine stdlib-only de Ivi, así que puede tener deps (psycopg2 ya está instalado)."""

import json

import psycopg2

from . import config
from .embedder import a_literal


def conectar():
    return psycopg2.connect(config.DATABASE_URL)


def upsert_doc(cur, *, doc: str, fuente: str, sensible: bool, chunks: list[dict],
               vectores: list[list[float]], embedder: str) -> int:
    """Reemplaza TODOS los chunks de `doc` (bajo CUALQUIER embedder) y re-inserta bajo `embedder`.
    Idempotente por documento; garantiza que un doc vive bajo un solo embedder (el que le toca por
    su sensibilidad + modo), sin dejar chunks huérfanos de una corrida anterior. Devuelve cuántos
    chunks quedaron."""
    cur.execute("DELETE FROM rag.documentos WHERE doc = %s", (doc,))
    filas = []
    for ch, vec in zip(chunks, vectores):
        meta = {
            "fuente": fuente,
            "doc": doc,
            "headings": ch.get("headings", []),
            "chars": len(ch["texto"]),
        }
        if ch.get("meta"):
            meta.update(ch["meta"])
        filas.append((fuente, doc, ch["posicion"], ch["texto"], a_literal(vec), embedder,
                      sensible, json.dumps(meta)))
    cur.executemany(
        """INSERT INTO rag.documentos
             (fuente, doc, posicion, chunk, embedding, embedder, sensible, metadata)
           VALUES (%s, %s, %s, %s, %s::vector, %s, %s, %s::jsonb)""",
        filas,
    )
    return len(filas)


RRF_K = 60  # constante estándar de Reciprocal Rank Fusion
# El vector (denso) ya es fuerte en nuestro corpus (recall@3 94%); el texto entra como RESCATE de
# términos exactos, no como voto igual. Peso <1 para no degradar las queries semánticas.
import os as _os
RRF_W_TEXTO = float(_os.environ.get("RAG_RRF_W_TEXTO", "0.4"))


def _cond(embedder: str, incluir_sensibles: bool, fuentes):
    cond = ["embedder = %s"]
    params: list = [embedder]
    if not incluir_sensibles:
        cond.append("sensible = false")
    if fuentes is not None:  # [] = ninguna fuente (match vacío), no "todas"
        cond.append("fuente = ANY(%s)")
        params.append(fuentes)
    return " AND ".join(cond), params


def _filas(cur):
    cols = [c[0] for c in cur.description]
    return [dict(zip(cols, r)) for r in cur.fetchall()]


def _knn(cur, vector, n, embedder, incluir_sensibles, fuentes):
    where, params = _cond(embedder, incluir_sensibles, fuentes)
    qv = a_literal(vector)
    cur.execute(f"""
        SELECT id, doc, fuente, posicion, chunk, metadata, sensible,
               1 - (embedding <=> %s::vector) AS similitud
          FROM rag.documentos WHERE {where}
      ORDER BY embedding <=> %s::vector LIMIT %s
    """, [qv, *params, qv, n])
    return _filas(cur)


def _fts(cur, query, n, embedder, incluir_sensibles, fuentes):
    """Full-text en español (tsvector + índice GIN). Complementa al vector con términos exactos."""
    where, params = _cond(embedder, incluir_sensibles, fuentes)
    cur.execute(f"""
        SELECT id, doc, fuente, posicion, chunk, metadata, sensible,
               ts_rank_cd(to_tsvector('spanish', chunk), websearch_to_tsquery('spanish', %s)) AS ts_rank
          FROM rag.documentos
         WHERE {where} AND to_tsvector('spanish', chunk) @@ websearch_to_tsquery('spanish', %s)
      ORDER BY ts_rank DESC LIMIT %s
    """, [query, *params, query, n])
    return _filas(cur)


def buscar(cur, *, vector, k: int, embedder: str, query: str | None = None,
           incluir_sensibles: bool = True, fuentes=None, hibrido: bool = True) -> list[dict]:
    """HYBRID SEARCH: fusiona la lista del VECTOR (coseno/HNSW, denso) con la de FULL-TEXT
    (tsvector español, léxico) por Reciprocal Rank Fusion. El vector capta el sentido; el texto
    capta términos exactos/raros que el denso subvalora (el caso 'gasto sin serie temporal').
    Sin query o hibrido=False → solo vector (comportamiento anterior)."""
    n = max(k * 6, 30) if (hibrido and query) else k
    vec = _knn(cur, vector, n, embedder, incluir_sensibles, fuentes)
    if not (hibrido and query):
        return vec[:k]
    txt = _fts(cur, query, n, embedder, incluir_sensibles, fuentes)

    score: dict = {}
    reg: dict = {}
    for lista, peso in ((vec, 1.0), (txt, RRF_W_TEXTO)):  # vec primero + con más peso
        for rank, f in enumerate(lista, start=1):
            i = f["id"]
            score[i] = score.get(i, 0.0) + peso / (RRF_K + rank)
            if i in reg:
                reg[i].update({key: v for key, v in f.items() if key not in reg[i]})
            else:
                reg[i] = f
    orden = sorted(score, key=lambda i: score[i], reverse=True)[:k]
    return [{**reg[i], "rrf": round(score[i], 5)} for i in orden]


def stats(cur, embedder: str | None = None) -> dict:
    if embedder:
        cur.execute(
            "SELECT count(*), count(distinct doc) FROM rag.documentos WHERE embedder = %s",
            (embedder,),
        )
    else:
        cur.execute("SELECT count(*), count(distinct doc) FROM rag.documentos")
    chunks, docs = cur.fetchone()
    return {"chunks": chunks, "docs": docs}


def stats_por_embedder(cur) -> list[dict]:
    cur.execute(
        "SELECT embedder, count(*), count(distinct doc), sum((sensible)::int) "
        "FROM rag.documentos GROUP BY embedder ORDER BY embedder"
    )
    return [{"embedder": e, "chunks": c, "docs": d, "sensibles": s}
            for e, c, d, s in cur.fetchall()]
