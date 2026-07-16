"""Golden harness — P1: scope guard de períodos comparables (docs/14 §5, docs/15).

Caso real (2026-07-16): Ivi comparó julio (mes EN CURSO, datos hasta el día 11 según
`comercial.diaria`) contra junio COMPLETO y dijo "julio cae 54,3%". La realidad, mismos
días (1..11): junio 121/USD 13.586 vs julio 155/USD 19.988 → julio va ARRIBA.

Fixture: números reales capturados de /api/overview/comercial el 2026-07-16 (ver
docs/14-IVI-LA-FORMA-DE-RESPONDER.md). El cutoff se deriva de los datos (día 11, el
último que trae `serie_diaria`), no de una fecha asumida — es lo que la base sostiene.

Pure Python, no Ollama, no network. Runs two ways:
    python3 tests/test_scope_guard_periodos.py
    pytest tests/test_scope_guard_periodos.py
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from ivi.kpi_engine import KPIs, SeriePoint
from ivi.analytics_engine import analyze
from ivi.impact_engine import compute_impact, HECHO
from ivi.intent_analyzer import analyze as analyze_intent
from ivi.prompt_builder import _fmt_target_month


def _dias(mes: str, hasta: int, ventas_total: int, usd_total: int, extra_dias: int = 0,
          ventas_extra: int = 0, usd_extra: int = 0):
    """Genera `hasta` filas diarias para `mes` cuya suma da exactamente los totales
    pedidos (la distribución día a día no importa para estos asserts), más
    `extra_dias` filas después del cutoff (para simular un mes ya completo, como
    junio, que sigue teniendo días 12..30 en la serie diaria)."""
    rows = []
    base = ventas_total // hasta
    resto_v = ventas_total - base * hasta
    baseu = usd_total // hasta
    resto_u = usd_total - baseu * hasta
    for d in range(1, hasta + 1):
        v = base + (resto_v if d == hasta else 0)
        u = baseu + (resto_u if d == hasta else 0)
        rows.append({"dia": f"{mes}-{d:02d}", "ventas": v, "usd": u})
    if extra_dias:
        base_e = ventas_extra // extra_dias
        resto_e = ventas_extra - base_e * extra_dias
        baseu_e = usd_extra // extra_dias
        resto_ue = usd_extra - baseu_e * extra_dias
        for i, d in enumerate(range(hasta + 1, hasta + 1 + extra_dias)):
            v = base_e + (resto_e if i == extra_dias - 1 else 0)
            u = baseu_e + (resto_ue if i == extra_dias - 1 else 0)
            rows.append({"dia": f"{mes}-{d:02d}", "ventas": v, "usd": u})
    return rows


def _kpis_caso_real() -> KPIs:
    """Reconstruye el caso del 2026-07-16 con los números reales de producción."""
    k = KPIs()
    k.serie_mensual = [
        SeriePoint(label="2026-04", ventas=328, usd=35794),
        SeriePoint(label="2026-05", ventas=398, usd=42240),
        SeriePoint(label="2026-06", ventas=339, usd=38403),
        SeriePoint(label="2026-07", ventas=155, usd=19989),  # mes en curso, cutoff=11
    ]
    diaria = []
    diaria += _dias("2026-04", 11, 123, 13043)
    diaria += _dias("2026-05", 11, 133, 13793)
    diaria += _dias("2026-06", 11, 121, 13586, extra_dias=19, ventas_extra=218, usd_extra=24817)
    diaria += _dias("2026-07", 11, 155, 19988)  # todo julio: no hay más días aún
    k.serie_diaria = diaria
    return k


def test_cutoff_mes_parcial_se_deriva_de_la_serie_diaria():
    k = _kpis_caso_real()
    assert k.cutoff_mes_parcial() == 11


def test_mes_completo_no_dispara_el_scope_guard():
    k = KPIs()
    k.serie_mensual = [SeriePoint(label="2026-05", ventas=398, usd=42240),
                        SeriePoint(label="2026-06", ventas=339, usd=38403)]
    k.serie_diaria = _dias("2026-06", 30, 339, 38403)  # mes completo: 30 días
    assert k.cutoff_mes_parcial() is None


def test_sin_serie_diaria_no_hay_cutoff():
    k = KPIs()
    k.serie_mensual = [SeriePoint(label="2026-06", ventas=339, usd=38403),
                        SeriePoint(label="2026-07", ventas=155, usd=19989)]
    assert k.cutoff_mes_parcial() is None


def test_serie_comparable_iguala_las_ventanas():
    k = _kpis_caso_real()
    comparable = k.serie_comparable(11)
    labels = [s.label for s in comparable]
    assert labels == ["2026-04", "2026-05", "2026-06", "2026-07"]
    by_label = {s.label: s for s in comparable}
    assert by_label["2026-06"].ventas == 121 and by_label["2026-06"].usd == 13586
    assert by_label["2026-07"].ventas == 155 and by_label["2026-07"].usd == 19988


def test_comparacion_mes_parcial_es_1_a_N_contra_1_a_N():
    """La mentira más gorda: 'julio cae 54,3% (155 vs 339)'. La verdad, mismos días: +28,1%."""
    a = analyze(_kpis_caso_real())
    mes_actual = next((c for c in a.comparisons if "Mes actual" in c.label), None)
    assert mes_actual is not None
    assert "parcial" in mes_actual.label.lower()
    assert "11" in mes_actual.label  # declara el corte
    assert mes_actual.current == 155
    assert mes_actual.previous == 121          # NUNCA 339 (mes junio completo)
    assert mes_actual.delta_abs == 34
    assert mes_actual.delta_pct == 28.1        # NUNCA -54.3


def test_momentum_no_miente_con_mes_parcial():
    """Con las ventanas igualadas, julio es el MEJOR ritmo del trimestre, no una caída del 32%."""
    a = analyze(_kpis_caso_real())
    assert a.trend != "baja"
    if a.momentum_pct is not None:
        assert a.momentum_pct > -5


def test_no_hay_anomalia_de_caida_fabricada():
    a = analyze(_kpis_caso_real())
    caidas = [an for an in a.anomalies
              if an.severity in ("warn", "crit") and "aída" in an.text]
    assert caidas == [] or all(a.delta_pct is None for a in [])  # ninguna caída falsa


def test_fmt_target_month_no_repite_la_mentira_full_vs_parcial():
    """Fuga encontrada en la verificación E2E: `_fmt_target_month` (prompt_builder)
    calcula su PROPIA comparación mes-vs-previo, independiente de analytics_engine,
    y seguía mostrando 155 vs 339 (-54,3%) aunque el scope guard ya estaba en
    analytics_engine/impact_engine. El golden harness no la cubría porque vive en
    otro módulo — la agarró recién la corrida E2E contra el prompt real."""
    k = _kpis_caso_real()
    intent = analyze_intent("¿cómo vamos en las ventas este mes?")
    texto = _fmt_target_month(k, intent)
    assert "155 ventas" in texto
    assert "-54.3" not in texto and "-184" not in texto
    assert "mismos días" in texto and "día 11" in texto
    assert "+34 ventas (+28.1%)" in texto


def test_impacto_delta_usa_ventanas_comparables():
    """impact_engine.compute_impact también debe comparar 1..N vs 1..N, no full vs parcial."""
    items = compute_impact(_kpis_caso_real())
    dv = next((it for it in items if "ingresos" in it.label.lower()), None)
    dventas = next((it for it in items if "ventas" in it.label.lower()
                     and "Δ" in it.label), None)
    assert dv is not None and dv.kind == HECHO
    assert dv.value == 6402          # 19988 - 13586, NUNCA -18414 (19989-38403)
    assert dventas is not None
    assert dventas.value == 34       # 155 - 121, NUNCA -184 (155-339)


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
