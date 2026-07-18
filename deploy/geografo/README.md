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

## Pendiente: reranker
`bge-reranker-v2-m3` en la A4000 necesita torch, que **no instala limpio en el Python 3.14 de
geografo**. Camino: un contenedor Docker (python 3.11 + FlagEmbedding) exponiendo `/rerank`, o
`llama.cpp` con el GGUF del reranker (`--reranking`). Además, el reranker solo se justifica con el
**golden set grande** (hoy n=18 no mide) — hacer ambos juntos.
