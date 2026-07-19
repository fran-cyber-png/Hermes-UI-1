# Prompt para la próxima sesión (copiar y pegar)

> Objetivo de la sesión: que Ivi responda como el analista que la respuesta patrón describe.
> El material está TODO preparado — la sesión arranca leyendo, no explorando.

---

Sos el Principal Software Architect / CTO de Governa (meta-escuela). Leé primero
docs/14-IVI-LA-FORMA-DE-RESPONDER.md — tiene el caso real diseccionado, la respuesta
patrón verificada y el plan P1–P7 — y buscá en memoria "ivi forma de responder golden".
Contexto de estado: docs/13-PENDIENTES-DE-APROBACION.md (nada de eso se toca sin OK).
La Constitución sigue vigente: iteraciones chicas, una por aprobación, reutilizar antes
que crear, nunca inventar datos.

OBJETIVO DE ESTA SESIÓN, en este orden:

1. GOLDEN HARNESS PRIMERO (docs/14 §5, el ancla). En goberna-kos/tests/, asserts sobre
   el ENGINE sin LLM usando fixtures del payload real de /api/overview/comercial:
   - mes parcial ⇒ comparación 1..N vs 1..N (hoy: julio +11% ventas / +33% USD vs junio
     mismos días — Ivi dijo "-54%")
   - p90 < 7 ⇒ NO existe el insight de "Tesorería tarda"
   - r² < 0.3 ⇒ forecast suprimido (se reporta ritmo ± error, no proyección)
   - toda respuesta declara "datos hasta el D"
   Los tests nacen ROJOS. Es lo esperado.

2. P1–P4 de docs/14 §5 hasta ponerlos verdes: scope guard de períodos en kpi_engine/
   analytics_engine (la serie_diaria exacta YA llega — kpi_engine.py:55,140), frescura
   como dato (data_collector → prompt_builder), desintoxicar insight_engine.py:37-45
   (la narrativa del lazo es de antes de docs/10 §2), forecast honesto.

3. Verificación E2E: la MISMA pregunta al chat ("¿cómo vamos en las ventas este mes?",
   sid nuevo) antes y después, comparada contra la respuesta patrón de docs/14 §3.
   El engine se puede correr local contra el backend :4100 sin tocar geógrafo.

4. Recién después, si hay tiempo y apruebo: P5 (exponer el valor real del backlog,
   $32.926, vía SDK y que impact_engine lo use como HECHO) y P7 (retoques al
   Modelfile.ventas — solo REDACTAR el cambio; el deploy a geógrafo lo hace el operador).

NO TOQUES SIN PEDIRME: los .env · LAZO_RELOJ (apagado a propósito) · deploy a geógrafo
(operador) · nada de docs/13 sin aprobación explícita · P6 (migrar collect() al SDK) es
otra iteración, no la cueles en esta.

MÉTODO: preguntale a la base, no al código ni a los docs. Cada número que Ivi vaya a
decir tiene que poder rastrearse a un endpoint o una tabla. Un 0 nunca es una respuesta.
Decime cuando me equivoque.

---

## Estado del mundo al 2026-07-16 (para no re-descubrirlo)

- Chat de Ivi VIVO y probado E2E: http://100.117.204.80:8080 (geógrafo) → backend
  laptop :4100 vía Tailscale. Modelo ivi-ventas (qwen3:8b); hay qwen3:14b bajado.
- Datos: Cerberus al 13/07 · serie diaria al 11/07 · interacciones PARADAS desde 11/07 ·
  pauta con snapshot limpio del 15/07 (fix 9b0bedf: solo se sirven recolectas limpias).
- Token de Meta: expuesto el 16/07, **ROTADO el 2026-07-19 (RESUELTO)** — ya no es un riesgo abierto.
  El reloj de pauta llama solo cada 6 h con lo que haya en server/.env.
- Commits del 16/07: 9b0bedf (fix snapshots) · 9cac870 (docs §6 + corrección $16.587) ·
  85773e7 (docs/12 auditoría: 4 vivos, 8 cargados, 5 desmentidos) · 44aa6bf (docs/13
  pendientes) · (docs/14 y 15, este material).
- El hallazgo más caro de la auditoría sigue SIN arreglar a propósito (espera OK):
  webhook/ruta.ts:143 dispara CAPI real sin compuerta ni yaEnMeta() — hoy inalcanzable
  (0 webhooks en la historia), 126 ventas en cuotas adelante. Lote A de docs/13.
