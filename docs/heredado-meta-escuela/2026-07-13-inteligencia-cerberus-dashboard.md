# La inteligencia de Cerberus y el dashboard: gap map y roadmap

**Fecha:** 2026-07-13
**Origen:** extracción sistemática (workflow) de goberna-dashboard (Django) y Cerberus (goberna-crm /
goberna-app + el espejo de 72 tablas), cruzada contra lo que meta-escuela ya tiene.
**Motivo:** el usuario observó, con razón, que Cerberus y el dashboard eran más útiles para el
análisis de ventas/pauta, y que solo había portado dos cerebros sueltos (ROAS y geo) sin extraer
toda la inteligencia —KPIs, tablas, decisiones— que esos sistemas ya pensaron.

## Lo que ya teníamos cubierto

ROAS real por país (audiencia×cliente + veredicto + portón de volumen), ventas por país en USD con
tasa congelada, simetría FX ventas↔gasto, el lazo CAPI (ventana 7 días, gatillo primera cuota),
costo por lead, decisiones de reparto de presupuesto, creativos (miniatura+copy+costo+veredicto),
bandeja por canal, "la puerta cerrándose", "qué escribe la gente", leads sin contactar, tablero de
salud. Cerebros portados del dashboard: roas_analysis, geo_report, fx.

## Los tres bloques de inteligencia sin capturar

1. **EL TIEMPO** — no teníamos ninguna serie temporal. El dashboard tiene el concepto **onset**: un
   ROAS bajo al arranque es artefacto de carga (hubo pauta, las ventas aún no estaban cargadas), no
   una mala campaña. Sin eso no se puede leer tendencia ni estacionalidad.
2. **EL CAMINO DEL DINERO EN CERBERUS** — cobranza/mora, mix de producto, LTV/recompra/cohortes,
   medios de pago, rendimiento por vendedor/sede: todo espejado y sin un solo análisis que lo toque.
   Inteligencia latente de costo cero.
3. **LA CAPA DE DECISIÓN EXPLICABLE** — el copiloto determinista (por qué / evidencia / qué hago /
   qué pasa si + riesgos), oportunidad_usd (priorizar por dólares, no por ratio), confianza como
   multiplicador, ROAS por producto, fatiga de creativos.

**El diferencial de meta-escuela**: somos el único lugar donde Cerberus y Meta se cruzan. La latencia
de Tesorería (p90 ~10 días) es lo que tira ventas fuera de la ventana CAPI de 7 días —medirla y
bajarla reporta más ventas a Meta—; el LTV alimenta audiencias de valor; el ROAS por producto decide
qué SKU pautar.

## Roadmap por olas

### Ola 1 — El tiempo y el dinero latente (alto valor · bajo esfuerzo · data lista)
1. **Serie temporal mensual** ventas + ROAS con flag `onset`.
2. **Latencia de Tesorería** (fecha_confirmacion − fecha_pago) por sede/asesor — el KPI con mayor
   diferencial Meta, a un paso de `confirmadaAt`.
3. **Mix de producto/categoría** (ranking por ventas y USD, ticket promedio) — `tb_detalleVenta`.
4. **Embudo de estados de venta** (tasas: cotización→venta, anulación, arrepentimiento 1,6%, cuotas 9,9%).
5. **oportunidad_usd** + **reasignación por share-gap** (budget_share vs ventas_share > 15 pts) sobre
   las filas de ROAS que ya tenemos.

### Ola 2 — La cartera y el cliente (alto valor · esfuerzo medio · Cerberus latente)
6. **Cobranza / Mora** (cartera viva: cuotas vencidas, aging, saldo) sobre `tb_cuotas`+`tb_pago`
   (solo pagos estado 1/2, para no repetir el bug del pago denegado que salda cuota).
7. **LTV / recompra / cohortes** por cliente + primer push de **audiencias de valor** a Meta (hash SHA-256).
8. **Rendimiento por vendedor / sede** (extraer columnas del payload jsonb crudo).
9. **Medios de pago**: mix, ticket por medio, tasa de aprobación.

### Ola 3 — La capa de decisión Meta×Cerberus (integración fina)
10. **ROAS por producto/SKU** con tabla puente campaña↔producto (atacar el naming en el origen).
11. **Copiloto explicable** determinista (`build_explanation`) envolviendo el cerebro escalar/recortar
    + confianza como multiplicador.
12. **Utilidad y margen** por línea de negocio.
13. **Simulador de presupuesto** por país (slider ±%, proyección lineal honesta).

### Ola 4 — Creativos y drill-down (medio valor · depende de granularidad de insights)
14. **Fatiga de creativos** (frecuencia↑ Y CTR↓ sobre ≥14 días) — necesita serie diaria ad×día.
15. **Creativos por país** en dos modos (entrega vs targeting) + `gasto_cubierto_pct`.
16. **Drill país→campaña/producto** (métricas de entrega, sin ROAS a ese nivel por honestidad).
17. **Cross-sell / bundles** (productos co-comprados en la misma venta).
18. **Heatmap CPR por percentil** + KPIs de cabecera frescos (pulido de UX).

## Explícitamente NO replicar
- Flujos de ESCRITURA (crear/duplicar campaña vía Graph API): compliance, riesgo, fuera del alcance analítico.
- Reconciliación Excel/API y match por prefijo de account_id: deuda técnica de su migración; tenemos espejo limpio.
- Navegación sidebar que imita el ERP (cosmético).
- Aparato de compliance político SIEP: caso de negocio separado, no core hoy.
- Fulfillment/matrícula vía `tb_matricula`: fuente INCOMPLETA (las matrículas llegan a Moodle sin
  escribir `tb_matricula`; 20/20 ventas "sin matrícula" sí estaban matriculadas). Solo con el cruce a
  Moodle como fuente de verdad.
