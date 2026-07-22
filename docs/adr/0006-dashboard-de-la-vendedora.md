# ADR 0006 — El Dashboard es de la vendedora, no del dueño

- **Fecha:** 2026-07-22
- **Estado:** aceptado
- **Decide:** grilling del rediseño del Dashboard (`/grill-with-docs`, 7 decisiones)

## Contexto

El Dashboard es la pantalla que abre al entrar. Hoy hace dos trabajos a la vez: la columna
izquierda es la cola de la vendedora, y el riel derecho es un panel de métricas del dueño —
embudo, volumen de los últimos 14 días, y una tabla «Equipo» con conversaciones, mensajes y
ventas **por vendedora**.

Dos cosas que se verificaron durante el grilling:

1. **No existe rol de dueño en el código.** La palabra no aparece en ningún archivo de `src/`.
   No hay permisos ni vistas por rol. Entonces «Equipo» no se lo muestra al dueño: **se lo
   muestra a cada vendedora**, con los números de todas sus compañeras al lado de los suyos.
2. **Eso contradice a la propia spec del rediseño**, que sobre el modo racha dice textual:
   «ofrece, nunca apura — jamás rachas, récords ni **comparación con el equipo**». La regla
   se escribió para el composer y la pantalla principal la rompe.

Además, en producción el riel está vacío en 3 de sus 4 bloques («0 en el embudo», «Nadie
mencionó un curso todavía», «Usuario1 · 0 · 0 · 0»): la mitad de la pantalla ocupa lugar
permanente para decir cero.

## Decisión

**El Dashboard es de la vendedora y de nadie más.** Todo bloque tiene que pasar un test para
quedarse: *¿esto cambia a quién atiende ahora?* Si no lo cambia, se va o baja de rango.

«Equipo» se retira.

## Alternativas consideradas

- **Dos audiencias en una pantalla** (columna de ella, riel del dueño). Descartada: exige roles
  de verdad en el backend — permisos, atribución, qué ve cada una. Es trabajo de servidor
  disfrazado de decisión de diseño, y no arregla el problema de hoy, lo formaliza.
- **Dashboard del dueño, y la vendedora entra directo a Mensajes.** Descartada: le saca a la
  vendedora la única pantalla que puede decirle por dónde empezar, para dárselo a quien mira.

## Consecuencias

- **El dueño se queda sin panel adentro de Hermes.** Es deliberado, no un olvido. Cuando lo
  necesite será su propia vista con su propio rol — no un riel prestado en la pantalla de
  trabajo de otra persona.
- La comparación entre vendedoras **no vuelve por la ventana**: si algún día se mide el
  rendimiento del equipo, no vive acá.
- El «vacío honesto» se aplica también al layout: un bloque sin nada que decir no ocupa lugar
  (ver `CONTEXT.md` y el spec del rediseño).
