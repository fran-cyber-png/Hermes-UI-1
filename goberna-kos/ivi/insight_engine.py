"""InsightEngine — turn metrics + analysis into business-relevant signals.

Detects, WITHOUT being asked:
  - falling segments (products/sedes losing share or volume)
  - strong channels / growing products
  - broken funnels (high refund / anuladas rate)
  - treasury latency risk (p90 > 7d, fuera_de_ventana)
  - Meta attribution gap (ventas perdidas por ventana, lazo en prueba)
  - cobranza risk (mora / saldo)
  - anomalies already flagged by AnalyticsEngine

Outputs a list of Insight objects with severity, marker, and a
confidence level. Hypotheses are explicitly tagged when causal data
is missing.
"""

from dataclasses import dataclass, field
from typing import List, Optional

from .kpi_engine import KPIs
from .analytics_engine import Analysis, Anomaly


@dataclass
class Insight:
    severity: str      # "crit" | "warn" | "info" | "good"
    icon: str
    text: str
    confidence: str = "alta"   # alta | media | baja
    hypothesis: bool = False


def detect(k: KPIs, a: Analysis) -> List[Insight]:
    out: List[Insight] = []

    # 1) Attribution gap with Meta (lazo)
    if k.ventas_perdidas_ventana:
        perd = k.ventas_perdidas_ventana
        conn = k.ventas_conocidas or 0
        if conn > 0 and perd / conn > 0.02:
            out.append(Insight("crit", "⚠",
                f"{perd} ventas se pierden fuera de la ventana de Meta (CAPI): "
                f"Tesorería confirma el voucher después de los 7 días que Meta acepta. "
                f"Eso mata la señal de conversión y encarece el CAC.",
                confidence="alta"))
    if k.lazo.get("modo") == "prueba":
        out.append(Insight("crit", "⚠",
            "El lazo con Meta está en MODO PRUEBA: los eventos no están optimizando la pauta. "
            "Cambiar a producción.", confidence="alta"))
    if k.lazo.get("modo") == "sin_correr":
        out.append(Insight("crit", "⚠",
            "El envío a Meta (CAPI) nunca se ha corrido. Meta no recibe ninguna conversión.",
            confidence="alta"))

    # 2) Treasury latency
    lat = k.latencia or {}
    if lat.get("p90") is not None and lat["p90"] > 7:
        out.append(Insight("warn", "⚠",
            f"Latencia de tesorería p90 = {lat['p90']} días (ventana de Meta = 7). "
            f"{lat.get('fueraDeVentana')} pagos ya cayeron fuera de ventana; "
            f"{lat.get('sinConfirmar')} sin confirmar. Hipótesis: la bandeja ordena por fecha "
            f"reciente y entierra los vouchers viejos.",
            confidence="media", hypothesis=True))
    elif lat.get("p90") is not None:
        out.append(Insight("good", "📈",
            f"Latencia de tesorería controlada: p90 = {lat['p90']} días (dentro de ventana).",
            confidence="alta"))

    # 3) Funnel health (embudo)
    emb = k.embudo or {}
    if emb.get("tasaReembolso") is not None and emb["tasaReembolso"] > 5:
        out.append(Insight("warn", "⚠",
            f"Tasa de reembolso {emb['tasaReembolso']}%: el ROAS bruto sobreestima la "
            f"rentabilidad real. Revisar calidad del producto/experiencia.",
            confidence="media"))
    if emb.get("total"):
        anul = emb.get("anuladas", 0)
        if anul / emb["total"] > 0.1:
            out.append(Insight("warn", "⚠",
                f"Anuladas representan {round(anul/emb['total']*100)}% del total de ventas. "
                f"Hipótesis: fricción en el pago o validación débil.",
                confidence="media", hypothesis=True))

    # 4) Cobranza / cartera
    cob = (k.cartera or {}).get("cobranza", {}) or {}
    if cob.get("enMora"):
        out.append(Insight("warn", "⚠",
            f"Cartera: {cob.get('enMora')} cuotas en mora, saldo USD {cob.get('saldoUsd')} pendiente. "
            f"Hay cobranza viva que nadie medía.",
            confidence="alta"))
    medios = (k.cartera or {}).get("medios", []) or []
    for m in medios:
        if m.get("aprobacion") is not None and m["aprobacion"] < 85:
            out.append(Insight("warn", "⚠",
                f"Medio de pago '{m.get('medio')}' aprueba solo {m['aprobacion']}%: "
                f"fuga de conversión en el último metro.",
                confidence="alta"))

    # 5) Channel strength (accionable interactions)
    pc = a.participations.get("por_canal_accionable", [])
    if len(pc) >= 2:
        pc_sorted = sorted(pc, key=lambda x: x["share_pct"], reverse=True)
        strong, weak = pc_sorted[0], pc_sorted[-1]
        out.append(Insight("info", "📈" if strong["share_pct"] >= 50 else "ℹ",
            f"Canal más activo en interacciones accionables: {strong['name']} "
            f"({strong['share_pct']}%). Canal más débil: {weak['name']} ({weak['share_pct']}%).",
            confidence="alta"))

    # 6) Product momentum
    prod = a.rankings.get("productos_top", [])
    if prod:
        top = prod[0]
        out.append(Insight("info", "📈",
            f"Producto más vendido: {top.name} ({top.value} ventas).",
            confidence="alta"))

    # 7) Pass-through anomalies from AnalyticsEngine
    for an in a.anomalies:
        out.append(Insight(an.severity, an.icon, an.text, confidence="media"))

    # 8) Trend summary
    if a.trend == "baja":
        out.append(Insight("warn", "⚠",
            f"Momentum comercial a la baja ({a.momentum_pct:+}% reciente vs previo). "
            f"Hipótesis: estacionalidad o caída de efectividad de la pauta.",
            confidence="media", hypothesis=True))
    elif a.trend == "sube":
        out.append(Insight("good", "📈",
            f"Momentum comercial al alza ({a.momentum_pct:+}% reciente vs previo).",
            confidence="media"))

    # Forecast
    fc = k.forecast or {}
    if fc.get("proyeccion"):
        pend = fc.get("pendiente") or 0
        r2 = fc.get("r2") or 0
        if pend < 0:
            out.append(Insight("warn", "⚠",
                f"Forecast a la baja: pendiente {pend}/día (R²={r2}). "
                f"Hipótesis: la tendencia reciente es negativa; proyectar requiere acción de pauta.",
                confidence="baja" if r2 < 0.3 else "media", hypothesis=True))
        elif pend > 0:
            out.append(Insight("good", "📈",
                f"Forecast al alza: pendiente +{pend}/día (R²={r2}).",
                confidence="baja" if r2 < 0.3 else "media"))
        if r2 < 0.3:
            out.append(Insight("info", "ℹ",
                f"El forecast tiene R²={r2} (ruido alto): trátalo como orden de magnitud, no cifra. "
                f"La serie es estacional y la regresión lineal la subestima.",
                confidence="alta"))

    # ROAS débil
    if k.roas_por_pais:
        con_gasto = [r for r in k.roas_por_pais if (r.get("gastoUsd") or 0) > 0]
        debiles = [r for r in con_gasto if (r.get("roas") or 0) < 1]
        if debiles:
            out.append(Insight("warn", "⚠",
                f"{len(debiles)} país(es) con ROAS < 1 (pierden plata en pauta): "
                f"{', '.join(r.get('pais') for r in debiles[:3])}. "
                f"Hipótesis: audiencia o creativo mal direccionado.",
                confidence="media", hypothesis=True))

    return out
