# ADR 0001 — Hermes se extrae de meta-escuela

- **Fecha:** 2026-07-21
- **Estado:** aceptado
- **Decide:** Estephano

## Contexto

`meta-escuela` (Goberna-Lab/meta-escuela) nació como dashboard de pauta Meta Ads: ROAS, embudo,
creativos, y el lazo CAPI con Cerberus. En el camino le creció adentro algo que no era un dashboard:
una **capa de canales conversacionales** — ingesta de comentarios de Facebook e Instagram, DMs de
Messenger, un event store append-only, y la capacidad de responder un comentario en público y por
privado.

Esa capa resultó ser un producto distinto, con otro usuario. El dashboard lo mira un media buyer que
explora números. La capa de canales la usa un **vendedor que atiende una cola**.

Al 21-jul-2026 la base tenía **94.371 interacciones** capturadas (76.869 DMs de Messenger, 14.736
comentarios de Facebook, 2.766 de Instagram), **~17.000 de ellas pidiendo información explícitamente**,
y **ninguna marcada como atendida**. El valor estaba construido y sin usar, porque vivía adentro de una
pantalla de análisis en vez de una herramienta de trabajo.

## Decisión

**Hermes** es un repo nuevo, extraído de meta-escuela **con su historia git completa** (129 commits,
11–20 jul 2026). No es un fork ni un copy-paste: `git clone` de la historia entera y después una poda
documentada.

Qué se llevó y qué se dejó:

| | |
|---|---|
| **Se llevó** | `server/` completo (event store, ingesta Meta, webhooks, `responder`), y del front la feature `canales/` — la bandeja, la fila, el panel de respuesta |
| **Se podó** | `goberna-kos/` (es Ivi, otro producto), el front de pauta (`campaigns`, `pautaMaestro`, `home`, `decisions`, `tesoreria`), y `routes/pautaMaestro.ts` |
| **Se archivó** | los 47 docs heredados, en `docs/heredado-meta-escuela/` |

**meta-escuela sigue vivo** como lo que siempre fue: el dashboard de pauta. No se archiva.

## Por qué extraer y no reescribir

El código de canales no era un borrador. Tenía decisiones caras ya peleadas, y volver a tomarlas
habría costado semanas y algunas se habrían tomado mal:

- **El orden de la cola es por urgencia, no por fecha.** Primero los que tienen la ventana de 7 días
  abierta, y dentro de esa, **el más viejo arriba** — es al que le quedan menos horas. Ordenar por
  fecha descendente, el reflejo de cualquier feed, pone abajo del todo justo a quien estás por perder.
- **El privado se manda antes que el público.** Se aprendió rompiéndolo: se publicó "te enviamos la
  info por privado", el privado falló, y quedó una mentira pública bajo la marca de un cliente.
- **`respondida` no es estado del cliente, se deriva de `status`.** Había tres `useState` sueltos que
  se vaciaban en cada F5 y hacían invisible el trabajo ya hecho.
- **La paginación anidada de comentarios.** 112 de 1.873 posts tocaban el tope de 50 y se truncaban
  en silencio.

Reescribir habría tirado eso. La regla dura #4 pide extraer preservando historia justamente para que
el próximo que lea `git log` encuentre el porqué.

## Consecuencias

- Hermes hereda la deuda de meta-escuela: `drizzle-kit push` sin migraciones versionadas, doble
  lockfile, y **sin CI/CD**. Hay que resolverlo antes de que esto lo use un vendedor real.
- Por ahora **las dos apps leen la misma base** (`meta_escuela`, Postgres 5434). Es deliberado: el
  event store es uno solo. Cuando Hermes se despliegue habrá que decidir si se separan.
- Los módulos `curso.ts`, `snapshot.ts` y `ventanas.ts` de `pauta` **nunca se commitearon** en
  meta-escuela. El clon trajo solo lo versionado, y por eso `routes/pautaMaestro.ts` no compilaba. Se
  podó. Si meta-escuela los necesita, siguen en su working tree local — **conviene commitearlos
  allá**. (Al 16-ago-2026, `snapshot.ts` y `ventanas.ts` se volvieron a escribir en Hermes y viven en
  `server/src/pauta/`; el `curso.ts` de `pauta` sigue sin existir acá, y `routes/pautaMaestro.ts`
  tampoco volvió.)
- El front quedó sin router: Hermes tiene una sola pantalla.
