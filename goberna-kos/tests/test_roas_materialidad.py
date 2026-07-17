"""Golden harness — materialidad del ROAS por país (el caso Honduras, 2026-07-16).

Caso real reproducido en vivo: con 29 países en atribución, el titular de Ivi
era "ROAS mejor país (Honduras): 65.15 (gasto USD 33)" y "peor país (PT): 0.00
(gasto USD 18)", con acciones "profundizar en Honduras" — polvo estadístico de
gasto de prueba — mientras Perú (USD 5.920, confianza alta del backend) no se
contaba. El backend YA clasifica la señal (confianza alta/media/baja); estos
tests fijan que el motor la respete en las TRES salidas: impacto, anomalías
del analytics y el listado del prompt.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from ivi.kpi_engine import KPIs, roas_material, GASTO_MATERIAL_USD
from ivi.impact_engine import compute_impact, SIN_EVIDENCIA
from ivi.analytics_engine import analyze
from ivi.prompt_builder import build
from ivi.impact_engine import compute_impact as _ci
from ivi.intent_analyzer import analyze as analyze_intent


# Filas con la forma REAL del backend (/api/overview/atribucion, 2026-07-16).
def _roas_prod():
    return [
        {"pais": "Perú", "roas": 7.25, "gastoUsd": 5920, "ventas": 398,
         "cacVenta": 14.87, "accion": "escalar", "confianza": "alta"},
        {"pais": "Bolivia", "roas": 4.28, "gastoUsd": 1642, "ventas": 67,
         "cacVenta": 24.5, "accion": "escalar", "confianza": "alta"},
        {"pais": "Honduras", "roas": 65.15, "gastoUsd": 33, "ventas": 18,
         "cacVenta": 1.83, "accion": "observar", "confianza": "baja"},
        {"pais": "PT", "roas": 0.0, "gastoUsd": 18, "ventas": 0,
         "cacVenta": None, "accion": "sin_ventas", "confianza": "baja"},
    ]


def _kpis(rows):
    k = KPIs()
    k.roas_por_pais = rows
    return k


def _by_label(items, needle):
    return next((it for it in items if needle in it.label), None)


def test_honduras_con_33_dolares_no_es_el_mejor_pais():
    items = compute_impact(_kpis(_roas_prod()))
    best = _by_label(items, "mejor país")
    assert best is not None
    assert "Perú" in best.label, f"el mejor país fue {best.label!r} — Honduras (USD 33) no puede ganar"


def test_pt_con_18_dolares_no_es_el_peor_pais():
    items = compute_impact(_kpis(_roas_prod()))
    worst = _by_label(items, "peor país")
    assert worst is not None
    assert "Bolivia" in worst.label, f"el peor país fue {worst.label!r} — PT (USD 18) no tiene señal"


def test_las_colas_van_en_una_linea_desestimada():
    items = compute_impact(_kpis(_roas_prod()))
    colas = _by_label(items, "gasto de prueba")
    assert colas is not None and colas.kind == SIN_EVIDENCIA
    assert "2 países" in colas.label
    assert "Honduras" in (colas.nota or ""), "la cola debe ser consultable, no titular"
    assert "no accionables" in (colas.nota or "")


def test_fallback_por_umbral_cuando_no_hay_confianza():
    rows = [{"pais": "A", "roas": 3.0, "gastoUsd": 200},
            {"pais": "B", "roas": 50.0, "gastoUsd": 90}]
    assert roas_material(rows[0]) is True
    assert roas_material(rows[1]) is False
    assert GASTO_MATERIAL_USD == 150
    items = compute_impact(_kpis(rows))
    best = _by_label(items, "mejor país")
    assert best is not None and "A" in best.label


def test_todo_polvo_no_produce_titulares_ni_explota():
    rows = [r for r in _roas_prod() if r["confianza"] == "baja"]
    items = compute_impact(_kpis(rows))
    assert _by_label(items, "mejor país") is None
    assert _by_label(items, "peor país") is None
    assert _by_label(items, "Tendencia temporal") is None
    colas = _by_label(items, "gasto de prueba")
    assert colas is not None and colas.kind == SIN_EVIDENCIA


def test_la_anomalia_del_analytics_tampoco_corona_a_honduras():
    a = analyze(_kpis(_roas_prod()))
    atr = next((an.text for an in a.anomalies if "Atribución" in an.text), None)
    assert atr is not None
    assert "Perú" in atr and "Bolivia" in atr
    assert "Honduras" not in atr and "PT" not in atr


def test_el_insight_roas_debil_no_se_dispara_con_gasto_de_prueba():
    # PT (USD 18) e Italia (USD 9) con ROAS 0 NO son "pierden plata en pauta".
    from ivi.insight_engine import detect
    k = _kpis(_roas_prod())
    ins = detect(k, analyze(k))
    debil = next((i for i in ins if "ROAS < 1" in i.text), None)
    assert debil is None, f"se disparó con polvo: {debil.text!r}"


def test_el_insight_roas_debil_si_se_dispara_con_senal_material():
    from ivi.insight_engine import detect
    rows = _roas_prod() + [{"pais": "Chile", "roas": 0.6, "gastoUsd": 900,
                            "ventas": 12, "accion": "recortar", "confianza": "alta"}]
    k = _kpis(rows)
    ins = detect(k, analyze(k))
    debil = next((i for i in ins if "ROAS < 1" in i.text), None)
    assert debil is not None, "un país material con ROAS<1 SÍ es un insight real"
    assert "Chile" in debil.text
    assert "PT" not in debil.text


def test_el_prompt_detalla_con_senal_y_agrega_las_colas():
    k = _kpis(_roas_prod())
    a = analyze(k)
    impact = _ci(k)
    intent = analyze_intent("¿cómo vamos en ventas este mes?")
    prompt = build(intent, k, a, [], [], [], impact)
    assert "Perú=ROAS 7.25" in prompt
    assert "Honduras=ROAS" not in prompt, "el detalle por país no puede incluir colas sin señal"
    assert "ROAS sin señal: 2 países" in prompt
    assert "no destacarlos" in prompt


def test_la_participacion_por_pais_no_lista_la_cola_de_cero_coma():
    # Clientes reales en Croacia/Islandia (0,1%/0,0%) existen, pero cada nombre
    # en el prompt es un país que el modelo puede volver titular: van agregados.
    from ivi.analytics_engine import Analysis
    a = Analysis()
    a.participations["por_pais"] = [
        {"name": "México", "share_pct": 26.3}, {"name": "Perú", "share_pct": 25.4},
        {"name": "CROACIA", "share_pct": 0.1}, {"name": "Italia", "share_pct": 0.0},
    ]
    k = _kpis([])
    impact = _ci(k)
    intent = analyze_intent("¿cómo vamos en ventas este mes?")
    prompt = build(intent, k, a, [], [], [], impact)
    assert "México=26.3%" in prompt
    assert "CROACIA" not in prompt and "Italia" not in prompt
    assert "resto=0.1% (2 países)" in prompt


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
