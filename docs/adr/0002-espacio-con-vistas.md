# ADR 0002 — De "una sola pantalla" a un espacio con vistas

- **Fecha:** 2026-07-21
- **Estado:** aceptado (diseño); la implementación llega por horizontes (`plan-crm-definitivo.md`)
- **Decide:** Estephano

## Contexto

Hermes nació con la regla "**sin router — una sola pantalla**" (ADR 0001, CLAUDE.md §Stack): la
Bandeja de 3 columnas era todo el producto, y estaba bien — el MVP era atender una cola.

Al planear el "CRM definitivo" (mapa completo de funcionalidades contra el mercado 2025-26,
sesión 2026-07-21) aparecieron funciones que **no entran en la Bandeja sin romperla**: el embudo
kanban, la búsqueda de personas con ficha 360, y el tablero de métricas de equipo. Meterlas en la
misma pantalla violaría la restricción de carga cognitiva del design system ("cuando dudes,
sacá") y el anti-patrón de redundancia (los mismos números en tres lugares).

## Decisión

Hermes pasa a ser **un espacio con 4 vistas** — Bandeja · Embudo · Personas · Tablero — con estas
reglas:

1. **La Bandeja sigue siendo la casa**: vista por defecto, el 90% del tiempo de la vendedora.
   Las otras vistas son **ángulos de los mismos datos**, nunca secciones con vida propia.
2. **Navegación por máquina de estados, sin router ni URLs** (el patrón del panel Bravo,
   design system §9). El espíritu de la regla original se conserva: una app, un flujo, cero
   laberinto. Lo que cambia es que el conmutador de vistas existe.
3. **Una acción primaria por vista.** Bandeja: Enviar. Embudo: mover de etapa. Personas:
   registrar venta. Tablero: ninguna (se mira).
4. Ninguna vista nueva se construye antes de su horizonte (Embudo y Tablero = H3; Personas = H2/H4
   según identidad). Esta ADR habilita la arquitectura, no adelanta trabajo.

## Qué reemplaza

La frase "Sin router — una sola pantalla" de `CLAUDE.md` §Stack pasa a "Sin router — un espacio
con vistas conmutadas por estado (ADR 0002); hoy solo existe la Bandeja". Los mockups del espacio
completo viven en `docs/prototypes/crm-definitivo/`.

## Consecuencias

- `App.tsx` incorporará un conmutador de vista (estado local, sin dependencia nueva) cuando
  llegue H3. Hasta entonces el código no cambia.
- El header crece: `[escudo]│HERMES · Bandeja · Embudo · Personas · Tablero · [selector número]`.
  El dorado conserva su único significado (tiempo que se acaba) en todas las vistas.
- Si al implementar H3 la evidencia dice que dos vistas alcanzan, se poda acá mismo con una
  revisión de esta ADR — la regla madre sigue siendo "restraint > features".
