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


def buscar(cur, *, vector: list[float], k: int, embedder: str,
           incluir_sensibles: bool = True, fuentes: list[str] | None = None) -> list[dict]:
    """KNN por coseno (operador <=>) filtrando SIEMPRE por un único embedder (mismo espacio
    vectorial). Devuelve chunks con su similitud (1 - distancia_coseno)."""
    cond = ["embedder = %s"]
    params: list = [embedder]
    if not incluir_sensibles:
        cond.append("sensible = false")
    if fuentes is not None:  # [] = ninguna fuente (match vacío), no "todas"
        cond.append("fuente = ANY(%s)")
        params.append(fuentes)
    where = " AND ".join(cond)
    qvec = a_literal(vector)
    # El ORDER BY usa el índice HNSW; el vector va primero en params para el <=>.
    sql = f"""
        SELECT doc, fuente, posicion, chunk, metadata, sensible,
               1 - (embedding <=> %s::vector) AS similitud
          FROM rag.documentos
         WHERE {where}
      ORDER BY embedding <=> %s::vector
         LIMIT %s
    """
    cur.execute(sql, [qvec, *params, qvec, k])
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, row)) for row in cur.fetchall()]


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
