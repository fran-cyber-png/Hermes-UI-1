# Sesión 2026-07-31 — Timeline Inteligente: pasos 1–3 completados

Implementación de los primeros 3 pasos de `docs/plan-implementacion-timeline.md`.
Estrategia: orquestación pura (sin tocar código), 3 agentes en paralelo.

## Archivos creados (6)

| Archivo | Qué es | Líneas |
|---|---|---|
| `src/features/panel/timeline.ts` | Tipos (`EventoLinea`, `CampoPendiente`, `EstadoEvento`, `TipoEvento`) + `ensamblarTimeline()` (pura) + constantes `COLOR` / `ROTULO_ESTADO` / `ICONOS` | 140 |
| `src/features/panel/timeline.test.ts` | 14 tests: cliente con ventas, lead nuevo, error Cerberus, intereses, señales, progreso, sin datos, todo junto | ~160 |
| `src/features/panel/EncabezadoTimeline.tsx` | Header: avatar, nombre, teléfono, estado, barra %, chips de info | 73 |
| `src/features/panel/EventoLinea.tsx` | `EventoLinea` (evento con color × estado, hover buttons) + `LineaPendiente` (campo faltante, dashed) | 141 |
| `src/features/panel/PieAccionTimeline.tsx` | Botón contextual: "Registrar venta" (cliente), "Marcar como interesado" (nuevo), texto (cargando/error) | 51 |

## Archivo modificado (1)

| Archivo | Cambio |
|---|---|
| `src/features/panel/PanelDerecho.tsx` | Reescritura completa: 155→121 líneas. `BandaEstado` → `EncabezadoTimeline`. `TimelineContacto` + `Intereses` → `EventoLinea` unificado. `hitosDe` → `ensamblarTimeline`. `DosRespuestas` / `BloqueHechos` → fuera del panel. Hooks intactos. |

## Verificación

- **Typecheck**: 0 errores (`npx tsc --noEmit -p tsconfig.app.json`)
- **Tests panel**: 52/52 pasan (timeline 14 + estadoContacto + hitos + identidad)
- **Vite**: corriendo en `:5199` con `VITE_API_URL=https://hermes-api.goberna.us`
  - `nohup npx vite --port 5199 --host 0.0.0.0 > /tmp/hermes-vite.log 2>&1 &`
  - PID: 85999

## Archivos huérfanos (8)

No se borraron — análisis completado, documentado en reporte del paso 4:

| Archivo | Veredicto |
|---|---|
| `BandaEstado.tsx` | Sin consumidores |
| `TimelineContacto.tsx` | Sin consumidores |
| `hitos.ts` | Solo consumido por TimelineContacto (huérfano) |
| `AccionesContacto.tsx` | Sin consumidores |
| `BloqueInteres.tsx` | Sin consumidores |
| `PanelCurso.tsx` | Sin consumidores |
| `DosRespuestas.tsx` | PRESERVAR — el plan dice reubicar a otra superficie |
| `BloqueHechos.tsx` | PRESERVAR — ídem |

## Lo que sigue (pasos 4–5 del plan)

1. **Paso 4**: Borrar o archivar los 6 huérfanos no preservados (`BandaEstado`, `TimelineContacto`, `hitos`, `AccionesContacto`, `BloqueInteres`, `PanelCurso`). Mover `hitos.test.ts` a `docs/adr/` o borrarlo (la lógica de hitos ya no se usa).
2. **Paso 5**: Verificación visual con Playwright — abrir 3 conversaciones reales y capturar:
   - Un cliente con compras
   - Un lead nuevo
   - Un lead con precio enviado y enfriado
3. **Reubicar sugerencias**: `DosRespuestas` y `BloqueHechos` necesitan una superficie propia (tecla, botón flotante, o integrados al composer). No es parte de esta etapa según el plan.
4. **ADR**: Escribir el ADR del timeline y archivar ADR 0017.

## Para retomar

```bash
# Asegurar que Vite sigue corriendo (si no, arriba está el comando)
curl -s -o /dev/null -w "%{http_code}" http://localhost:5199/

# Correr tests
npx vitest run src/features/panel/

# Typecheck
npx tsc --noEmit -p tsconfig.app.json
```

El plan completo está en `docs/plan-implementacion-timeline.md`.
