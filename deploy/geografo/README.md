# Deploy del chat hablado de Ivi en geografo (always-on)

El chat vive en **geografo** (A4000): embeddings (bge-m3) + voz (Piper) locales, redactor por Bedrock
(Haiku), números del SDK de VPS1. URL: **https://geografo.tailf59792.ts.net/voz** (tailnet only).

## Piezas en geografo
- **pgvector**: contenedor Docker `ivi_rag_pg` (pgvector/pgvector:pg17) en `127.0.0.1:5439`, tabla
  `rag.documentos` (creada con `rag/setup.sql`, no drizzle).
- **Código**: `~/meta-escuela/goberna-kos/{rag,ivi,cqs}` + `~/meta-escuela/docs` (rsync desde la Mac).
- **Env**: `~/ia-local/rag.env` (chmod 600) — `RAG_DATABASE_URL`, `RAG_OLLAMA_URL=localhost:11434`,
  `RAG_BACKEND=http://100.85.119.49:4100` (VPS1), `IVI_PIPER_BIN/VOICE`.
- **AWS**: `~/.aws` copiado de la Mac (Bedrock/Haiku funciona). *(Nota: el token `login` puede
  expirar; para durabilidad conviene un Bedrock API key.)*
- **Servicio**: `ivi-chat.service` (systemd, `python3 -m rag.web`, `Restart=always`, puerto 8095).
- **HTTPS**: `tailscale serve --bg 8095` → `https://geografo.tailf59792.ts.net/`.
- **Motor viejo**: `ivi.service` (qwen3/ivi-ventas) **retirado** (stop + disable). El chat nuevo sirve
  su propia voz (Piper vía `ivi.voz`), así que no se pierde nada. *(Ojo: el drawer de goberna-studio
  que pegaba a `:8080/api/chat` queda sin backend — repuntar al chat nuevo si se usa.)*

## Puesta en marcha (resumen, corrido 2026-07-18)
```bash
# 1. pgvector
sudo docker run -d --name ivi_rag_pg --restart unless-stopped \
  -e POSTGRES_USER=ivi -e POSTGRES_PASSWORD=<pw> -e POSTGRES_DB=ivi_rag \
  -p 127.0.0.1:5439:5432 -v ivi_rag_pgdata:/var/lib/postgresql/data pgvector/pgvector:pg17
sudo docker exec -i ivi_rag_pg psql -U ivi -d ivi_rag < ~/meta-escuela/goberna-kos/rag/setup.sql
# 2. AWS CLI + creds (para Bedrock)  → rsync ~/.aws de la Mac; installer oficial de aws-cli
# 3. ingesta   (desde ~/meta-escuela/goberna-kos, con el env)
python3 -m rag.ingest --reset
# 4. servicio + https
sudo systemctl enable --now ivi-chat.service
sudo tailscale serve --bg 8095
```

## Operación
- Logs: `journalctl -u ivi-chat.service -f`
- Re-ingestar tras cambiar docs: rsync `docs/` + `goberna-kos/rag/`, luego `python3 -m rag.ingest --reset`.
- Reiniciar: `sudo systemctl restart ivi-chat.service`.

## Reranker (bge-reranker-v2-m3 en la A4000) — HECHO
Como torch no instala en el Python 3.14 de geografo, corre en un **venv Python 3.11 aparte** (`uv`,
`~/reranker/.venv`) con torch CUDA + sentence-transformers, usando la GPU directo (sin docker-toolkit).

- Servicio: `ivi-reranker.service` (systemd) → `~/reranker/.venv/bin/python -m rag.reranker_service`
  en `127.0.0.1:8098`. `GET /health`, `POST /rerank {query, documents}` → `{scores}` (sigmoid 0-1).
- Wiring: `RAG_RERANKER_URL=http://localhost:8098` en `rag.env`. `buscar_docs` recupera top-25 con
  bge-m3 y reordena a k con el cross-encoder (degrada limpio si el servicio cae).
- Medido: **recall@3 94% → 100%** (el miss "gasto sin serie temporal" quedó fixeado y verificado en
  el chat). recall@1 baja un poco (dentro del ruido de n=18; el LLM ve el top-k, no solo el #1).
- Setup: `uv venv --python 3.11 ~/reranker/.venv`; `uv pip install torch --index-url .../cu124`;
  `uv pip install sentence-transformers`. Modelo (~2.3GB) se baja solo al arrancar.

> Siguiente para afinar de verdad: **golden set a 50-100 queries** (con n=18 no se distingue).
