"""ImpactEngine — the honest FASE 7 (economic impact).

Precomputes the impact chain the SYSTEM v2.0 asks for, but ONLY with what is
derivable from `KPIs` without inventing anything. Every item is labeled:

  - HECHO         → measured (came straight from a metric)
  - ESTIMACIÓN    → derived under an explicit assumption (`supuesto`)
  - SIN_EVIDENCIA → we deliberately do NOT compute it, and say why

The model never recomputes this: it presents these numbers verbatim. Keeping the
whole chain here is what stops an 8B model from hallucinating a
"184 ventas → USD → ROAS → CAC → forecast" cascade.

Every number is rounded (never a raw float).
"""

from dataclasses import dataclass
from typing import List, Optional

from .kpi_engine import KPIs, roas_material

# kinds
HECHO = "HECHO"
ESTIMACION = "ESTIMACIÓN"
SIN_EVIDENCIA = "SIN_EVIDENCIA"


@dataclass
class ImpactItem:
    label: str                      # what it measures
    kind: str                       # HECHO | ESTIMACIÓN | SIN_EVIDENCIA
    value: Optional[float] = None   # rounded number (None when s/d or omitted)
    unit: str = ""                  # "USD" | "ventas" | "ROAS" | ""
    signed: bool = False            # render deltas with an explicit +/- sign
    supuesto: Optional[str] = None  # assumption behind an ESTIMACIÓN
    confianza: str = "alta"         # alta | media | baja
    nota: Optional[str] = None      # caveat (HECHO) or reason (SIN_EVIDENCIA)


def _r(x) -> Optional[int]:
    """Round money/ventas to a clean int; None passes through."""
    return None if x is None else int(round(x))


def compute_impact(k: KPIs) -> List[ImpactItem]:
    items: List[ImpactItem] = []

    # ── Δ revenue / Δ ventas: último mes vs previo (HECHO) ──
    # Scope guard (docs/14 §5 P1): si el último mes está EN CURSO, comparar 1..cutoff
    # vs 1..cutoff (mismas ventanas) en vez de mes parcial contra mes completo.
    cutoff = k.cutoff_mes_parcial()
    comparable = k.serie_comparable(cutoff) if cutoff else []
    if cutoff and len(comparable) >= 2:
        last, prev = comparable[-1], comparable[-2]
        nota_ventana = f" — mes parcial, mismos días 1..{cutoff}"
    else:
        last, prev = k.last_month(), k.prev_month()
        nota_ventana = ""
    if last and prev:
        items.append(ImpactItem(
            label=f"Δ ingresos {prev.label}→{last.label}",
            kind=HECHO, value=_r(last.usd - prev.usd), unit="USD", signed=True,
            nota=f"{prev.label}: USD {_r(prev.usd)} → {last.label}: USD {_r(last.usd)}{nota_ventana}",
        ))
        items.append(ImpactItem(
            label=f"Δ ventas {prev.label}→{last.label}",
            kind=HECHO, value=_r(last.ventas - prev.ventas), unit="ventas", signed=True,
            nota=f"{prev.label}: {prev.ventas} → {last.label}: {last.ventas}{nota_ventana}",
        ))

    # ── Revenue en riesgo por ventana Meta (ESTIMACIÓN) ──
    perd = k.ventas_perdidas_ventana
    ticket = k.ticket_promedio_usd
    if perd and ticket:
        items.append(ImpactItem(
            label="Revenue en riesgo por ventana de Meta",
            kind=ESTIMACION, value=_r(perd * ticket), unit="USD",
            supuesto=f"ticket promedio del mix (USD {ticket})",
            confianza="media",
            nota=f"{perd} ventas fuera de la ventana × ticket promedio",
        ))
        # honestidad: NO estimamos cuántos clientes distintos son.
        items.append(ImpactItem(
            label="Clientes afectados por la ventana de Meta",
            kind=SIN_EVIDENCIA, confianza="alta",
            nota="no hay conteo de clientes distintos limpio en los datos",
        ))

    # ── ROAS / CAC snapshot por país (HECHO) ──
    # Solo países con señal (roas_material): sin el filtro, USD 33 en Honduras
    # (ROAS 65) y USD 18 en PT (ROAS 0) eran el titular mientras Perú/México
    # (miles de USD, confianza alta del backend) no se contaban.
    con_gasto = [r for r in (k.roas_por_pais or [])
                 if (r.get("gastoUsd") or 0) > 0 and r.get("roas") is not None]
    material = [r for r in con_gasto if roas_material(r)]
    colas = [r for r in con_gasto if not roas_material(r)]
    if material:
        # "Mejor país" con criterio de DECISIÓN, no ratio puro: un ROAS altísimo
        # con 26 ventas y confianza media (EEUU) no es donde escalar. Coronamos el
        # mejor de ALTA confianza (volumen real, "escalar"); el ratio alto de base
        # chica se muestra APARTE como test, no como el titular.
        alta = [r for r in material if r.get("confianza") == "alta"]
        escalables = alta or material
        best = max(escalables, key=lambda r: r.get("roas") or 0)
        items.append(ImpactItem(
            label=f"Mejor país para escalar ({best.get('pais', '?')})",
            kind=HECHO, value=round(best.get("roas"), 2), unit="ROAS",
            nota=f"gasto USD {_r(best.get('gastoUsd'))}, {best.get('ventas', '?')} ventas, "
                 f"confianza {best.get('confianza', '?')} — donde cada dólar nuevo rinde con volumen",
        ))
        # Ratio alto pero base chica: el máximo de TODO lo material, si supera al
        # best y no es el mismo. Es un test dedicado, NO el país donde escalar.
        ratio = max(material, key=lambda r: r.get("roas") or 0)
        if ratio.get("pais") != best.get("pais") and (ratio.get("roas") or 0) > (best.get("roas") or 0):
            items.append(ImpactItem(
                label=f"Mejor ratio pero base chica ({ratio.get('pais', '?')})",
                kind=HECHO, value=round(ratio.get("roas"), 2), unit="ROAS",
                nota=f"solo {ratio.get('ventas', '?')} ventas (gasto USD {_r(ratio.get('gastoUsd'))}), "
                     f"confianza {ratio.get('confianza', '?')} — vale un test dedicado, no mover el grueso ahí",
            ))
        if len(material) >= 2:
            worst = min(material, key=lambda r: r.get("roas") or 0)
            cac = worst.get("cacVenta")
            items.append(ImpactItem(
                label=f"Peor país ({worst.get('pais', '?')})",
                kind=HECHO, value=round(worst.get("roas"), 2), unit="ROAS",
                nota=(f"gasto USD {_r(worst.get('gastoUsd'))}; "
                      f"CAC venta: {'USD ' + str(_r(cac)) if cac is not None else 's/d'}"),
            ))
        # honestidad: tenemos un snapshot, NO una serie temporal de ROAS/CAC.
        items.append(ImpactItem(
            label="Tendencia temporal de ROAS/CAC",
            kind=SIN_EVIDENCIA, confianza="alta",
            nota="no hay serie histórica de gasto por período para derivar tendencia",
        ))
    if colas:
        # Los ratios de gasto chico se agregan en UNA línea desestimada, para
        # que el modelo pueda contestar "¿y Honduras?" sin volverlo titular.
        top = sorted(colas, key=lambda r: r.get("roas") or 0, reverse=True)[:2]
        detalle = "; ".join(
            f"{r.get('pais', '?')} {round(r.get('roas') or 0, 2)}× con USD {_r(r.get('gastoUsd'))}"
            for r in top)
        items.append(ImpactItem(
            label=f"ROAS de {len(colas)} países con gasto de prueba",
            kind=SIN_EVIDENCIA, confianza="alta",
            nota=f"gasto sin materialidad, ratios no accionables — p.ej. {detalle}",
        ))

    # ── Impacto forecast próximos días (HECHO honesto) ──
    # Forecast honesto (docs/14 §5 P4): con R² < 0.3 no hay señal de tendencia — se
    # reporta el ritmo diario medido (± error), nunca un total "proyectado" que
    # aparenta precisión que la regresión no tiene.
    fc = k.forecast or {}
    proj = fc.get("proyeccion") or []
    if proj:
        r2 = fc.get("r2")
        low_r2 = r2 is not None and r2 < 0.3
        if low_r2:
            ritmo = round(sum(p.get("ventas", 0) or 0 for p in proj) / len(proj), 1)
            err = fc.get("errorTipico")
            nota = f"R²={r2}: sin tendencia estadística, no se proyecta un total"
            if err is not None:
                nota += f"; error típico ±{err}"
            items.append(ImpactItem(
                label="Ritmo diario reciente (no forecast, R² bajo)",
                kind=HECHO, value=_r(ritmo), unit="ventas",
                confianza="alta", nota=nota,
            ))
        else:
            total = _r(sum(p.get("ventas", 0) or 0 for p in proj))
            items.append(ImpactItem(
                label=f"Ventas proyectadas próximos {len(proj)} días",
                kind=HECHO, value=total, unit="ventas",
                confianza="media", nota=f"regresión lineal, R²={r2}",
            ))

    return items


def _fmt_value(it: ImpactItem) -> str:
    if it.value is None:
        return "s/d"
    if it.unit == "USD":
        n = f"{it.value:+d}" if it.signed else f"{it.value:d}"
        return f"USD {n}"
    if it.unit == "ventas":
        n = f"{it.value:+d}" if it.signed else f"{it.value:d}"
        return f"{n} ventas"
    if it.unit == "ROAS":
        return f"{it.value:.2f}"
    return str(it.value)


def render_impact_lines(items: List[ImpactItem]) -> List[str]:
    """One tagged line per item — shared by prompt_builder and response_formatter
    so the impact text has a single source of truth."""
    lines: List[str] = []
    for it in items:
        if it.kind == SIN_EVIDENCIA:
            lines.append(f"[SIN EVIDENCIA] {it.label}: no existe evidencia suficiente "
                         f"({it.nota}).")
            continue
        tag = it.kind if it.kind == HECHO else f"{ESTIMACION}: {it.supuesto}"
        line = f"[{tag}] {it.label}: {_fmt_value(it)}"
        if it.nota:
            line += f" ({it.nota})"
        lines.append(line)
    return lines
