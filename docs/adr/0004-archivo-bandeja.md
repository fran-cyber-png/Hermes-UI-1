# ADR 0004 — Se archiva la Bandeja por interacción (la cola es por conversación)

- **Fecha:** 2026-07-21
- **Estado:** aceptado; los tres archivos se borran en este mismo cambio
- **Decide:** rediseño «Cierre de edición» (spec §3.5.14), sobre la decisión ya
  operativa de que la cola sirve conversaciones, no filas

## Contexto

La primera bandeja de Hermes (`Bandeja.tsx` + `FilaInteraccion.tsx` + `useBandeja.ts`)
mostraba **una fila por interacción** contra `/api/interactions`: útil para comentarios,
pero con el stream de WhatsApp un chat de 20 mensajes eran 20 filas, con los salientes
propios mezclados. Por eso nació `ColaUnificada` + `FilaConversacion` contra
`/api/conversaciones` — una fila por conversación — y `App.tsx` monta esa desde entonces.

Los tres archivos viejos quedaron sin un solo import en `src/` (solo menciones en
comentarios). Lo único que la sucesora NO había heredado era el **vacío honesto**: el
chequeo de frescura que impide decir «estás al día» cuando la captura está muerta
(el bug medido el 21-jul: 94.371 interacciones, pantalla felicitando con datos del 11-jul).

## Decisión

1. **Migrar el vacío honesto** a `ColaUnificada` (hecho en este cambio): `useFrescura()`
   + `vacioPorAtraso` renderizan «No hay nada acá, pero no es porque estés al día…»
   ANTES de cualquier vacío de filtro. Con eso la paridad queda completa.
2. **Borrar** los tres componentes de la bandeja vieja —`Bandeja.tsx`, `FilaInteraccion.tsx` y
   `useBandeja.ts`, que vivían en `src/features/canales/`— (regla dura #3: el predecesor se
   archiva al llegar a paridad, con este ADR como acta).
   La historia queda en git; no se mueve a ninguna carpeta `attic/`.

## Qué reemplaza

| Archivado | Sucesor vivo |
|---|---|
| `Bandeja.tsx` (lista por interacción) | `ColaUnificada.tsx` (lista por conversación) |
| `FilaInteraccion.tsx` (fila de 3 columnas) | `FilaConversacion.tsx` (fila de 2 renglones) |
| `useBandeja.ts` (azúcar sobre `useInteracciones`) | `useConversaciones` en `conversaciones.ts` |

`ResponderPanel` (lo usa `ConversacionActiva`), `useInteracciones.ts` y `types.ts` **no** se
archivan: este ADR cubre solo la terna de la bandeja vieja. «La Bandeja» sigue siendo el
nombre de la vista Mensajes en el shell; lo que muere es la implementación por interacción.

## Consecuencias

- `useInteracciones.ts` queda **huérfano** al borrar `useBandeja` (hoy nadie importa ni
  `useInteracciones` ni `useInvalidarBandeja`; solo lo menciona un comentario de
  `conversaciones.ts`). Se deja fuera de este archivo a propósito — su retiro, si
  corresponde, es una decisión aparte con su propio ADR.
- El mismo tratamiento que `PanelWhatsapp` (D13): retirado por decisión documentada,
  recuperable desde git si hiciera falta leerlo.
