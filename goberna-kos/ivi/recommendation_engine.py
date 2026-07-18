"""RecommendationEngine — prioritized, actionable next steps.

Maps detected Insights + KPIs to concrete actions, ordered by impact.
Each action has: priority, action (verb phrase), rationale (links to data),
and owner hint (which team should act).
"""

from dataclasses import dataclass, field
from typing import List

from .kpi_engine import KPIs, roas_material
from .analytics_engine import Analysis
from .insight_engine import Insight
from .criterios import presupuesto_txt


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
    # docs/14 §4 "Acciones recicladas": `has()` por substring no distinguía severidad —
    # recomendaba arreglar Tesorería aunque insight_engine ya reportara su latencia SANA
    # (p90 controlado ⇒ severity "good"/"info", nunca "crit"/"warn"). Gatear por
    # severidad real evita recomendar lo que ya no hace falta.
    has_crit = lambda key: any(i.text and key in i.text and i.severity == "crit" for i in insights)
    has_warn = lambda key: any(i.text and key in i.text and i.severity == "warn" for i in insights)

    if has("MODO PRUEBA") or has("nunca se ha corrido"):
        actions.append(Action(prio, "Pasar el envío CAPI de Meta a MODO PRODUCCIÓN",
            "Hoy los eventos de venta no optimizan la pauta; Meta aprende de ruido.",
            "Growth / DevOps"))
        prio += 1

    if has_crit("fuera de la ventana"):
        actions.append(Action(prio, "Reordenar la bandeja de Tesorería por antigüedad (más viejo arriba)",
            "Los vouchers viejos se entierran bajo los nuevos y confirman tarde, "
            "perdiendo la ventana de 7 días de Meta.", "Tesorería"))
        prio += 1

    if has_warn("Latencia de tesorería") and has_warn("p90"):
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

    # País: jugada CONCRETA de reasignación de pauta (no la genérica de abajo)
    # cuando hay ROAS por país con señal. Usa el `accion` que ya clasifica el
    # backend (escalar/observar/recortar) y la confianza, no un ratio suelto: un
    # ratio altísimo de base chica (EEUU) va a "test chico", no a "subí acá".
    roas_pais = [r for r in (k.roas_por_pais or [])
                 if (r.get("gastoUsd") or 0) > 0 and r.get("roas") is not None and roas_material(r)]
    if roas_pais:
        escalar = sorted((r for r in roas_pais
                          if r.get("accion") == "escalar" and r.get("confianza") == "alta"),
                         key=lambda r: r.get("roas") or 0, reverse=True)[:2]
        ratio = max(roas_pais, key=lambda r: r.get("roas") or 0)
        partes = []
        if escalar:
            partes.append("subí presupuesto en " + " y ".join(
                f"{r['pais']} (ROAS {round(r['roas'], 1)}×)" for r in escalar))
        if ratio.get("confianza") != "alta" and ratio.get("pais") not in [r["pais"] for r in escalar]:
            partes.append(f"corré un test chico en {ratio['pais']} "
                          f"(ratio {round(ratio['roas'], 1)}× pero base chica)")
        if partes:
            actions.append(Action(prio,
                f"Con tu presupuesto de {presupuesto_txt()}/mes, reasignar pauta por país — "
                + "; ".join(partes),
                "El backend ya clasifica cada país (escalar/observar/recortar) con su "
                "confianza; mover el presupuesto a los de 'escalar' con volumen (confianza "
                "alta) es la palanca más directa para crecer sin bajar el ROAS.", "Growth / Meta"))
            prio += 1

    # Default fallback
    if not actions:
        actions.append(Action(1, "Profundizar en el segmento con mejor momentum",
            "No hay riesgos críticos visibles; aprovechar lo que está funcionando.",
            "Growth"))

    return actions
