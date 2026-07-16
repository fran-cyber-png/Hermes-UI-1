"""Golden harness — P4: forecast honesto (docs/14 §4/§5).

Caso real: forecast con R²=0.002 (ruido puro) se presentó como "390 ventas próximos 30
días" — precisión fabricada. Lo honesto: "ritmo estable ~13/día (±6,5), sin tendencia
estadística". Golden bullet (docs/15): "r² < 0.3 ⇒ forecast suprimido (se reporta ritmo
± error, no proyección)".
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from ivi.kpi_engine import KPIs
from ivi.analytics_engine import Analysis, analyze
from ivi.insight_engine import detect
from ivi.impact_engine import compute_impact, HECHO


def _kpis(r2, pendiente=0.01, error=6.5, dias=30, ventas_dia=13):
    k = KPIs()
    k.forecast = {
        "diasUsados": 85, "pendiente": pendiente, "intercepto": 11.84,
        "proyeccion": [{"dia": f"2026-07-{12+i:02d}" if i < 20 else f"2026-08-{i-19:02d}",
                         "ventas": ventas_dia} for i in range(dias)],
        "errorTipico": error, "r2": r2,
    }
    return k


def test_r2_bajo_no_produce_insight_direccional():
    insights = detect(_kpis(r2=0.002), Analysis())
    direccional = [i for i in insights if "Forecast a la baja" in i.text or "Forecast al alza" in i.text]
    assert direccional == [], "con R² bajo no debe afirmarse una dirección (a la baja/al alza)"


def test_r2_bajo_reporta_ritmo_con_error():
    insights = detect(_kpis(r2=0.002), Analysis())
    ritmo = [i for i in insights if "ritmo" in i.text.lower()]
    assert ritmo, "esperaba un insight de ritmo estable ~X/día ± error"
    assert "13" in ritmo[0].text
    assert "6.5" in ritmo[0].text or "6,5" in ritmo[0].text


def test_r2_alto_si_permite_direccion():
    insights = detect(_kpis(r2=0.55, pendiente=2.0), Analysis())
    direccional = [i for i in insights if "Forecast al alza" in i.text]
    assert direccional, "con R² suficiente sí se puede afirmar dirección"


def test_impacto_no_proyecta_total_con_r2_bajo():
    items = compute_impact(_kpis(r2=0.002))
    proyectadas = [it for it in items if "proyectadas" in it.label.lower()]
    assert proyectadas == [], "no debe aparecer un total 'proyectado' con R² bajo"
    ritmo_items = [it for it in items if "ritmo" in it.label.lower()]
    assert ritmo_items and ritmo_items[0].kind == HECHO
    assert ritmo_items[0].value == 13


def test_impacto_si_proyecta_total_con_r2_alto():
    items = compute_impact(_kpis(r2=0.55, dias=2, ventas_dia=5))
    proyectadas = [it for it in items if "proyectadas" in it.label.lower()]
    assert proyectadas, "con R² alto el total proyectado sí debe aparecer"


def test_comparacion_analytics_no_muestra_proyeccion_fabricada():
    a = analyze(_kpis(r2=0.002))
    forecast_cmp = [c for c in a.comparisons if "forecast" in c.label.lower()
                    or "ritmo" in c.label.lower()]
    assert forecast_cmp, "esperaba una entrada de ritmo (no forecast) en comparisons"
    assert "ritmo" in forecast_cmp[0].label.lower()
    assert "forecast" not in forecast_cmp[0].label.lower() or "no forecast" in forecast_cmp[0].label.lower()


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
        except Exception as e:
            failed += 1
            print(f"  ERROR {t.__name__}: {type(e).__name__}: {e}")
    print(f"\n{len(tests) - failed}/{len(tests)} passed")
    sys.exit(1 if failed else 0)
