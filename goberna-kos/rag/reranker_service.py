"""Servicio de RERANKING (cross-encoder) para el RAG de Ivi.

Corre en un venv Python 3.11 con FlagEmbedding + torch CUDA (usa la A4000), AISLADO del Python 3.14
de geografo. El RAG (buscar.py, stdlib) lo llama por HTTP: recupera top-N con bge-m3 (bi-encoder) y
reordena a top-k con bge-reranker-v2-m3 (cross-encoder) — la mejora de precisión más citada.

  POST /rerank  {query, documents:[str]}  ->  {scores:[float]}   (sigmoid 0-1; mayor = más relevante)
  GET  /health                             ->  {ok, device, model}

Uso:  .venv/bin/python -m rag.reranker_service   (o el path directo al archivo)
"""

import json
import math
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import torch
from sentence_transformers import CrossEncoder

MODEL = os.environ.get("RERANKER_MODEL", "BAAI/bge-reranker-v2-m3")
PORT = int(os.environ.get("RERANKER_PORT", "8098"))
_DEVICE = "cuda" if torch.cuda.is_available() else "cpu"

_reranker = CrossEncoder(MODEL, max_length=512, device=_DEVICE)


def _score(query: str, docs: list[str]) -> list[float]:
    if not docs:
        return []
    logits = _reranker.predict([[query, d] for d in docs], convert_to_numpy=True, show_progress_bar=False)
    return [1.0 / (1.0 + math.exp(-float(x))) for x in logits]  # sigmoid → 0..1


class Handler(BaseHTTPRequestHandler):
    def _send(self, code: int, obj: dict):
        b = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def do_GET(self):
        if self.path == "/health":
            import torch
            self._send(200, {"ok": True, "model": MODEL,
                             "device": "cuda" if torch.cuda.is_available() else "cpu"})
        else:
            self._send(404, {"error": "no encontrado"})

    def do_POST(self):
        if self.path != "/rerank":
            return self._send(404, {"error": "no encontrado"})
        try:
            n = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(n).decode()) if n else {}
            self._send(200, {"scores": _score(body.get("query", ""), body.get("documents") or [])})
        except Exception as e:  # noqa: BLE001
            self._send(500, {"error": str(e)})

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    print(f"reranker {MODEL} en 127.0.0.1:{PORT}", flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
