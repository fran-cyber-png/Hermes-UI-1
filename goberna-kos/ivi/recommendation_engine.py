"""RecommendationEngine — prioritized, actionable next steps.

Maps detected Insights + KPIs to concrete actions, ordered by impact.
Each action has: priority, action (verb phrase), rationale (links to data),
and owner hint (which team should act).
"""

from dataclasses import dataclass, field
from typing import List

from .kpi_engine import KPIs
from .analytics_engine import Analysis
from .insight_engine import Insight


@dataclass
class Action:
    priority: int          # 1 = do first
    action: str
    rationale: str
    owner: str


def recommend(k: KPIs, a: Analysis, insights: List[Insight]) -> List[Action]:
    actions: List[Action] = []
    prio = 1

    has = lambda key: any(i.text and key in i.text for i in insights)

    if has("MODO PRUEBA") or has("nunca se ha corrido"):
        actions.append(Action(prio, "Pasar el envío CAPI de Meta a MODO PRODUCCIÓN",
            "Hoy los eventos de venta no optimizan la pauta; Meta aprende de ruido.",
            "Growth / DevOps"))
        prio += 1

    if has("fuera de la ventana"):
        actions.append(Action(prio, "Reordenar la bandeja de Tesorería por antigüedad (más viejo arriba)",
            "Los vouchers viejos se entierran bajo los nuevos y confirman tarde, "
            "perdiendo la ventana de 7 días de Meta.", "Tesorería"))
        prio += 1

    if has("Latencia de tesorería") and any("p90" in i.text and "crit" not in i.severity for i in insights):
        actions.append(Action(prio, "Medir y recortar la latencia de confirmación de vouchers a < 7 días",
            "Cada día de retraso es una venta que Meta nunca ve.", "Tesorería / Ops"))

    if has("reembolso"):
        actions.append(Action(prio, "Auditar las ventas reembolsadas y su causa raíz",
            "Una tasa de reembolso alta infla el ROAS bruto y esconde pérdida real.",
            "Calidad / Producto"))

    if has("mora") or has("Cartera"):
        actions.append(Action(prio, "Activar cobranza sobre las cuotas en mora y saldo pendiente",
            "Hay cartera de crédito viva sin seguimiento; recupera flujo y reduce riesgo.",
            "Cobranza"))

    if has("aprueba solo"):
        actions.append(Action(prio, "Revisar el medio de pago con baja aprobación o habilitar alternativos",
            "Un medio que rechaza pagos es conversión que se fugó en el último paso.", "Finanzas"))

    if a.trend == "baja":
        actions.append(Action(prio, "Revisar la pauta y el embudo de respuesta en los canales débiles",
            f"El momentum reciente cae ({a.momentum_pct:+}%). Confirmar si es estacionalidad "
            f"o efectividad de adquisición.", "Growth"))
        prio += 1

    # Siempre: optimizar por valor de cliente si hay segmentos
    seg = (k.cartera or {}).get("valor", {}) or {}
    if seg.get("segmentos"):
        actions.append(Action(prio, "Construir audiencia lookalike a partir del segmento oro (LTV $1.000+)",
            "Optimizar por cliente valioso, no por 'una venta cualquiera', mejora el ROAS.",
            "Growth / Meta"))
        prio += 1

    # Default fallback
    if not actions:
        actions.append(Action(1, "Profundizar en el segmento con mejor momentum",
            "No hay riesgos críticos visibles; aprovechar lo que está funcionando.",
            "Growth"))

    return actions
