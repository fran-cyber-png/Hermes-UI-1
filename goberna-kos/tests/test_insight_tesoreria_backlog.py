"""Golden harness — P3: desintoxicar insight_engine (docs/14 §4, insight_engine.py:37-45).

Caso real: Ivi dijo, con "confianza alta", que las 273 ventas fuera de ventana se pierden
PORQUE "Tesorería confirma el voucher después de los 7 días". Falso: es backlog histórico
del período sin cron (16/06-04/07, docs/10 §2); la latencia de Tesorería HOY es sana
(p90 real = 3.9, dentro de la ventana de 7). El insight no puede culpar a Tesorería
cuando su propia p90 (que el motor ya recibe en el mismo payload) dice lo contrario.

Golden bullet (docs/15): "p90 < 7 ⇒ NO existe el insight de 'Tesorería tarda'".
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from ivi.kpi_engine import KPIs
from ivi.analytics_engine import Analysis
from ivi.insight_engine import detect
from ivi.recommendation_engine import recommend

TESORERIA_LENTA = "después de los 7 días"


def _kpis(p90, perd=273, conn=6727):
    k = KPIs()
    k.ventas_perdidas_ventana = perd
    k.ventas_conocidas = conn
    k.latencia = {"p90": p90, "fueraDeVentana": 116, "sinConfirmar": 5239}
    return k


def test_p90_sano_no_dispara_insight_de_tesoreria_lenta():
    insights = detect(_kpis(p90=3.9), Analysis())
    culpa_tesoreria = [i for i in insights if TESORERIA_LENTA in i.text]
    assert culpa_tesoreria == []


def test_p90_sano_reencuadra_como_backlog_historico():
    insights = detect(_kpis(p90=3.9), Analysis())
    backlog = [i for i in insights if "backlog" in i.text.lower() or "histórico" in i.text.lower()]
    assert backlog, "esperaba un insight que reencuadre las 273 como backlog histórico"
    assert backlog[0].severity != "crit"  # no es una alarma activa, ya no es corriente
    assert "3.9" in backlog[0].text or "3,9" in backlog[0].text  # cita el p90 real


def test_p90_realmente_lento_si_dispara_el_insight_de_tesoreria():
    insights = detect(_kpis(p90=9.2), Analysis())
    culpa_tesoreria = [i for i in insights if TESORERIA_LENTA in i.text]
    assert culpa_tesoreria, "con p90 > 7 el insight SÍ debe culpar la latencia de Tesorería"
    assert culpa_tesoreria[0].severity == "crit"


def test_p90_sano_no_recomienda_arreglar_tesoreria():
    """recommendation_engine gateaba por substring, no por severidad (docs/14 §4
    'acciones recicladas'): con Tesorería sana seguía recomendando 'reordenar la
    bandeja' / 'recortar latencia' aunque el propio insight dijera lo contrario."""
    insights = detect(_kpis(p90=3.9), Analysis())
    actions = recommend(_kpis(p90=3.9), Analysis(), insights)
    textos = " ".join(a.action for a in actions)
    assert "Reordenar la bandeja de Tesorería" not in textos
    assert "recortar la latencia de confirmación" not in textos


def test_p90_lento_si_recomienda_arreglar_tesoreria():
    insights = detect(_kpis(p90=9.2), Analysis())
    actions = recommend(_kpis(p90=9.2), Analysis(), insights)
    textos = " ".join(a.action for a in actions)
    assert "Reordenar la bandeja de Tesorería" in textos


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
