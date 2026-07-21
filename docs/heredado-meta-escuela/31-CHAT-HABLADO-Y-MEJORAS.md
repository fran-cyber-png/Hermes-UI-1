# 31 — El chat hablado de Ivi + mejoras del RAG (2026-07-18)

> Estado del **chat hablado** (voz) y las mejoras de calidad aplicadas al RAG. Complementa
> [`docs/29`](./29-INTEGRACION-IVI-PLATAFORMA.md) (blueprint) y [`docs/30`](./30-IVI-ESTRUCTURA-CONSOLIDADA.md)
> (estructura). Rama `feat/rag-ivi`.

## 1. El chat hablado — arquitectura final

```
🎙️ mic (Web Speech del navegador)  →  /responder  →  🔊 voz Piper de Ivi (/api/tts de geografo)
                                          │
                    responder() = ask() (números por SQL/SDK) + REDACCIÓN natural
                                          │
   REDACTOR = Bedrock (Claude Haiku 4.5)  ·  geografo = SOLO embeddings (bge-m3) + voz (whisper/Piper)
```

- **Redactor en la NUBE** (decisión de Estephano): Haiku 4.5 por Bedrock redacta la prosa natural.
  qwen3 NO se usa para redactar; queda solo como fallback offline opcional (`RAG_REDACTOR_MODO=local`).
  Fallback automático Haiku→Nova si el use-case de Anthropic no está aprobado.
- **geografo** queda liviano: bge-m3 (embeddings) + whisper (STT) + Piper (TTS). Sin el swap
  qwen3↔bge-m3 que tumbaba Ollama.
- **UI**: `goberna-kos/rag/web.py` sirve `/voz` (chat hablado) y `/` (probador de texto).
  Corré `python3 -m rag.web` → `http://localhost:8091/voz`.

## 2. Mejoras de calidad aplicadas (del diagnóstico, docs: mem 2858)

| Mejora | Qué hace | Estado |
|---|---|---|
| **Grounding numérico** (Ley I) | Post-chequea que cada cifra que Ivi dice esté en los DATOS; devuelve `grounding_ok` + `numeros_no_verificados`. Cazó en vivo un "70 mil anunciantes" inventado. | ✅ default |
| **Curación SOFT del corpus** | Taguea negocio vs dev/meta (80% del corpus era dev: specs/prompts/bitácoras). Penaliza suave (`PENALIZAR_DEV=0.03`) los dev para que no tapen al negocio, sin excluirlos. recall@3 94%→se mantiene, recall@10 →100%. | ✅ default |
| **Memoria conversacional** | Follow-ups multi-turno ("¿y cuál conviene escalar?"): combina con la pregunta previa para el retrieval + pasa la conversación al redactor. | ✅ default |
| **Hybrid search** (vector+texto RRF) | Full-text español + fusión RRF. **Medido: no mejoró y regresó recall@1** (n=18 no puede medirlo). Gated OFF (`RAG_HIBRIDO=1`). | 🔸 opt-in |

## 3. El aprendizaje clave del diagnóstico

**El golden set de 18 queries no puede medir ninguna mejora de retrieval** (94% vs 89% = 1 query,
ruido). Es el **prerequisito (Tier 0)**: subirlo a 50-100 queries reales antes de perseguir
reranker/embedder. bge-m3 es top-tier local para español — **no cambiarlo** (solo Qwen3-Embedding-4B
tiene margen real, y hay que medirlo con el set grande). El único miss ("gasto sin serie temporal")
es ranking léxico, no recall.

## 4. Lo que falta para "producción bien" (necesita geografo / decisiones)

1. **Deploy del chat a geografo always-on** (URL HTTPS) — hoy corre en la Mac. Necesita: el paquete
   `rag/` en geografo + **creds AWS en geografo** (para Bedrock) + `ollama` estable + sudo/TTY.
2. **Converger los dos cerebros** — retirar el motor viejo (`goberna-kos/ivi`, qwen3/ivi-ventas) y
   **portar sus detectores** (hipótesis H1-H5 + impacto económico) al `responder()`. Libera geografo
   del todo (estabilidad).
3. **Reranker** cross-encoder (`bge-reranker-v2-m3`, ~1.2GB en la A4000) — la palanca de precisión;
   ampliar el retrieval a top-20/30 y reordenar. Necesita el modelo en geografo.
4. **Golden set a 50-100 queries** (Tier 0) — habilita medir todo lo anterior.
5. Opcionales: caché de respuestas + warmer (latencia/costo), slot-filling en `consultar_bi`
   (país/rango/fecha), streaming Haiku→TTS (latencia de voz).

## 5. Config (env) nueva

`RAG_REDACTOR_MODO` (nube|hibrido|local), `RAG_REDACTOR_NUBE` (Haiku), `RAG_REDACTOR_NUBE_FB` (Nova),
`RAG_HIBRIDO` (0), `RAG_PENALIZAR_DEV` (0.03), `RAG_INCLUIR_DEV` (1), `RAG_TTS_URL` (geografo).
