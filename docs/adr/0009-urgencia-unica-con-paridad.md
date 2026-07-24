# ADR 0009 — La urgencia se define una sola vez: función pura + proyección SQL con test de paridad

- **Fecha:** 2026-07-23
- **Estado:** aceptado
- **Decide:** issue #37 (milestone «WhatsApp Business potenciado»)

## Contexto

La urgencia —el criterio que decide a quién atiende primero la vendedora— estaba implementada
**dos veces**: 6 niveles en `cola/urgencia.ts` (TypeScript puro, testeado; alimenta el radar del
Dashboard vía `ordenarRadar`) y 4 niveles en el SQL de la cola de Mensajes. La duplicación era
conocida y estaba documentada como «espejo a mantener a mano» — y el espejo divergió sin que CI
dijera nada: cuando la urgencia pasó de 4 a 6 niveles (#17), el SQL se quedó en 4, sin `VENCIDO`
ni `SILENCIO` y con los niveles renumerados. La misma conversación salía con prioridad distinta
en dos pantallas.

El issue #37 planteó dos caminos:

- **A — una sola implementación en TypeScript**: la cola traería filas sin ordenar y `ordenarRadar`
  decidiría. Elimina el espejo, pero la cola **pagina en la base** (`LIMIT/OFFSET`), así que habría
  que traer más filas de las que se muestran o repaginar — y el endpoint acababa de optimizarse
  (#30: 482 ms → 3,4 ms con la ventana de 30 días). No se puede pagar ese costo sin medirlo.
- **B — conservar el espejo, pero hacerlo verificable**: un test que corra los mismos casos contra
  las dos implementaciones y falle si difieren.

## Decisión

**B, con el espejo movido a la casa de la urgencia.** Tres piezas:

1. **`cola/urgenciaSql.ts`** — la proyección SQL de los seis niveles vive AL LADO de la función
   pura, en el mismo módulo `cola/`, compartiendo constantes (`ACTIVO_MS`) y con las seis
   condiciones en el mismo orden de precedencia. Reemplaza al CASE de 4 niveles que vivía suelto
   dentro de la consulta de la cola. Exporta `nivelUrgenciaSql`, `ordenUrgenciaSql` y
   `seguimientosPendientesSql` (de dónde sale `seguimiento_en`: el pendiente más viejo de
   `recordatorios` por clave).
2. **`consultarCola` ordena con esos fragmentos** — `ORDER BY nivel, orden` — y no define ningún
   criterio propio. Devuelve `nivel` (0–5, la escala canónica) y `orden` en las mismas unidades
   que `Date.getTime()`, así el contrato es el mismo que el del radar.
3. **El test de paridad (`cola/urgencia.paridad.test.db.ts`)** — siembra conversaciones que cubren
   los seis niveles en una Postgres efímera (harness de ADR 0008), pide la cola por el camino SQL
   y verifica fila por fila y el orden completo contra `claveUrgencia`/`ordenarPorUrgencia`. Es el
   candado que faltó cuando el espejo divergió: si alguien toca un nivel en un solo lado, CI falla.

El camino A queda para cuando se toque la paginación de la cola: si algún día el orden se calcula
en TypeScript, `urgenciaSql.ts` se borra y el test de paridad se convierte en el test del nuevo
camino.

## Qué reemplaza

- El CASE de 4 niveles (vivo · expira · espera · resto, renumerados) embebido en
  `cola/consultarCola.ts`, y su `ORDER BY` artesanal.
- La advertencia «si tocás los niveles de `urgencia.ts`, el espejo hay que tocarlo a mano» de
  `cola/radar.ts` — ya no es a mano: es un test.

## Consecuencias

- La cola de Mensajes y el radar del Dashboard ordenan igual, por construcción verificada.
- La cola ahora conoce `seguimiento_en` (JOIN a `recordatorios` pendientes por clave), así que
  `VENCIDO` existe también en Mensajes — la mitad de #38 que le tocaba a la cola. La otra mitad
  (que el radar del Dashboard lo conozca) es de #38.
- El `nivel` que viaja al front cambió de escala: era 0–3 (y el tipo del front decía 0–2), ahora
  es 0–5. Ningún componente decidía nada con la escala vieja; los tipos quedaron en la nueva.
- Quien agregue un nivel tiene que tocar dos archivos en vez de uno — pero si toca uno solo, CI
  lo dice en vez de callárselo.
