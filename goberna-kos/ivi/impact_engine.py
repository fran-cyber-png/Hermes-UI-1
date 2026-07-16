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

from .kpi_engine import KPIs

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
    last = k.last_month()
    prev = k.prev_month()
    if last and prev:
        items.append(ImpactItem(
            label=f"Δ ingresos {prev.label}→{last.label}",
            kind=HECHO, value=_r(last.usd - prev.usd), unit="USD", signed=True,
            nota=f"{prev.label}: USD {_r(prev.usd)} → {last.label}: USD {_r(last.usd)}",
        ))
        items.append(ImpactItem(
            label=f"Δ ventas {prev.label}→{last.label}",
            kind=HECHO, value=_r(last.ventas - prev.ventas), unit="ventas", signed=True,
            nota=f"{prev.label}: {prev.ventas} → {last.label}: {last.ventas}",
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
    con_gasto = [r for r in (k.roas_por_pais or [])
                 if (r.get("gastoUsd") or 0) > 0 and r.get("roas") is not None]
    if con_gasto:
        best = max(con_gasto, key=lambda r: r.get("roas") or 0)
        items.append(ImpactItem(
            label=f"ROAS mejor país ({best.get('pais', '?')})",
            kind=HECHO, value=round(best.get("roas"), 2), unit="ROAS",
            nota=f"gasto USD {_r(best.get('gastoUsd'))}",
        ))
        if len(con_gasto) >= 2:
            worst = min(con_gasto, key=lambda r: r.get("roas") or 0)
            cac = worst.get("cacVenta")
            items.append(ImpactItem(
                label=f"ROAS peor país ({worst.get('pais', '?')})",
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

    # ── Impacto forecast próximos días (HECHO + caveat) ──
    fc = k.forecast or {}
    proj = fc.get("proyeccion") or []
    if proj:
        r2 = fc.get("r2")
        total = _r(sum(p.get("ventas", 0) or 0 for p in proj))
        low_r2 = r2 is not None and r2 < 0.3
        items.append(ImpactItem(
            label=f"Ventas proyectadas próximos {len(proj)} días",
            kind=HECHO, value=total, unit="ventas",
            confianza="baja" if low_r2 else "media",
            nota=(f"R²={r2}: orden de magnitud, no cifra exacta" if low_r2
                  else f"regresión lineal, R²={r2}"),
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
