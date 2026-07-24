# ADR 0009 — Las notas son una tabla EDITABLE aparte, no un campo dentro de `gestiones`

- **Fecha:** 2026-07-23
- **Estado:** aceptado
- **Decide:** issue #47 (milestone «WhatsApp Business potenciado»)

## Contexto

La única forma de dejar una nota en Hermes era el textarea «Notas de acuerdos» de
`RegistrarGestion.tsx`, dentro del formulario de gestión. Dos problemas, los dos por la MISMA
razón — `gestiones` es **append-only** a propósito (ADR implícito de origen: la etapa actual de
una conversación es la de su última fila, así que el historial completo queda como auditoría de
cómo se trabajó el lead):

1. **Para dejar una nota había que mover el embudo.** `guardar()` mandaba
   `etapa: etapaActual ?? 'interesado'` (`RegistrarGestion.tsx:105`, antes de este cambio) solo
   para poder persistir el texto — el server no acepta una gestión sin etapa. Una vendedora que
   solo quería anotar «paga el viernes» terminaba insertando una fila de gestión completa.
2. **Una nota nunca se podía corregir.** Append-only significa que un typo, o una nota apócrifa
   («dijo que sí» cuando dijo que no), queda grabado para siempre — la única forma de «arreglarlo»
   era escribir OTRA gestión encima, ensuciando más el historial que se supone que es la fuente de
   verdad de la etapa.

## Decisión

**`notas` es una tabla propia, editable, con soft-delete — y NO deriva nada.**

- **Editable de verdad** (`PATCH /api/notas/:id`, solo la autora): corregir un typo no dispara una
  gestión nueva ni toca la etapa. `editado_at` queda `null` hasta la primera edición y se setea en
  cada PATCH — visible en la UI («editada»), sin edición optimista que lo oculte.
- **Se archiva, no se borra** (`PATCH /api/notas/:id/archivar` → `archivado_at`): no hay DELETE
  físico, pero tampoco hay obligación de mantener cada nota viva para siempre — «se guardó por
  error» es un caso real que append-only no resuelve (solo permite taparlo con más filas).
- **No deriva NADA**: de una nota no sale la etapa, ni un recordatorio, ni un envío. Es memoria,
  no un evento de negocio. Esto es lo que la distingue de `gestiones` (si `gestiones` fuera
  editable, la auditoría de «cómo se trabajó el lead» dejaría de ser confiable — por eso esa tabla
  SIGUE append-only, y las notas se sacan afuera en vez de intentar que las dos cosas convivan en
  la misma fila).
- **Por autora, no por equipo** (a diferencia de `etiquetas`, que sí son compartidas): v1 no
  resuelve «notas del equipo» — es la libreta de cada vendedora, y las notas ancladas a una
  conversación tampoco se ven entre vendedoras. Promoverlo a compartido es otro frente.

### Qué reemplaza, concretamente

`RegistrarGestion.tsx` pierde el textarea de notas, el estado `notas`, y el campo `notas` del
body del POST — queda con una sola responsabilidad: la PRÓXIMA ACCIÓN (que si tiene fecha, cae
sola en la Agenda). El preview de «última nota» del cintillo colapsado ya no lee
`gestiones.notas` (la última fila del historial): lee la nota más reciente de `notas` para esa
conversación.

La columna `gestiones.notas` **no se borra** del schema: las filas viejas la siguen teniendo (es
historia real, de antes de este cambio) y no vale la pena una migración de datos para un campo de
texto libre que ya no se escribe. Simplemente deja de alimentarse.

## Alternativas consideradas

- **Agregar `editado_at` a `gestiones` y permitir PATCH ahí.** Se descartó: rompería la garantía
  que hace útil a `gestiones` como auditoría — "la etapa actual es la última fila" deja de ser
  cierto si las filas se pueden reescribir después.
- **Notas del equipo (compartidas) desde el día uno**, como `etiquetas`. Se descartó para v1: el
  issue lo deja explícitamente fuera de alcance — es una decisión de producto aparte (¿se
  necesitan permisos, quién edita la nota de otra persona?) que no bloquea el valor de tener
  notas editables por autora.

## Consecuencias

- Un típo se corrige en el momento, sin ensuciar el historial comercial.
- `gestiones` sigue siendo confiablemente append-only — nada de este cambio lo toca.
- La libreta personal (`clave='general'`, tecla «n») sale gratis del mismo modelo: es solo otro
  valor de `clave`, no un tipo de dato aparte.
