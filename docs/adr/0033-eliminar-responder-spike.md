# ADR 0033 — Eliminar `responder.ts` (spike pre-refactor)

**Fecha**: 30-jul-2026  
**Estado**: aceptado  
**Reemplaza**: el código spike `responder.ts` del bot, que este ADR borra

## Contexto

El archivo `responder.ts` del bot —vivía en `server/src/bot/`, y este ADR lo borra, así que hoy
no existe— fue escrito como spike para probar la calidad de respuestas automáticas usando el SDK
nativo de Anthropic Bedrock, antes de que existiera el pipeline completo del bot (agente,
despachador, decision, guardrails, tools).

## Decisión

Se elimina el archivo completo. Toda su funcionalidad fue reemplazada por:
- `agente.ts` — cliente LLM con tool-use loop y seam inyectable
- `despachador.ts` — poll loop con debounce, claim atómico y pipeline completo
- `prompt.ts` — system prompt determinista con cache ephemeral
- `guardrails.ts` — validación de salida (precio, automatismo, humanidad)
- `tools.ts` — 5 tools declarativas
- `decision.ts` — motor de decisión determinista

## Consecuencias

- El archivo `responder.ts` deja de existir. No hay imports rotos:
  `responderConBot()` no era llamada desde ningún lugar fuera del archivo.
- El único punto de entrada al LLM sigue siendo `crearAgente(cliente).responder()`.
- La interfaz `TurnoConversacion` local de `responder.ts` desaparece; la canónica
  es `Turno` en `acciones.ts`.
