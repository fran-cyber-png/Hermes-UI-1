"""DataPlanner — decide which backend endpoints a question needs.

Given the IntentResult, return the minimal set of endpoints whose data can
answer it. Endpoints are reused across intents (e.g. `comercial` already
carries serie, mix, embudo, latencia, sedes, bundles), so the planner
prefers the aggregating routes over many small ones.
"""

from .intent_analyzer import IntentResult

# Endpoint catalogue: name -> (path, intents-that-need-it, what-it-gives)
ENDPOINTS = {
    "overview": {
        "path": "/api/overview",
        "serves": {"rendimiento", "meta", "capi", "atribucion", "leads", "salud",
                     "comparacion", "anomalias", "riesgos", "ventas", "tendencia"},
        "note": "lazo (ventas conocidas/reportadas/perdidas), accionable por canal, "
                "flujo diario por estado, preguntas, ventas por pais",
    },
    "comercial": {
        "path": "/api/overview/comercial",
        "serves": {"ventas", "tendencia", "comparacion", "productos", "embudo",
                     "tesoreria", "sedes", "anomalias", "riesgos", "forecast", "rendimiento"},
        "note": "serie mensual, mix producto, embudo estados, latencia tesoreria, "
                "rendimiento por sede, cross-sell",
    },
    "cartera": {
        "path": "/api/overview/cartera",
        "serves": {"cartera", "tesoreria", "riesgos", "anomalias", "productos"},
        "note": "cobranza/aging, medios de pago y aprobacion, segmentos LTV",
    },
    "lazo": {
        "path": "/api/overview/lazo",
        "serves": {"capi", "meta", "atribucion", "riesgos", "anomalias"},
        "note": "detalle CAPI: modo envio, descartes, errores de Meta",
    },
    "tesoreria": {
        "path": "/api/overview/tesoreria",
        "serves": {"tesoreria", "riesgos", "anomalias"},
        "note": "reloj de vouchers esperando confirmacion, yaPerdidos, urgentes, histograma",
    },
    "salud": {
        "path": "/api/overview/salud",
        "serves": {"salud", "riesgos", "anomalias"},
        "note": "estado de flujo, gaps, que sigue",
    },
    "atribucion": {
        "path": "/api/overview/atribucion",
        "serves": {"atribucion", "campanas", "meta", "capi", "rendimiento", "riesgos"},
        "note": "ROAS/CAC por pais (requiere snapshot de pauta)",
    },
}


def plan(intent: IntentResult) -> list:
    """Return ordered list of endpoint names to fetch (deduped, minimal)."""
    needed = set()
    for it in intent.intents:
        for name, spec in ENDPOINTS.items():
            if it in spec["serves"]:
                needed.add(name)

    # 'comercial' already carries tesoreria-latencia; only add the live
    # 'tesoreria' endpoint if the user explicitly asks about vouchers/pending.
    if "tesoreria" in needed and "voucher" not in intent.raw.lower() \
       and "esperando" not in intent.raw.lower():
        # keep comercial (has latencia) but drop the heavier live endpoint
        # unless risk/anomaly intent is strong
        if "riesgos" not in intent.intents and "anomalias" not in intent.intents:
            needed.discard("tesoreria")

    # Always include overview for context if we have nothing concrete.
    if not needed:
        needed = {"overview"}

    # Stable order for readability / cache keys.
    return [n for n in ENDPOINTS if n in needed]
