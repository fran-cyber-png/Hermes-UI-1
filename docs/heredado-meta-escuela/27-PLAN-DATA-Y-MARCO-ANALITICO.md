# 27 — Plan completo: mejores análisis de Ivi (data Cerberus+Meta + marco analítico)

> Nace del pedido de Estephano (2026-07-17): "potenciar la integración Cerberus +
> Meta para sacar mejores análisis" y "armar una estructura mejor: criterios,
> respaldos, integrar bien la data, mini-inferencias". Este doc es el plan,
> anclado en dos investigaciones verificadas de esta sesión: el **mapa real de la
> data** (repos ceberusapp, goberna-dashboard, backend meta-escuela) y los
> **benchmarks del negocio** (ROAS/CAC/escalado para info-products LATAM en Meta).
> Ley I también acá: cada número lleva su respaldo; lo no verificado se marca.

## 0. El insight en tres frases

1. **Mejores análisis = mejor DATA + CRITERIOS fundados + ESTRUCTURA.** Los parches
   de hoy (materialidad, frescura, jugada por país) son sintomáticos: falta el marco.
2. **La integración con Meta ya existe dos veces, incompleta y desconectada.** El
   backend (`geoGasto`) trae gasto por país pero como una foto; el dashboard satélite
   (`sync_meta_ads`) ya tiene gasto por campaña×país×mes y ROAS por producto — pero
   corre en otro stack y **no está cableado a Ivi**. No hay que construir de cero:
   reconciliar, completar y conectar.
3. **Los criterios actuales están mal calibrados para tu negocio.** El backend usa
   `ROAS_OBJETIVO=4` hardcodeado; para un info-product de margen ~90% el break-even
   es ~1.2x y el piso operativo ~2.5-3x. Y tu 7,1x no es una meta a defender: es
   **señal de subinversión** → hay caso fuerte para escalar los USD 3.000/mes.

## 1. La data hoy (el flujo real, mapeado)

```
VENTAS:  Cerberus (VPS2, MySQL, tb_venta…) ──dump SQL MANUAL──▶ fuentes.registro
         ──proyectarCerberus──▶ ontologia.venta (USD, estado, país)  ──HTTP──▶ Ivi
         (en paralelo: webhook Icarus en vivo ──▶ conversiones ──CAPI──▶ Meta,
          pero NO reproyecta la capa canónica de análisis)

GASTO:   Meta Graph API ──refrescarPauta (reloj 6h)──▶ insights level=account,
         breakdowns=country (SIN time_increment) ──▶ pauta_snapshots.gasto (1 foto)

CRUCE:   /api/overview/atribucion une las dos mitades SOLO por país (nombre
         normalizado): correlación agregada, no atribución causal ad→venta.

APARTE:  goberna-dashboard (VPS2, MySQL app.goberna.pe, dashboard.goberna.us):
         sync_meta_ads ──▶ tb_meta_ads (spend campaña×país×mes) + ROAS producto×país.
         NO conectado a Ivi ni a Cerberus/Postgres.
```

Lo que Cerberus **sí** tiene: venta (país nullable→fallback cliente, monto, estado
Pagado/Anulado/Reembolsado, fecha), detalle_venta (producto por línea), cliente
(email/tel para CAPI), cuotas+pagos (ingreso REAL cobrado = pagos estado=2), medios
de pago, moneda con tasa congelada.

Lo que Cerberus **no** tiene (y por eso limita todo): **cero datos de Meta** —
sin `campaign_id/adset_id/ad_id`, sin UTM, sin `fbclid/fbp/fbc`, sin spend. El único
vínculo es `Venta.origen`/`Venta.medio`: dos dropdowns **manuales** que el vendedor
elige (facebook/instagram/… ; organico/pagado/…). Y las órdenes de WooCommerce
(donde aterriza el tráfico de Meta) llegan con **`origen` hardcodeado** (`WC_VENTA_ORIGEN`,
default 'correo') y `medio='pagado'` fijo → el e-commerce queda mal atribuido.

## 2. Los gaps (por qué los análisis se quedan cortos) y cómo cerrarlos

| # | Gap | Qué análisis bloquea | Fix | Esfuerzo |
|---|---|---|---|---|
| 1 | **Gasto sin serie país×tiempo**: `geoGasto` pide `breakdowns=country` sin `time_increment` | No hay tendencia de ROAS por país ni comparación de períodos por país | Agregar `time_increment` a esa llamada (o una tabla país×día) | **chico** |
| 2 | **No hay per-producto-por-país**: ventas por país no cruzan con producto; el spend no tiene dimensión producto | No hay ROAS por curso ni curso×país | Reconciliar con `tb_meta_ads` del dashboard (ya mapea campaña→producto, aunque ~137/237 campañas sin `codigo_producto`) | **medio** |
| 3 | **Atribución solo geográfica** (país-audiencia × país-cliente), no causal | No se puede atar venta→campaña→ad; el ROAS por país es proxy | Fase larga: capturar UTM/`fbclid` en landings+checkout, y usar el matching de CAPI (el payload de Icarus ya tiene event_id+email+tel) | **grande** |
| 4 | **Frescura desacoplada**: ventas solo se actualizan con dump+proyección MANUAL; el webhook no reproyecta | El análisis de ventas va por detrás de lo que ya llegó por webhook; gasto puede quedar stale (6h+) | Cron del dump+proyección, o reproyectar on-webhook; anclar la ventana a "hoy" no a `snap.creadoAt` | **chico-medio** |
| 5 | **WooCommerce hardcodea el origen** (`WC_VENTA_ORIGEN='correo'`, `medio='pagado'`) | Todo el e-commerce pierde el canal real → falsos negativos en el ROAS de pauta | Capturar el source real en el webhook de WooCommerce (en ceberusapp) | **chico** |
| 6 | **Sesgos de exclusión**: 'Sin país' fuera del ranking, monedas sin tasa descartadas, `monto_usd null` excluido | Shares y totales calculados sobre un subconjunto, no el 100% | Tabla FX completa (no descartar), y contabilizar 'Sin país' como categoría | **chico** |

## 3. Los CRITERIOS (fundados, con respaldo)

Investigación verificada (20/24 cifras confirmadas). Para **info-products digitales,
ticket ~USD 115, margen ~85-90%, mercados LATAM en Meta**:

### 3.1 ROAS
- **Break-even ROAS ≈ 1.2x** (fórmula `1/margen`, cargando fees de pago ~5% + colchón
  de reembolsos ~5%). `[VERIFICADO: fórmula 1/margen]`
- **Objetivo operativo (piso) = 3x** — deja ~USD 1,55 de contribución por cada USD de
  pauta. **NO el 4x que hoy está hardcodeado** en `roas.ts` (inflado para tu margen),
  **ni el 7x a "defender"**. `[SÍNTESIS calibrada al margen — no un número citable suelto]`
- **Stop-loss = 2x sostenido** por producto/mercado (frenar ese segmento).
- **Lectura del 7,1x actual**: franja "excelente", ~5-6x sobre break-even →
  **subinvertido**. Caso fuerte para escalar (apuntar a 2-3x el gasto de 3.000/mes,
  dejando caer el blended hacia 3-4x mientras el ROAS **marginal** se mantenga ≥2x).
  Ojo honesto: 7,1x es ROAS de plataforma (last-touch); el incremental real es casi
  seguro menor → por eso "escalar" exige evidencia, no el número lindo (§4).

### 3.2 CAC (semáforo por venta; `CAC = ticket / ROAS`, ticket ~115)
| | CAC/venta | ROAS equivalente | Acción |
|---|---|---|---|
| 🟢 Verde | ≤ USD 29 | ≥ 4x | escalar |
| 🟡 Amarillo | USD 29-38 | 3-4x | alerta: revisar creatividad/segmentación |
| 🔴 Rojo | > USD 38 | < 3x | frenar ese segmento |
| ⛔ Techo duro | ~USD 95-98 | ~break-even | nunca superar (perdés en la 1ª venta) |
- CAC implícito de Goberna hoy ~USD 16 → LTV:CAC ~6:1 → subinvertidos. `[HECHO interno]`
- A nivel LEAD: benchmark educación-LATAM ~USD 13-15; **alerta si CPL > ~USD 18-20**.
  `[VERIFICADO: CPL educación FB ~USD 21 US; LATAM ~mitad]`
- La regla **LTV:CAC 3:1** como piso saludable. `[VERIFICADO]`

### 3.3 Confianza estadística (valida y extiende la materialidad que ya pusimos)
- **< 25 compras por país = ruido** → no escalar por alto que se vea el ratio (el caso
  EEUU: 26 ventas, ratio inflado). `[VERIFICADO direccional: error ~1/√N]`
- **≥ 25 = direccional** (±20%); **≥ 50-100 = decisión defendible** (±10%).
- Alinea con lo que ya hace el backend (confianza alta = ventas≥30 & gasto≥500).

## 4. RESPALDOS — la Ley I hecha *gate*, no sugerencia

Tu regla ("escalar solo si está muy bien sustentado") se vuelve estructural:

- **Toda afirmación** de Ivi lleva: tipo (HECHO/ESTIMACIÓN/SIN_EVIDENCIA) + **fuente**
  (endpoint/campo) + **frescura** (fecha) + **confianza** + el **número crudo**.
- **"Escalar" es un gate de 5 condiciones — TODAS en verde o no se recomienda:**
  1. **Volumen de señal**: el ad set tiene ≥50 eventos de optimización/semana y salió
     de learning phase. Si un país no llega a 50 compras/semana → optimizar por LEAD.
  2. **Confianza**: ≥25 compras acumuladas (direccional), ≥50-100 (defendible). <25 = ruido.
  3. **Sostenido**: ROAS ≥3x por ≥3 semanas/períodos, no un pico suelto.
  4. **Sin fatiga**: frecuencia prospecting <2,5-3, CPM sin subir >15-25% en 2 semanas,
     CTR sin caer >10%.
  5. **Escala controlada**: +20-30% cada ~3-4 días (Meta recomienda esperar ~7 días /
     ~50 eventos tras un cambio grande `[VERIFICADO]`), vigilando el ROAS **marginal** ≥2x.
- **Honestidad obligatoria**: si falta señal (ej. EEUU <25 ventas), Ivi dice *"no
  alcanza para decidir, es ruido"*, no "escalá porque el ratio es alto". Y marca que
  el 7,1x es de plataforma; el gold standard de "sustentado" es incrementality/geo-lift.

## 5. MINI-INFERENCIAS — cadenas auditables

Cada tipo de pregunta se resuelve como una cadena de pasos `input(respaldo) → criterio
→ output(tipado)`, para que "¿por qué recomendó eso?" se conteste paso a paso.

Ejemplo — **"¿dónde y cuánto escalar con USD 3.000/mes?"**:
```
1. roasPais (HECHO, fuente: /atribucion, frescura 11/07)         [input]
2. filtrar material (gasto≥150, confianza≥media)                  [criterio 3.3]
3. escalables = accion 'escalar' + confianza alta + ROAS≥3x + ≥25 ventas
   → Perú, México                                                [criterio 3.1/3.3]
4. gate de escalado (§4, 5 condiciones) por cada uno             [gate]
   → ¿verde? Perú sí; EEUU NO (26 ventas = ruido) → test, no escalar
5. con 3.000/mes: sugerir +20-30% a los verdes, hasta que el ROAS
   MARGINAL toque 2x (no lineal: modelar saturación, no extrapolar) [criterio 3.1]
6. lift esperado = ESTIMACIÓN (supuesto: elasticidad; marcar como tal)
```
Cada paso tipado y auditable. Esto es lo que hoy hace a medias el `impact_engine`;
el plan lo formaliza como un razonador de pasos.

## 6. Roadmap por fases (cada corte deployable y verificable)

- **Fase 1 — Criterios fundados + presupuesto (rápida, alto valor).** Recalibrar los
  umbrales del backend (`roas.ts`: objetivo 4→3, stop-loss 2, semáforo CAC) y hacerlos
  **parametrizables** (no hardcodeados); integrar el **presupuesto USD 3.000/mes** como
  dato conocido; centralizar todo en un `criterios` único (motor Ivi + backend). Con
  esto, Ivi ya recomienda fundado (deja de decir "objetivo 4x" y de coronar ratios de base chica).
- **Fase 2 — Gasto país×tiempo (gap #1).** `time_increment` en la llamada de insights →
  tendencia de ROAS por país, comparación de períodos. Desbloquea "¿mejoró Perú vs el mes pasado?".
- **Fase 3 — ROAS por producto (gap #2).** Reconciliar `tb_meta_ads` del dashboard →
  ROAS por curso y curso×país. Desbloquea "¿qué producto conviene en qué país?" (el caso
  "consultor político" que hoy falla).
- **Fase 4 — Atribución + frescura (gaps #3-6).** Capturar UTM/`fbclid` (landings +
  WooCommerce) + matching por CAPI; frescura automática (cron/reproyección); arreglar
  el hardcode de WooCommerce y los sesgos de exclusión.
- **Fase 5 — Gate de escalado + mini-inferencias en el motor.** El razonador de pasos
  (§5) y el gate (§4) codificados; Ivi Studio consume esto para el creativo.

## 7. Decisiones abiertas para vos (para arrancar la Fase 1)

1. **ROAS objetivo**: ¿te cierra piso **3x** / stop-loss **2x**? (hoy el código dice 4x).
2. **Semáforo CAC**: ¿verde ≤29 / amarillo 29-38 / rojo >38 / techo ~95? (ticket 115, margen 85%).
3. **Escalar el presupuesto**: la data dice que estás subinvertido. ¿Querés que la Fase 1
   ya proponga un plan de escalado de los 3.000/mes (con el gate de §4 como respaldo)?
4. **Prioridad de fases**: ¿Fase 1 (criterios) primero, o te urge más la Fase 2/3 (la data
   de producto y tendencia)?

## Apéndice — respaldo de las cifras

Verificado (fuentes primarias, verificación adversarial): break-even = 1/margen; cursos
online margen 80-90%; ROAS "bueno 2-4x" es de e-commerce físico (no aplica directo);
CPL educación FB ~USD 21 (US), LATAM ~mitad; LTV:CAC 3:1 saludable; Meta ~7 días/50
eventos tras cambio grande; confianza ~1/√N. **Síntesis calibrada (no número citable
suelto)**: piso 3x, stop-loss 2x, gatillo de escala 3,5x. **No verificado / marcar**:
CPM/CPL duros de Ecuador (interpolados del tier andino); tasa de reembolso de cursos
(muy dispersa, usar colchón ~5%); el 7,1x incremental real (probable sobreestimación
del last-touch). Cifras internas de Goberna (7,1x, ticket 115, 648 ventas): datos del
negocio, no verificados externamente.
