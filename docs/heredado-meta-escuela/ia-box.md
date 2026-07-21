# goberna-ia-box — la infra de IA de geógrafo

**Qué es:** la infraestructura del box de IA en **geógrafo** (RTX A4000, 16 GB). Un solo
trabajo: que la GPU hospede varios modelos sin pelear por la VRAM, con arranque/parada
automáticos vía **llama-swap**. Repo `Goberna-Lab/goberna-ia-box`. 🚧 fase de spec
(`docs/specs/2026-07-17-llama-swap-box-design.md`). Es el **Track 0**, prerrequisito de
`goberna-studio`.

## Arquitectura
```
        llama-swap :8080  (lee "model" → sube/baja el upstream)
         ├─ qwen3 (llama-server + GGUF)      ← el LLM (BI de Ivi)
         ├─ flux-schnell (FastAPI)           ← generación de imagen
         └─ qwen-image-edit (FASE 2)         ← edición de imagen
        RTX A4000 · 16 GB · UNO residente a la vez (exclusión mutua)
```
- **Exclusión mutua = default** de llama-swap (sin `groups:`): pedir un modelo desaloja al otro.
- El LLM migra de **Ollama → llama-server + GGUF** (alias `qwen3:8b` para no romper nombres).
- **Ivi migra su cliente a `/v1/chat/completions`** (OpenAI-compatible) — el cambio de gateway
  que docs/26 §3.2 anticipa.
- Rollback a Ollama a un comando durante la transición.

## Relación con el plan de Ivi
- Confirma que **el rol BI de Ivi se queda local** en geógrafo (Ley I) sobre llama-swap.
- Reemplaza el hack `sudo systemctl stop ollama` que hoy usa FLUX para no chocar.
- **La voz** de Ivi (Piper CPU + whisper) NO compite por VRAM → convive sin problema.
- El rol **creativo** de Ivi va por **API (Bedrock)**, no acá (docs/28) → la A4000 no
  malabarea un LLM creativo; solo qwen3-BI + FLUX + edición, time-shared.

## Estado
Spec. Cuando se deploye, Ivi cambia `call_ollama()` → cliente OpenAI apuntando a llama-swap.
Hoy Ivi corre contra Ollama directo (`ivi.service`).
