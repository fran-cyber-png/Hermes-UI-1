"""prompt_builder — assemble the investigation prompt (Ivi v2.0).

The engine (fases 1–8) already investigated: planned, collected, cross-joined,
detected patterns, generated + validated hypotheses and quantified impact. This
module lays that investigation out for the model under clearly labeled buckets:

  -- HECHOS --            measured metrics (KPIs, serie, comparaciones, rankings)
  -- HALLAZGOS --         non-hypothesis signals from the InsightEngine
  -- HIPÓTESIS --         hypothesis-tagged signals, with confidence
  -- IMPACTO ECONÓMICO -- the precomputed impact chain (impact_engine)
  -- ACCIONES --          prioritized actions from the RecommendationEngine

The model does fases 9–10 only: present the investigation using the canonical
v2.0 sections, separating HECHOS / INTERPRETACIÓN / HIPÓTESIS / OPINIÓN. It never
consults data and never does a single calculation.
"""

from typing import List

from .intent_analyzer import IntentResult
from .kpi_engine import KPIs
from .analytics_engine import Analysis
from .insight_engine import Insight
from .recommendation_engine import Action
from .impact_engine import ImpactItem, render_impact_lines
from datetime import date

# crit first, good last — for ordering non-hypothesis findings by severity.
_SEV_ORDER = {"crit": 0, "warn": 1, "info": 2, "good": 3}


def _fmt_frescura(k: KPIs) -> str:
    if not k.frescura:
        return "(sin dato de frescura — no declares una fecha de corte que no tengas)"
    return "\n".join(f"- {v}" for v in k.frescura.values())


def _fmt_kpis(k: KPIs) -> str:
    lines = []
    if k.ventas_conocidas is not None:
        lines.append(f"- Ventas conocidas en Cerberus: {k.ventas_conocidas}")
    if k.ventas_reportadas_meta is not None:
        lines.append(f"- Ventas reportadas a Meta (CAPI): {k.ventas_reportadas_meta}")
    if k.ventas_perdidas_ventana is not None:
        lines.append(f"- Ventas perdidas por fuera de ventana Meta: {k.ventas_perdidas_ventana}")
    if k.total_ventas_cobradas is not None:
        lines.append(f"- Ventas cobradas (acumulado): {k.total_ventas_cobradas}")
    if k.total_usd_cobradas is not None:
        lines.append(f"- Ingresos cobrados (USD, serie mensual): {k.total_usd_cobradas}")
    if k.ticket_promedio_usd is not None:
        lines.append(f"- Ticket promedio (mix): USD {k.ticket_promedio_usd}")
    return "\n".join(lines)


def _weekly_from_daily(serie_diaria) -> dict:
    """Aggregate the real daily series into exact ISO weeks ("YYYY-SWW" -> ventas)."""
    from collections import defaultdict
    import re as _re
    sem = defaultdict(int)
    for d in serie_diaria:
        try:
            dt = _re.sub(r"T.*", "", d.get("dia", ""))
            y, w, _ = date.fromisoformat(dt).isocalendar()
            sem[f"{y}-S{str(w).zfill(2)}"] += d.get("ventas", 0) or 0
        except Exception:
            continue
    return sem


def _fmt_target_month(k: KPIs, intent) -> str:
    tm = getattr(intent, "target_month", "") or ""
    pt = None
    note = ""
    if not tm and getattr(intent, "relative_period", "") == "month" and k.serie_mensual:
        # "este mes" -> last month of the series (month in progress)
        pt = k.serie_mensual[-1]
        note = " — mes en curso según la serie; puede estar incompleto"
    elif tm.startswith("MM-") and k.serie_mensual:
        # month named without year -> most recent matching month in the series
        suffix = tm[2:]                                    # "MM-07" -> "-07"
        pt = next((s for s in reversed(k.serie_mensual) if s.label.endswith(suffix)), None)
        if not pt:
            return (f"- MES SOLICITADO (mes {tm[3:]}): NO está en la serie mensual disponible "
                    f"(rango: {k.serie_mensual[0].label} .. {k.serie_mensual[-1].label}). "
                    f"Responde solo con lo que hay.")
        note = " — año no indicado; se toma el más reciente de la serie"
    elif not tm or len(tm) < 7:
        return ""
    # match serie_mensual by "YYYY-MM"
    if pt is None:
        pt = next((s for s in k.serie_mensual if s.label == tm), None)
    if not pt:
        # try year-only
        ty = getattr(intent, "target_year", "")
        cands = [s for s in k.serie_mensual if s.label.startswith(ty)] if ty else []
        if len(cands) == 1:
            pt = cands[0]
        elif cands:
            return (f"- MES SOLICITADO ({tm}): hay {len(cands)} meses en {ty}; "
                    f"especifica cuál. Disponibles: " + ", ".join(s.label for s in cands))
        else:
            return (f"- MES SOLICITADO ({tm}): NO está en la serie mensual disponible "
                    f"(rango: {k.serie_mensual[0].label if k.serie_mensual else '?'} .. "
                    f"{k.serie_mensual[-1].label if k.serie_mensual else '?'}). "
                    f"Responde solo con lo que hay.")
    # previous month for comparison
    idx = k.serie_mensual.index(pt)
    prev = k.serie_mensual[idx - 1] if idx > 0 else None
    lines = [f"MES SOLICITADO ({pt.label}{note}): {pt.ventas} ventas, USD {pt.usd}"]
    if prev:
        # Scope guard (docs/14 §5 P1): si `pt` es el mes EN CURSO, comparar contra los
        # mismos días de `prev` — nunca un mes parcial contra uno completo.
        last = k.last_month()
        cutoff = k.cutoff_mes_parcial() if last and pt.label == last.label else None
        c_prev = None
        if cutoff:
            comparable = k.serie_comparable(cutoff)
            c_prev = next((s for s in comparable if s.label == prev.label), None)
        if c_prev:
            dv = pt.ventas - c_prev.ventas
            pct = (dv / c_prev.ventas * 100) if c_prev.ventas else 0
            lines.append(f"  vs mismos días de {prev.label} (mes parcial, hasta el día "
                         f"{cutoff}): {dv:+d} ventas ({pct:+.1f}%)")
        else:
            dv = pt.ventas - prev.ventas
            pct = (dv / prev.ventas * 100) if prev.ventas else 0
            lines.append(f"  vs mes previo ({prev.label}): {dv:+d} ventas ({pct:+.1f}%)")
    return "\n".join(lines)


def _fmt_serie(k: KPIs) -> str:
    lines = ["SERIE MENSUAL (ventas cobradas, últimos 12):"]
    for s in k.serie_mensual[-12:]:
        lines.append(f"  · {s.label}: {s.ventas} ventas, USD {s.usd}")
    if k.serie_diaria:
        # resumen semanal EXACTO derivado de dias reales
        sem = _weekly_from_daily(k.serie_diaria)
        lines.append("SERIE SEMANAL EXACTA (de dias reales del backend, últimas 8):")
        for wk in sorted(sem)[-8:]:
            lines.append(f"  · {wk}: {sem[wk]} ventas")
    elif k.serie_semanal:
        lines.append("SERIE SEMANAL (APROX. por distribución de días del mes — no es conteo diario real):")
        for w in k.serie_semanal[-10:]:
            lines.append(f"  · {w.label}: ~{w.ventas} ventas, ~USD {w.usd}")
    fc = k.forecast or {}
    if fc.get("proyeccion"):
        proj = fc["proyeccion"]
        lines.append(f"FORECAST (regresión lineal, pendiente {fc.get('pendiente')}/día, "
                     f"error ±{fc.get('errorTipico')}, R²={fc.get('r2')}):")
        lines.append(f"  · próximos {len(proj)} días → {sum(p.get('ventas',0) for p in proj)} ventas proyectadas")
        lines.append(f"  · muestra: {proj[0]['dia']} → {proj[-1]['dia']}")
    return "\n".join(lines)


def _fmt_target_week(k: KPIs, intent) -> str:
    if getattr(intent, "relative_period", "") != "week" or not k.serie_diaria:
        return ""
    sem = _weekly_from_daily(k.serie_diaria)
    if not sem:
        return ""
    weeks = sorted(sem)
    cur = weeks[-1]
    lines = [f"SEMANA SOLICITADA ({cur} — semana en curso según la serie diaria; "
             f"puede estar incompleta): {sem[cur]} ventas"]
    if len(weeks) > 1:
        prev = weeks[-2]
        dv = sem[cur] - sem[prev]
        pct = (dv / sem[prev] * 100) if sem[prev] else 0
        lines.append(f"  vs semana previa ({prev}): {dv:+d} ventas ({pct:+.1f}%)")
    return "\n".join(lines)


def _fmt_comparisons(a: Analysis) -> str:
    lines = []
    for c in a.comparisons:
        ap = " (aprox.)" if c.approx else ""
        line = f"- {c.label}{ap}: actual={c.current}"
        if c.previous is not None:
            line += f", previo={c.previous}"
        if c.delta_abs is not None:
            line += f", Δ={c.delta_abs:+d}"
        if c.delta_pct is not None:
            line += f" ({c.delta_pct:+}%)"
        lines.append(line)
    if a.rolling:
        lines.append("- Promedios móviles: " + ", ".join(f"{k2}={v2}" for k2, v2 in a.rolling.items()))
    if a.momentum_pct is not None:
        lines.append(f"- Momentum (reciente vs previo): {a.momentum_pct:+}% → tendencia {a.trend}")
    return "\n".join(lines)


def _fmt_rankings(a: Analysis) -> str:
    lines = []
    labels = {"productos_top": "Productos (top ventas)",
              "sedes_top": "Sedes (top ventas)",
              "paises_top": "Países (top ventas)"}
    for key, lab in labels.items():
        items = a.rankings.get(key)
        if items:
            lines.append(f"- {lab}: " + ", ".join(f"{i.name}={i.value}" for i in items))
    for pkey, lab in [("por_pais", "Participación por país"),
                       ("por_producto", "Participación por producto"),
                       ("por_canal_accionable", "Participación por canal (accionable)")]:
        parts = a.participations.get(pkey)
        if parts:
            lines.append(f"- {lab}: " + ", ".join(f"{p['name']}={p['share_pct']}%" for p in parts))
    # ROAS por país (atribución)
    roas = a.participations.get("roas_por_pais")
    if roas:
        lines.append("- ROAS por país: " + ", ".join(
            f"{r['name']}=ROAS {r['roas']} (gasto USD {r['gastoUsd']}, {r['accion']})"
            for r in roas if r.get("roas") is not None))
    return "\n".join(lines)


def _fmt_hallazgos(insights: List[Insight]) -> str:
    """Non-hypothesis signals, ordered by severity → feed Hallazgos/Riesgos/Oport."""
    hallazgos = sorted((i for i in insights if not i.hypothesis),
                       key=lambda i: (_SEV_ORDER.get(i.severity, 9)))
    if not hallazgos:
        return "(sin hallazgos automáticos)"
    return "\n".join(f"{i.icon} [{i.severity}] {i.text} (confianza: {i.confidence})"
                     for i in hallazgos)


def _fmt_hipotesis(insights: List[Insight]) -> str:
    """Only hypothesis-tagged signals, grouped implicitly by confidence."""
    hip = [i for i in insights if i.hypothesis]
    if not hip:
        return "(el motor no generó hipótesis para este análisis)"
    order = {"alta": 0, "media": 1, "baja": 2}
    hip.sort(key=lambda i: order.get(i.confidence, 9))
    return "\n".join(f"{i.icon} {i.text} (confianza: {i.confidence})" for i in hip)


def _fmt_impacto(impact: List[ImpactItem]) -> str:
    lines = render_impact_lines(impact)
    return "\n".join(lines) if lines else "(sin cifras de impacto derivables con la evidencia actual)"


def _fmt_actions(actions: List[Action]) -> str:
    return "\n".join(f"{a.priority}. {a.action} — [{a.owner}] {a.rationale}" for a in actions)


def build(intent: IntentResult, k: KPIs, a: Analysis, insights: List[Insight],
          actions: List[Action], related: List[str], impact: List[ImpactItem],
          scope_note: str = "") -> str:
    prompt = (
        "Eres Ivi, Director de BI de Goberna (Cerberus). Hablas español peruano neutro y "
        "escribes como un investigador de negocio: directo, con números, causal.\n\n"
        "La INVESTIGACIÓN YA ESTÁ HECHA por el motor (planeó, recolectó, cruzó tablas, "
        "detectó patrones, generó y validó hipótesis y cuantificó el impacto económico). "
        "Viene abajo bajo secciones marcadas. Tu trabajo NO es investigar de nuevo: es "
        "PRESENTAR esa investigación — explicar qué pasa, por qué, qué significa y qué hacer. "
        "NO consultas datos ni haces una sola cuenta.\n\n"
        "REGLAS DE RAZONAMIENTO (cúmplelas siempre):\n"
        "1. Separa HECHOS / INTERPRETACIÓN / HIPÓTESIS / OPINIÓN. Nunca presentes una "
        "hipótesis como un hecho.\n"
        "2. Cuantifica SOLO con los números de abajo. Nunca inventes ni recalcules una cifra "
        "(revenue, USD, ROAS, CAC, forecast ya vienen calculados en -- IMPACTO ECONÓMICO --).\n"
        "3. Si falta evidencia para concluir algo, dilo: \"no existe evidencia suficiente para "
        "concluir X\". No rellenes huecos.\n"
        "4. No digas \"no tengo datos\" si la sección correspondiente TRAE información.\n"
        "5. Abre el Resumen Ejecutivo con la fecha de corte de los datos (sección -- FRESCURA "
        "--). Nunca narres en presente algo que ya tiene días de rezago sin decirlo.\n\n"
        "=== INVESTIGACIÓN DEL MOTOR (no recalcular) ===\n"
        f"INTENCIÓN DETECTADA: {intent.dominant()} (scores: {intent.scores})\n"
        f"PERÍODO SOLICITADO: {intent.primary_period}\n"
        f"\n-- FRESCURA (declarar SIEMPRE al abrir el Resumen) --\n{_fmt_frescura(k)}\n"
    )
    if scope_note:
        prompt += f"CONTEXTO PREVIO (follow-up): {scope_note}\n"
    target_week = _fmt_target_week(k, intent)
    prompt += (
        f"\n-- HECHOS (métricas medidas, no recalcular) --\n"
        f"{_fmt_kpis(k)}\n"
        f"\n[Mes solicitado]\n{_fmt_target_month(k, intent)}\n"
        + (f"\n[Semana solicitada]\n{target_week}\n" if target_week else "")
        + f"\n[Serie]\n{_fmt_serie(k)}\n"
        f"\n[Comparaciones y tendencia]\n{_fmt_comparisons(a)}\n"
        f"\n[Rankings y participaciones]\n{_fmt_rankings(a)}\n"
        f"\n-- HALLAZGOS (señales del motor, no-hipótesis; por severidad) --\n"
        f"{_fmt_hallazgos(insights)}\n"
        f"\n-- HIPÓTESIS (del motor, etiquetadas con confianza) --\n"
        f"{_fmt_hipotesis(insights)}\n"
        f"\n-- IMPACTO ECONÓMICO (precalculado, no recalcular) --\n"
        f"{_fmt_impacto(impact)}\n"
        f"\n-- ACCIONES SUGERIDAS POR EL MOTOR (prioridad, acción, responsable) --\n"
        f"{_fmt_actions(actions)}\n"
    )
    prompt += (
        "\n=== FORMATO DE SALIDA ===\n"
        "Responde usando EXACTAMENTE estas secciones, en este orden (omite una solo si de "
        "verdad no aplica; nunca inventes contenido para llenarla):\n"
        "## Resumen Ejecutivo\n(≤5 líneas; qué está pasando, lo más importante primero)\n"
        "## Hallazgos Clave\n(ordenados por impacto, no por categoría; de -- HALLAZGOS --)\n"
        "## Evidencia\n(las métricas medidas que sostienen los hallazgos; de -- HECHOS --)\n"
        "## Causas Probables\n(las HIPÓTESIS, agrupadas por confianza; marca que son hipótesis)\n"
        "## Impacto Económico\n(copia el bloque -- IMPACTO ECONÓMICO -- respetando HECHO/ESTIMACIÓN; "
        "no agregues cifras que no estén ahí)\n"
        "## Riesgos\n(con prioridad)\n"
        "## Oportunidades\n(con impacto esperado, cualitativo)\n"
        "## Acciones Priorizadas\n"
        "(tabla markdown con columnas: Prioridad | Acción | Responsable | Impacto esperado | Tiempo. "
        "Prioridad/Acción/Responsable salen de -- ACCIONES --; 'Impacto esperado' y 'Tiempo' los "
        "redactas TÚ, cualitativos, desde el rationale — nunca cifras inventadas)\n"
        "## Próximas Investigaciones\n"
        "(las preguntas que más reducen incertidumbre)\n"
        + "\n".join(f"- {q}" for q in related) + "\n\n"
        f"PREGUNTA DEL USUARIO: {intent.raw}\n"
    )
    return prompt
