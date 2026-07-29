# ADR 0028 — Los mensajes automáticos entran: el bot de primera línea

**Fecha**: 2026-07-29 · **Estado**: aprobado (decisión del dueño, Estephano) · **Issue**: pendiente de abrir

## Contexto

Hermes nació con tres reglas escritas que este ADR revierte en su alcance:

1. **ADR 0015** («Lo que deliberadamente no se hizo»): prohibido generar texto libre hacia un lead
   y prohibido iniciar conversaciones. La única excepción era el acuse nocturno de plantilla.
2. **ADR 0018**: «Hermes no manda solo: siempre hay una persona aprobando». El modo `automatica`
   se retiró de la UI y de la API.
3. **La regla de alcance del 27-jul**: «todo lo estamos haciendo sin IA integrada por ahora, para
   que después, cuando esté listo y estructurado, le metamos como potenciador».

El 29-jul el dueño dio vuelta el marco: **los mensajes automáticos ahora son necesarios**. El
objetivo es que un bot atienda a los leads que escriben —responda, califique, junte interés— para
que las vendedoras se concentren en los leads más interesados. Hermes todavía no está en uso por
las vendedoras: la ventana para construirlo bien es ahora (deadline: lunes 3-ago).

El análisis que precedió a esta decisión fue sobre **Forja** (github.com/santmun/forja, MIT), un
bot de soporte LLM self-hosted. Su corazón (Cloudflare + canales oficiales) no aplica a Hermes
(whatsmeow vive en VPS1), pero sus patrones alrededor del LLM sí, y el código es MIT.

## Decisión

Cuatro decisiones cerradas con el dueño el 29-jul:

1. **Arquitectura**: se porta lo mejor de Forja **adentro** del server de Hermes — módulo nuevo
   `server/src/bot/`, usando `TransporteWhatsapp`, `EnvioControlado`, el catálogo de piezas y el
   kill-switch existentes. No se corre Forja como servicio aparte ni se usa la Cloud API oficial.
2. **Qué manda**: **híbrido**. Texto libre del LLM para conversar, responder dudas y calificar
   (con el catálogo y el contexto del negocio inyectados al prompt — el catálogo es chico, no hace
   falta infra de vectores), y **piezas del catálogo tal cual** (flyer, precios, temario) para lo
   comercial. El LLM **nunca escribe cifras de precio**: el guardrail reusa el detector de
   `senales/cotizacion.ts` como validador de salida.
3. **Rol** (tres): **primera línea 24/7** para leads que escriben · **follow-up a enfriados**
   (patrón Forja: claim una-vez-por-conversación, ventana horaria, caps) · **triage** (calificar y
   ordenar la cola aunque no converse).
4. **Identidad**: **sigue la regla del 27-jul** — el lead no sabe que hay un automatismo. El bot
   no se presenta como bot; si le preguntan directo, **escala a una vendedora humana** sin afirmar
   ser humano ni negar ser bot. (Forja obliga lo contrario; esa parte no se porta.)

## Qué reemplaza y qué queda en pie

**Se revierte:**
- La prohibición de texto libre de ADR 0015 — solo para el bot de `server/src/bot/`, con sus
  guardrails. Ninguna otra superficie gana permiso de generar texto (las sugerencias del panel,
  los hechos y las plantillas siguen siendo catálogo).
- «Hermes no manda solo» de ADR 0018 — el bot tiene modo `automatico`. La auto-respuesta nocturna
  (`autorespuesta/`) queda subsumida por el bot a mediano plazo; hasta entonces no se prenden las
  dos a la vez.
- La regla de alcance del 27-jul (sin IA todavía).

**Queda en pie, sin excepción:**
- `EnvioControlado` es la única puerta hacia `enviarTexto`. El bot pasa por ahí.
- El `temporary_ban` se muestra siempre y frena TODO envío automático.
- Nada de mecanismos cuyo fin sea que el tráfico no se detecte (anti-ban). El ritmo humano del bot
  es honestidad de forma (una persona no responde en 400 ms), no evasión.
- **Nada de envío frío a desconocidos**: el bot solo responde a quien escribió, y el follow-up
  solo retoma conversaciones existentes que se enfriaron, una vez, con caps.
- El lead no sabe que hay automatismo (regla del dueño, reafirmada hoy).
- Todo envío del bot queda marcado (`envios_wa.automatico`, `pieza_via: 'bot'`) y visible en la
  burbuja del hilo: la vendedora siempre ve qué dijo el bot.
- Secretos por nombre; el token de Anthropic vive en `server/.env` como `ANTHROPIC_API_KEY`.

## Consecuencias

- El plan de tres sesiones de `docs/plan-ivi-hermes-cerberus.md` (§4b, PR #228) queda
  **reordenado**: el bot es la prioridad hasta el lunes. El trabajo de corpus/lazo de Ivi sigue
  valiendo — es la comida del catálogo que el bot usa — pero deja de ser la sesión 1.
- La infraestructura del modo supervisado (estados `preparada`, cola de revisión) gana un uso
  nuevo: el **modo sombra** del bot para validar calidad con tráfico real sin tocar leads.
- El detalle de diseño, componentes y cronograma: `docs/plan-bot-primera-linea.md`.
