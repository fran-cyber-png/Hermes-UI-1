"""Golden harness — P2: el warmer precalienta las frecuentes en background.

Contrato: una pasada calienta lo que falta y NO regenera lo tibio; un fallo
en una pregunta no corta las demás; la lista de sugerencias es fuente única
(config) y la UI la recibe por inyección.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from ivi import answer_cache as ac
from ivi.warmer import calentar_una_vez
from ivi.config import PREGUNTAS_SUGERIDAS


def _stubs():
    generaciones = []

    def armar_prompt(q):
        return f"PROMPT<{q}>"

    def generar(prompt):
        generaciones.append(prompt)
        return f"respuesta para {prompt}"

    return armar_prompt, generar, generaciones


def test_una_pasada_calienta_todo_y_la_segunda_no_regenera():
    ac.reiniciar()
    armar, generar, gens = _stubs()
    r1 = calentar_una_vez(["a", "b", "c"], armar, generar, pausa=0, timeout=5)
    assert r1 == {"nuevas": 3, "tibias": 0, "fallos": 0}
    assert len(gens) == 3
    r2 = calentar_una_vez(["a", "b", "c"], armar, generar, pausa=0, timeout=5)
    assert r2 == {"nuevas": 0, "tibias": 3, "fallos": 0}
    assert len(gens) == 3, "la segunda pasada no debía tocar el modelo"


def test_cambio_de_datos_recalienta_solo_lo_que_cambio():
    ac.reiniciar()
    armar, generar, gens = _stubs()
    calentar_una_vez(["a", "b"], armar, generar, pausa=0, timeout=5)

    def armar_v2(q):  # "llegó un dump": el prompt de `a` cambió, el de `b` no
        return "PROMPT<a·dump-nuevo>" if q == "a" else f"PROMPT<{q}>"

    r = calentar_una_vez(["a", "b"], armar_v2, generar, pausa=0, timeout=5)
    assert r == {"nuevas": 1, "tibias": 1, "fallos": 0}


def test_un_fallo_no_corta_las_demas():
    ac.reiniciar()
    armar, generar, gens = _stubs()

    def generar_fragil(prompt):
        if "<b>" in prompt:
            raise RuntimeError("ollama caído justo acá")
        return generar(prompt)

    r = calentar_una_vez(["a", "b", "c"], armar, generar_fragil, pausa=0, timeout=5)
    assert r == {"nuevas": 2, "tibias": 0, "fallos": 1}
    assert ac.tiene(ac.clave_de("PROMPT<c>")), "c debía calentarse aunque b fallara"


def test_los_botones_no_son_followup_ni_con_historia_en_la_sesion():
    # El bug que mató el cronómetro (2026-07-17): con historia en la sesión,
    # "tendencia de ventas" (≤4 palabras) se marcaba follow-up → scope_note →
    # prompt distinto → el caché del warmer nunca servía del 2º botón en adelante.
    from ivi.memory import _SESSIONS, Turn, remember, is_followup
    from ivi.intent_analyzer import analyze
    _SESSIONS.clear()
    remember("s", Turn(intent=analyze("ventas por semana"), scope="ventas",
                       question="ventas por semana"))
    for q in PREGUNTAS_SUGERIDAS:
        assert is_followup(q, "s") is False, f"{q!r} no puede ser follow-up: es canónica"
    # un acotamiento de verdad sigue siendo follow-up
    assert is_followup("¿y solo Lima?", "s") is True


def test_las_12_sugerencias_son_fuente_unica_y_llegan_a_la_ui():
    assert len(PREGUNTAS_SUGERIDAS) == 12
    from ivi.server import HTML
    assert "__SUG__" not in HTML, "la inyección no corrió"
    for q in PREGUNTAS_SUGERIDAS:
        assert q in HTML, f"la sugerencia {q!r} no llegó a la UI"


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
