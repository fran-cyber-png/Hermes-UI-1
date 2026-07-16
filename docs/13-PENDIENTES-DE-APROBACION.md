# Pendientes de aprobación — sesión 2026-07-16 (tarde)

> Lo que quedó propuesto y SIN aplicar al cierre de la sesión que arregló §6 (`9b0bedf`) y corrió
> la segunda auditoría (`docs/12-AUDITORIA-2026-07-16.md`). Nada de esto se toca sin un OK
> explícito — una iteración por aprobación. Para retomar: decir qué lote va, o "iteración 3 como
> está". Contexto completo en docs/12 y en las memorias engram #2763/#2764.

---

## Lote A — URGENTE antes de conectar el webhook de Cerberus (~15 líneas + test)

`webhook/ruta.ts:143` dispara Purchase REALES sin compuerta y sin dedup propio. Hoy inofensivo
(0 webhooks recibidos en la historia — VPS2 no llega a la laptop), pero hay 126 ventas en cuotas
activas: cada cuota confirmada reenviaría el monto TOTAL de la venta (venta de $1.200 en 3 cuotas
= $3.600 enseñados a Meta; el dedup de Meta solo cubre 48 h).

1. **Compuerta de modo**: el webhook debe respetar la misma llave que el worker (`LAZO_RELOJ` /
   simulación): registrar la conversión siempre, ENVIAR solo si el modo lo permite.
2. **`yaEnMeta()` antes de `capi.enviar`**: el guard existe (`lazo/worker.ts:85-106`) y el webhook
   es el único de los 2 llamadores de `capi.enviar` que no lo usa.

## Lote B — bugs vivos chicos (verificados contra la base)

| # | Qué | Fix | Tamaño |
|---|---|---|---|
| B1 | `ontologia/ventas.ts:139` — el país del lazo es NULL siempre (`codigo_pais` no existe en `tb_cliente`; es `id_pais`, 0/4.752) | `codigo_pais` → `id_pais` | 1 palabra |
| B2 | `tb_pago.estado=1` = "Procesando" (11/12 sin confirmación) pero `proyectar.ts:232`/cartera lo cuentan como cobrado (~$4.205 crudo) | Crear `dominio/estadosPago.ts` (fuente única, verificada hoy: 1=Procesando, 2=Completado, 4=Rechazado) y decidir la semántica de `valido` | ~40 líneas + **decisión de negocio** |
| B3 | N=1: venta MXN pagada con USD $2.800, convertida como MXN (≈$163) — `proyectar.ts:222` usa la moneda de la venta para el pago | Documentar la excepción o usar la moneda del pago cuando difiere | decisión chica |

**Decisión pendiente de B2 (Estephano)**: ¿un voucher "Procesando" (sin mirar por Tesorería)
cuenta como plata cobrada en `/cartera`? Recomendación del CTO: **no** — `valido = solo estado 2`,
y "en verificación" como categoría aparte. Hoy son 12 pagos.

## Lote C — endurecimientos (cargados de docs/12, sin mordida hoy)

Recomendación: cada fix aterriza **con su test de I/O** (Postgres de Docker ya está; tests de
integración que corren con `DATABASE_URL` y se saltean sin ella). El arnés nace pagado por los
fixes — es la cura del patrón que dio 8 bugs en dos días.

1. `fuentes/cerberus.ts:114-133` — `ultimaOk` solo si la ingesta trajo filas y las tablas de
   plata están (mismo patrón que `snapshot.ts` hoy); `canales/salud.ts` debe LEER `ultimo_error`.
2. `meta/metaClient.ts:85-90` — `res.ok` en páginas 2+ de `getAll` (throw → entra a `errores` →
   la recolecta deja de ser "limpia"). Hoy no pagina (máx 176 ads/cuenta < limit 500).
3. `pauta/geoGasto.ts:51-53` — moneda sin tasa: contar y subir a `errores` (o `sinTasa` como
   `costoPorLead`), no descartar mudo.
4. `routes/costoPorLead.ts:122-125` — reportar campañas omitidas por rate limit; hoy su fallo ni
   ensucia `erroresTodos`.
5. `nullif(payload->>'fecha_x','')` en los casts de `ontologia/ventas.ts:104-108` (una fecha `''`
   mataría TODO el lazo), `canales/tesoreria.ts:96-132`, `sdk/herramientas/ventas.ts:36-39`.
   Hoy 0 filas malas.
6. `canales/verdad.ts` — una sola definición de ventana (`VENTANA_META`) para `loAccionable` /
   `loCerrado` / `flujoPorDia` (hoy tres definiciones; dormido porque la ingesta está parada).

Menores anotados en docs/12: `results 0→null` en recolectar, `LIMIT 1` sin `ORDER BY`,
`daily_budget/100` con CLP/COP, `webhook/firma.ts` muerto, etiquetas de rango del maestro,
dos `aUsd` con contratos distintos.

## Iteración 3 propuesta — la capa 2 (`inferencias`) + el Model Router

- **Objetivo**: guardar lo que un modelo CREE sin mezclarlo con lo que PASÓ, y enrutar por tarea:
  Qwen en geógrafo (corto/privado — hay `qwen3:14b` ya bajado, la Constitución lo asume) y Gemini
  (contexto grande; `GEMINI_API_KEY` ya está en `server/.env`).
- **Alcance chico**: (1) tabla `ontologia.inferencias` append-only con firma obligatoria
  (`modelo`, `modelo_version`, `confianza`, `insumos`); (2) `server/src/ia/router.ts` +
  adaptadores — **sin fallback silencioso**: si el modelo elegido no responde, la inferencia NO
  existe, jamás un default; (3) UNA inferencia piloto de punta a punta que consuma solo Tools del
  SDK; (4) tests puros del router.
- **Fuera de alcance**: migrar Ivi (iteración 4), re-inferencia masiva, UI, tocar hechos.
- **Verificación**: misma entrada por ambos modelos → dos filas firmadas comparables; ninguna
  escritura fuera de `inferencias`; typecheck + tests.
- **Riesgos**: costo Gemini (tokens en la firma); 8B vs 14B (decidir; el 14b ya está en geógrafo);
  geógrafo sin systemd (si se cae, el router lo dice, no lo esconde).

## Notas operativas (estado al 2026-07-16 ~18:00)

- **Token de Meta**: expuesto en el transcript de ayer, NO rotado (sin señal de rotación: los
  fallos del reloj son `fetch failed` = red, no OAuth; último uso exitoso 15/07 18:59). Esta
  sesión no hizo NINGUNA llamada a Meta. El reloj de pauta llamará solo (~cada 6 h) con lo que
  haya en `server/.env` — `PAUTA_RELOJ=off` para congelar durante la rotación.
- **La ingesta de interacciones lleva 5 días parada** (última: 11/07 18:08). La bandeja de la
  home muestra el mundo de la semana pasada.
- **El dump de Cerberus es del 13/07** — ventas/cartera/comercial responden "al 13 de julio".
- **WIP de ayer sin commitear**: fatiga.ts, curso.ts, backfill.ts, front de Pauta Maestro
  (páginas/tabla/spark), package.json + lock, borrado de docs viejos ya consolidados. Decidir:
  commitear o descartar. Ningún commit de hoy lo arrastró.
- `.env.example` apareció modificado (1 línea en blanco) durante la sesión sin intervención del
  agente — ¿otro editor/sesión abierto?
- **El chat (Ivi) está vivo y probado hoy**: UI en `http://100.117.204.80:8080` (geógrafo),
  smoke test E2E OK — ya responde con los datos post-fix (Perú 7.25×, México 7.07×; el Bolivia
  10× falso desapareció). Limitaciones conocidas mientras no migre al SDK: lee los BFF de
  pantalla con `num_ctx` 8k, no tiene la serie histórica (`governa.pauta.serie` existe y no la
  consume), y su narrativa de "273 fuera de ventana" es la interpretación vieja (docs/10 §2 la
  corrigió). Hereda el sesgo chico de cartera (B2) hasta que se arregle.
