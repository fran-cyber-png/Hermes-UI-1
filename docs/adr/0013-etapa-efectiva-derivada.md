# ADR 0013 — La etapa del embudo es EFECTIVA: derivada de lo que ya pasó, dicha una sola vez

- **Fecha:** 2026-07-24
- **Estado:** aceptado
- **Decide:** épica #87, ticket #88 (milestone «WhatsApp Business potenciado»)

## Contexto

La etapa de una conversación en el Pipeline se decidía en **tres lugares con tres criterios**:

1. El front (`VistaEmbudo.tsx`) agrupaba las ~30 conversaciones cargadas del feed global y, para
   toda conversación **sin gestión asentada**, caía al fallback `'interesado'`.
2. El Dashboard (`routes/dashboard.ts`) contaba el `embudo` sobre **toda la historia de
   `gestiones` sin ventana** — un universo incomparable con la cola (30 días).
3. La señal `respondida` — que la cola YA calcula y viaja en cada fila desde #30 — no influía en
   ninguna etapa.

Con datos reales el resultado era un tablero inservible: **1129 de 1336 conversaciones ya
respondidas** (84 %) apiladas en «Interesados» como si nadie las hubiera trabajado, columnas de
trabajo vacías, y un «N de M» que mezclaba universos. Las gestiones manuales asentadas eran 7
sobre 1336: sin derivación, el embudo arranca vacío para siempre.

El dueño cerró la política (2026-07-24, épica #87): **«Contacto significa que respondimos su
mensaje»** — y «perdido» manual es **terminal** (la clasificación humana gana siempre; para
revivir, la vendedora lo mueve a mano).

## Decisión

**La etapa efectiva se calcula al LEER, en un solo seam, con esta precedencia:**

- **derivada** = `respondida ? 'contactado' : 'interesado'` — un **piso que solo sube**;
- **manual** = etapa de la última gestión asentada por clave (`gestiones` es append-only;
  normalizada `nuevo→interesado`, `venta→cierre`), o ninguna;
- **efectiva** = sin manual → derivada · manual `perdido` → **perdido** (terminal) · si no →
  **`max(manual, derivada)`** en la escala `interesado < contactado < cotizado < cierre`.

Nada retrocede solo; el cierre se sigue ganando **solo** registrando la venta (la compuerta de
`gestiones/registrarGestion.ts` no se toca). Cero migración de datos: las 1129 respondidas
aparecen en Contactados el día 1 porque la derivación es de lectura, no un backfill.

La forma es la de **ADR 0009** (una definición, jamás espejos): `cola/etapaEfectivaSql.ts` exporta
la **función pura** (`etapaEfectiva`) y su **proyección SQL** (`etapaEfectivaSql` +
`ultimasGestionesSql`), lado a lado, compartiendo la escala con `ETAPAS` (la lista canónica de
`gestiones/registrarGestion.ts`). `consultarCola` la sirve como columnas `etapa_efectiva` y
`etapa_manual` sobre la **misma ventana de 30 días** de la cola. El test de paridad
(`etapaEfectiva.paridad.test.db.ts`) corre SQL y función pura contra los mismos datos sembrados y
falla en CI si divergen.

## Qué reemplaza

Esta política deja obsoletas tres piezas, que mueren en los tickets que siguen (#89, #90):

- el fallback client-side `'interesado'` de `VistaEmbudo.tsx` (la etapa la manda el server);
- el conteo del `embudo` de `routes/dashboard.ts` sobre la historia entera de `gestiones` sin
  ventana (pasa a contar por etapa efectiva sobre los 30 días de la cola);
- la idea de que «sin gestión = interesado»: la gestión manual sigue siendo la palabra de la
  vendedora, pero ya no es la única fuente — lo que ya pasó (respondimos) también cuenta.

## Consecuencias

- Mensajes, Pipeline y Dashboard comparten **un universo** (ventana de 30 días) y **una
  definición** de etapa, por construcción verificada.
- `respondida` asciende de señal informativa a **hecho que mueve el embudo**. Responder desde
  cualquier lado (Hermes o el teléfono) contacta a la persona sin que nadie arrastre tarjetas.
- Una vendedora ya no puede «bajar» una conversación a interesado si ya fue respondida: el piso
  derivado la devuelve a contactado. Es deliberado (nada retrocede solo); la salida real de una
  conversación muerta es `perdido`, que sí es sticky.
- Quien toque la regla tiene que tocar la función pura y el fragmento SQL en el mismo commit — si
  toca uno solo, CI lo dice en vez de callárselo.
