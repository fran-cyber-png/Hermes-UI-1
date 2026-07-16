"""Golden harness — P2: la frescura como dato (docs/14 §4/§5).

Caso real: Ivi narró "en presente" datos con 5 días de rezago sin decirlo nunca.
`data_collector` debe calcular "datos hasta el D" a partir de lo que YA se trajo
(sin fetches nuevos) y `prompt_builder` debe inyectarlo siempre que haya serie diaria.

Golden bullet (docs/15): "toda respuesta declara 'datos hasta el D'".
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from ivi.data_collector import RawData, _frescura
from ivi.kpi_engine import compute, KPIs
from ivi.analytics_engine import analyze
from ivi.insight_engine import detect
from ivi.recommendation_engine import recommend
from ivi.impact_engine import compute_impact
from ivi.intent_analyzer import analyze as analyze_intent
from ivi.prompt_builder import build


def _raw_con_diaria():
    raw = RawData()
    raw.comercial = {
        "serie": [{"mes": "2026-06", "ventas": 339, "ventasUsd": 38403},
                  {"mes": "2026-07", "ventas": 155, "ventasUsd": 19989}],
        "diaria": [{"dia": "2026-07-09", "ventas": 12, "usd": 1500},
                   {"dia": "2026-07-10", "ventas": 14, "usd": 1700},
                   {"dia": "2026-07-11", "ventas": 13, "usd": 1600}],
    }
    raw.endpoints_hit = ["comercial"]
    return raw


def test_data_collector_calcula_datos_hasta_el_dia():
    raw = _raw_con_diaria()
    frescura = _frescura(raw)
    assert "ventas" in frescura
    assert "2026-07-11" in frescura["ventas"]


def test_sin_diaria_no_inventa_frescura():
    raw = RawData()
    raw.comercial = {"serie": [{"mes": "2026-07", "ventas": 155, "ventasUsd": 19989}]}
    frescura = _frescura(raw)
    assert frescura == {}


def test_kpis_transporta_la_frescura():
    raw = _raw_con_diaria()
    raw.frescura = _frescura(raw)
    k = compute(raw)
    assert "ventas" in k.frescura
    assert "2026-07-11" in k.frescura["ventas"]


def test_prompt_declara_siempre_datos_hasta_el_dia():
    raw = _raw_con_diaria()
    raw.frescura = _frescura(raw)
    k = compute(raw)
    a = analyze(k)
    insights = detect(k, a)
    actions = recommend(k, a, insights)
    impact = compute_impact(k)
    intent = analyze_intent("¿cómo vamos en las ventas este mes?")
    prompt = build(intent, k, a, insights, actions, [], impact)
    assert "2026-07-11" in prompt
    assert "FRESCURA" in prompt or "datos hasta" in prompt.lower()


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
