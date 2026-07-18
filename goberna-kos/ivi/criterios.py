"""criterios — la capa de CRITERIOS de Ivi, centralizada y fundada (docs/27 §3).

Un solo lugar para los umbrales de decisión, con su respaldo. Antes vivían
dispersos y hardcodeados (roas_material en kpi_engine, los cortes ROAS en el
backend). Calibrados para el negocio de Goberna: info-products digitales, ticket
~USD 115, margen ~85-90%, mercados LATAM en Meta. Todo env-overridable.

Ley I: cada número lleva su respaldo. [VERIFICADO] = del research de benchmarks
(docs/27 apéndice, verificación adversarial); [SÍNTESIS] = calibración de growth
al margen alto, no una cifra citable suelta.
"""

import os


def _num(env, default):
    try:
        return float(os.environ.get(env, "") or default)
    except ValueError:
        return float(default)


# ── Presupuesto (dato conocido, ya no adivinado) ──
# Presupuesto mensual de pauta en Meta (Estephano, 2026-07-17). Ivi lo usa para
# aterrizar las recomendaciones ("con tus USD 3.000/mes...") en vez de opinar en abstracto.
PRESUPUESTO_MENSUAL_USD = _num("IVI_PRESUPUESTO_MENSUAL_USD", 3000)

# ── ROAS (docs/27 §3.1) — margen ~85-90% ──
ROAS_BREAKEVEN = _num("IVI_ROAS_BREAKEVEN", 1.2)   # [VERIFICADO] 1/margen + fees ~5% + reembolsos ~5%
ROAS_PISO = _num("IVI_ROAS_PISO", 3.0)             # [SÍNTESIS] piso operativo: ~USD 1,55 de contrib./USD
ROAS_STOP = _num("IVI_ROAS_STOP", 2.0)             # [SÍNTESIS] stop-loss: por debajo, frenar el segmento
ROAS_ESCALAR_CONFIABLE = _num("IVI_ROAS_ESCALAR_CONFIABLE", 3.5)  # [SÍNTESIS] blended sostenido para escalar

# ── CAC caro (docs/27 §3.2): semáforo por venta, CAC = ticket/ROAS ──
TICKET_USD = _num("IVI_TICKET_USD", 115)
CAC_VERDE = _num("IVI_CAC_VERDE", 29)   # <= esto: ROAS >= 4x, escalar
CAC_ROJO = _num("IVI_CAC_ROJO", 38)     # > esto: ROAS < 3x -> "CAC caro", frenar
CAC_TECHO = _num("IVI_CAC_TECHO", 95)   # [VERIFICADO] ~break-even (ticket*margen); nunca superar

# ── Confianza estadística (docs/27 §3.3) ──
VENTAS_RUIDO = int(_num("IVI_VENTAS_RUIDO", 25))       # [VERIFICADO ~1/√N] < esto/país = ruido (caso EEUU)
VENTAS_DEFENDIBLE = int(_num("IVI_VENTAS_DEFENDIBLE", 50))  # >= esto = decisión de escalado defendible


def semaforo_cac(cac_usd):
    """Clasifica un CAC por venta: 'verde' | 'amarillo' | 'rojo' | 'techo' | None."""
    if cac_usd is None:
        return None
    if cac_usd >= CAC_TECHO:
        return "techo"
    if cac_usd > CAC_ROJO:
        return "rojo"
    if cac_usd > CAC_VERDE:
        return "amarillo"
    return "verde"


def presupuesto_txt():
    """USD 3.000 (formato es-AR: punto de miles)."""
    return "USD " + f"{int(PRESUPUESTO_MENSUAL_USD):,}".replace(",", ".")
