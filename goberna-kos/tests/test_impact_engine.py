"""Unit test for ivi/impact_engine.py — the honest FASE 7.

Pure Python, no Ollama, no network. Runs two ways:
    python3 tests/test_impact_engine.py      (standalone, prints PASS/FAIL)
    pytest tests/test_impact_engine.py        (each test_* picked up)
"""

import os
import sys

# make `ivi` importable when run standalone from anywhere
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from ivi.kpi_engine import KPIs, SeriePoint
from ivi.impact_engine import (
    compute_impact, render_impact_lines,
    HECHO, ESTIMACION, SIN_EVIDENCIA,
)


def _kpis_full() -> KPIs:
    """A KPIs bundle that exercises every branch of compute_impact."""
    k = KPIs()
    # jun → jul: revenue -18.414, ventas -116 (jul is the last/current month)
    k.serie_mensual = [
        SeriePoint(label="2026-06", ventas=300, usd=38403),
        SeriePoint(label="2026-07", ventas=184, usd=19989),
    ]
    k.ventas_perdidas_ventana = 184
    k.ticket_promedio_usd = 100.0
    k.roas_por_pais = [
        {"pais": "Perú", "roas": 2.3419, "gastoUsd": 1000, "cacVenta": 12.5},
        {"pais": "Chile", "roas": 0.4, "gastoUsd": 500, "cacVenta": None},
    ]
    k.forecast = {"proyeccion": [{"dia": "2026-08-01", "ventas": 5},
                                 {"dia": "2026-08-02", "ventas": 6}], "r2": 0.21}
    return k


def _by_label(items, needle):
    return next((it for it in items if needle in it.label), None)


def test_delta_revenue_is_fact_and_matches_series():
    items = compute_impact(_kpis_full())
    dr = _by_label(items, "Δ ingresos")
    assert dr is not None
    assert dr.kind == HECHO
    assert dr.unit == "USD"
    assert dr.value == -18414          # 19989 - 38403, exact from the series
    assert isinstance(dr.value, int)   # never a raw float
    assert dr.signed is True


def test_delta_ventas_is_fact():
    items = compute_impact(_kpis_full())
    dv = _by_label(items, "Δ ventas")
    assert dv is not None and dv.kind == HECHO and dv.value == -116


def test_revenue_at_risk_is_estimation_with_assumption():
    items = compute_impact(_kpis_full())
    rar = _by_label(items, "Revenue en riesgo")
    assert rar is not None
    assert rar.kind == ESTIMACION
    assert rar.value == 18400          # 184 * 100
    assert rar.supuesto and "ticket" in rar.supuesto.lower()


def test_clientes_afectados_is_omitted_with_note():
    items = compute_impact(_kpis_full())
    omit = _by_label(items, "Clientes afectados")
    assert omit is not None and omit.kind == SIN_EVIDENCIA and omit.value is None


def test_roas_best_and_worst_snapshot():
    items = compute_impact(_kpis_full())
    best = _by_label(items, "mejor país")
    worst = _by_label(items, "peor país")
    assert best is not None and best.kind == HECHO
    assert best.value == 2.34          # round(2.3419, 2), not a raw float
    assert "Perú" in best.label
    assert worst is not None and worst.value == 0.4
    assert "s/d" in (worst.nota or "")  # cacVenta None → s/d, never "None"


def test_roas_cac_trend_omitted():
    items = compute_impact(_kpis_full())
    trend = _by_label(items, "Tendencia temporal")
    assert trend is not None and trend.kind == SIN_EVIDENCIA


def test_forecast_low_r2_reports_ritmo_not_projection():
    """P4 (docs/14 §5): R² < 0.3 ⇒ no hay total 'proyectado' (falsa precisión);
    se reporta el ritmo diario medido, ± error, marcado explícitamente 'no forecast'."""
    items = compute_impact(_kpis_full())
    assert _by_label(items, "proyectadas") is None
    fc = _by_label(items, "Ritmo diario")
    assert fc is not None and fc.kind == HECHO
    assert fc.value == 6               # round((5+6)/2, 1) = 5.5 -> _r() = 6
    assert fc.confianza == "alta"
    assert "sin tendencia estadística" in (fc.nota or "")


def test_forecast_high_r2_still_projects_total():
    k = _kpis_full()
    k.forecast["r2"] = 0.55
    items = compute_impact(k)
    fc = _by_label(items, "proyectadas")
    assert fc is not None and fc.kind == HECHO
    assert fc.value == 11              # 5 + 6
    assert fc.confianza == "media"
    assert _by_label(items, "Ritmo diario") is None


def test_render_lines_are_tagged():
    lines = render_impact_lines(compute_impact(_kpis_full()))
    assert any(l.startswith("[HECHO]") and "USD -18414" in l for l in lines)
    assert any(l.startswith("[ESTIMACIÓN:") for l in lines)
    assert any(l.startswith("[SIN EVIDENCIA]") for l in lines)
    # no stray Python None leaked into the rendered text
    assert not any("None" in l for l in lines)


def test_empty_kpis_yields_nothing():
    assert compute_impact(KPIs()) == []
    assert render_impact_lines([]) == []


def test_no_raw_floats_in_money_or_ventas():
    for it in compute_impact(_kpis_full()):
        if it.unit in ("USD", "ventas") and it.value is not None:
            assert isinstance(it.value, int), f"{it.label} leaked a float: {it.value!r}"


if __name__ == "__main__":
    tests = [v for name, v in sorted(globals().items())
             if name.startswith("test_") and callable(v)]
    failed = 0
    for t in tests:
        try:
            t()
            print(f"  PASS  {t.__name__}")
        except AssertionError as e:
            failed += 1
            print(f"  FAIL  {t.__name__}: {e}")
    print(f"\n{len(tests) - failed}/{len(tests)} passed")
    sys.exit(1 if failed else 0)
