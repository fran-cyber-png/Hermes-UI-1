# ADR 0005 — Se archiva el Tablero (el Dashboard heredó los números honestos)

- **Fecha:** 2026-07-22
- **Estado:** aceptado; el archivo se borra en este mismo cambio
- **Decide:** revisión del PR #2 (eje Spec), sobre el rediseño «Cierre de edición»

## Contexto

El `VistaTablero.tsx` que vivía en `src/features/vistas/` fue **EL TABLERO** — «los números honestos de la
operación, en lenguaje humano»: la cifra de gente esperando, el estado de captura por
canal (WhatsApp / Meta) contra `useFrescura()` y `useSesionWa()`, la tabla por canal
(interacciones · piden info · ventana abierta) y la declaración explícita de los huecos
que todavía no se miden.

Cuando el rediseño de las 4 vistas montó el **Dashboard** como página principal
(`1f4cdee`), el shell dejó de montar el Tablero — pero el archivo se quedó. Desde
entonces es **código muerto: cero imports en `src/`** (verificado con grep en toda la
carpeta, no solo por nombre de símbolo).

Estar muerto no lo dejó inofensivo. Al no recibir la pasada del rediseño, siguió
contando en las mediciones de la propia dirección y las ensuciaba:

- aporta **4 de los 5 `uppercase tracking-` literales de toda la app**, así que la ración
  de kickers («uno por página, ganado») medía peor de lo que realmente estaba;
- viola «sombra O borde, nunca ambos» en 3 lugares (`:50`, `:73`, `:104`);
- usa `text-gold-ink` para la cifra héroe y para la columna «ventana abierta», bajo el
  criterio derogado de que el oro marca la oportunidad.

El ADR 0004 archivó la terna de la Bandeja vieja y dijo explícitamente que cubría **solo**
esa terna. El Tablero quedó fuera. Este ADR lo cubre.

## Decisión

**Borrar** el componente `VistaTablero`, que este ADR archiva (regla dura #3: el predecesor se
archiva al llegar a paridad, con este ADR como acta). La historia queda en git; no se mueve a
ninguna carpeta `attic/`.

No hay migración pendiente: el Dashboard ya sirve todo lo que el Tablero mostraba, con
datos vivos y mejor jerarquía.

## Qué reemplaza

| Archivado | Sucesor vivo |
|---|---|
| Cifra de gente esperando | El titular de las 9am (`VistaDashboard`, banda A) |
| Estado de captura por canal | `BarraFrescura` + el chip de sesión de WhatsApp en la topbar |
| Tabla por canal | Los filtros por canal de la cola + el bloque «Los últimos 14 días» |
| Declaración de huecos | «Qué piden» y los vacíos honestos de cada bloque del riel |

## Consecuencias

- Las mediciones de la dirección pasan a decir la verdad: los `uppercase tracking-`
  literales de `src/` bajan de **5 a 1**, y ese único restante es la definición de
  `kicker` en `lib/styles.ts` — la fábrica, no un uso. Las violaciones de «sombra O
  borde» que quedaban en `src/` se van con él.
- `useFrescura`, `hace`, `useSesionWa` y `nombreCanal` **siguen vivos**: los usan
  `ColaUnificada`, la topbar y `BadgeCanal`. Este ADR no toca nada de eso.
- Mismo tratamiento que `PanelWhatsapp` (D13) y que la Bandeja (ADR 0004): retirado por
  decisión documentada, recuperable desde git si hiciera falta leerlo.
