"""Golden harness — Ivi Studio Fase B: `contexto` del creativo + pool del warmer.

El estudio scopea el chat al creativo con un `contexto` opcional que se pliega
al prompt SIN tocar la Ley I (las cifras siguen saliendo del motor). Y el warmer
precalienta un pool aparte (PREGUNTAS_STUDIO) para que las chips del estudio den
cache hit — por eso el estudio manda las chips SIN `contexto` (mismo prompt que
calienta el warmer) y el texto libre CON `contexto` (respuesta Brief-aware, miss).
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from ivi.kpi_engine import KPIs
from ivi.analytics_engine import analyze
from ivi.impact_engine import compute_impact
from ivi.intent_analyzer import analyze as analyze_intent
from ivi.prompt_builder import build
from ivi.config import PREGUNTAS_SUGERIDAS, PREGUNTAS_STUDIO


def _prompt(pregunta, contexto=""):
    k = KPIs()
    a = analyze(k)
    intent = analyze_intent(pregunta)
    return build(intent, k, a, [], [], ["ROAS por país"], compute_impact(k),
                 scope_note="", contexto=contexto)


def test_sin_contexto_el_prompt_no_lleva_bloque_de_creativo():
    assert "CONTEXTO DEL CREATIVO" not in _prompt("ROAS por país")


def test_con_contexto_el_bloque_entra_y_respeta_ley_i():
    ctx = "creativo para Manual de Inteligencia, ángulo urgencia, país objetivo Perú"
    prompt = _prompt("ROAS por país", contexto=ctx)
    assert "CONTEXTO DEL CREATIVO EN CONSTRUCCIÓN" in prompt
    assert ctx in prompt
    # la barrera de honestidad viaja con el bloque: el modelo no inventa cifras
    assert "Ley I" in prompt and "No inventes números" in prompt


def test_contexto_cambia_la_clave_de_cache_del_prompt():
    # El warmer calienta SIN contexto; una chip sin contexto calza ese prompt, y
    # un texto libre CON contexto es una clave distinta (miss, respuesta scopeada).
    sin = _prompt("ROAS por país")
    con = _prompt("ROAS por país", contexto="creativo para el Diplomado")
    assert sin != con, "el contexto debe cambiar el prompt (y con él el hash del caché)"


def test_pool_del_estudio_es_aparte_de_las_12_de_la_ui():
    # PREGUNTAS_SUGERIDAS son las 12 de la UI BI (otro test las fija en 12); el
    # estudio suma su propio pool para el warmer sin pisarlas.
    assert len(PREGUNTAS_STUDIO) >= 4
    assert not (set(PREGUNTAS_STUDIO) & set(PREGUNTAS_SUGERIDAS)), \
        "el pool del estudio no debe duplicar las 12 canónicas"


def test_las_chips_del_estudio_no_son_followup():
    # Regresión Fase B: si PREGUNTAS_STUDIO no está en _CANONICAS, la 2a chip de
    # datos de una sesión se marca follow-up (≤4 palabras) -> scope_note -> prompt
    # distinto -> cache miss (rompe el ≤19ms) y respuesta mal enmarcada.
    from ivi.memory import _SESSIONS, Turn, remember, is_followup
    from ivi.intent_analyzer import analyze
    _SESSIONS.clear()
    remember("s", Turn(intent=analyze("ROAS por país"), scope="atribucion",
                       question="ROAS por país"))
    for q in PREGUNTAS_STUDIO:
        assert is_followup(q, "s") is False, f"{q!r} (chip del estudio) no puede ser follow-up"
    # un acotamiento de verdad sí sigue siendo follow-up
    assert is_followup("¿y solo México?", "s") is True


def test_frescura_cae_a_la_ultima_conocida_cuando_la_query_no_la_trae():
    # "ROAS por país" solo pega a atribución (sin serie de ventas) -> antes abría
    # con "sin frescura de corte" (confuso e inconsistente). Ahora reusa el último
    # corte conocido, que es el mismo para todo el sistema.
    import ivi.data_collector as dc
    from ivi.data_collector import _frescura, RawData
    prev = dc._LAST_FRESCURA
    try:
        dc._LAST_FRESCURA = ({"ventas": "datos de ventas hasta el 2026-07-11"},
                             "2026-07-17T00:00:00")
        assert _frescura(RawData()) == {"ventas": "datos de ventas hasta el 2026-07-11"}
        # una query que SÍ trae ventas no se pisa con el fallback
        raw = RawData(comercial={"diaria": [{"dia": "2026-07-11", "ventas": 5}]})
        assert _frescura(raw)["ventas"] == "datos de ventas hasta el 2026-07-11"
    finally:
        dc._LAST_FRESCURA = prev


def test_criterios_centralizados_semaforo_cac_y_presupuesto():
    # docs/27 §3: la capa de criterios fundada. Semáforo de CAC + presupuesto conocido.
    from ivi.criterios import (semaforo_cac, presupuesto_txt, PRESUPUESTO_MENSUAL_USD,
                               CAC_TECHO, ROAS_PISO, VENTAS_RUIDO)
    assert semaforo_cac(20) == "verde"      # ROAS >= 4x
    assert semaforo_cac(35) == "amarillo"   # ROAS 3-4x
    assert semaforo_cac(50) == "rojo"       # ROAS < 3x = CAC caro
    assert semaforo_cac(CAC_TECHO + 1) == "techo"
    assert semaforo_cac(None) is None
    assert PRESUPUESTO_MENSUAL_USD == 3000.0
    assert presupuesto_txt() == "USD 3.000"
    assert ROAS_PISO == 3.0 and VENTAS_RUIDO == 25   # calibrado a info-product


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
