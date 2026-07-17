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
