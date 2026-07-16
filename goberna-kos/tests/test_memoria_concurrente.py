"""Golden harness — P0.1: la memoria conversacional bajo concurrencia (docs/19).

Con OLLAMA_NUM_PARALLEL=4 hay 4 requests reales mutando `_SESSIONS` a la vez.
Antes del lock, dos `setdefault` simultáneos podían crear dos Sessions (una se
perdía con su turno) y el append+trim de history corría sin protección.

Además, P0.2 hace que el sid lo genere el navegador → entrada del cliente →
`_SESSIONS` necesita tope (_MAX_SESSIONS) para no crecer sin límite.
"""

import os
import sys
import threading

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from ivi.memory import (_SESSIONS, _MAX_SESSIONS, Turn, get_session, remember,
                        is_followup, apply_followup_filters)
from ivi.intent_analyzer import analyze


def _turno(q="ventas de este mes"):
    return Turn(intent=analyze(q), scope="ventas", question=q)


def _correr_en_threads(n, work):
    errores = []

    def wrapped(i):
        try:
            work(i)
        except Exception as e:  # noqa: BLE001 — el test reporta cualquier explosión
            errores.append(f"{type(e).__name__}: {e}")

    threads = [threading.Thread(target=wrapped, args=(i,)) for i in range(n)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    return errores


def test_remember_concurrente_no_explota_y_acota_history():
    _SESSIONS.clear()

    def work(i):
        for k in range(50):
            remember("compartida", _turno(f"pregunta {i}-{k}"))
            is_followup("¿y solo lima?", "compartida")
            apply_followup_filters("solo lima", "compartida")

    errores = _correr_en_threads(8, work)
    assert not errores, f"explotó bajo concurrencia: {errores[:3]}"
    s = get_session("compartida")
    assert len(s.history) <= 12, f"history desbordada: {len(s.history)}"
    assert s.last is not None
    assert s.last in s.history


def test_get_session_concurrente_devuelve_una_sola_instancia():
    _SESSIONS.clear()
    vistos = []
    barrera = threading.Barrier(16)

    def work(i):
        barrera.wait()
        vistos.append(id(get_session("misma")))

    errores = _correr_en_threads(16, work)
    assert not errores
    assert len(set(vistos)) == 1, f"setdefault creó {len(set(vistos))} Sessions para el mismo sid"


def test_sesiones_distintas_no_se_mezclan():
    _SESSIONS.clear()

    def work(i):
        for k in range(20):
            remember(f"sid-{i}", _turno(f"pregunta de {i} nro {k}"))

    errores = _correr_en_threads(8, work)
    assert not errores
    for i in range(8):
        s = get_session(f"sid-{i}")
        assert s.last is not None
        assert f"de {i} " in s.last.question, f"sid-{i} terminó con un turno ajeno: {s.last.question!r}"


def test_sessions_tiene_tope_porque_el_sid_es_del_cliente():
    _SESSIONS.clear()
    for i in range(_MAX_SESSIONS + 50):
        get_session(f"spam-{i}")
    assert len(_SESSIONS) <= _MAX_SESSIONS, f"_SESSIONS creció a {len(_SESSIONS)}"
    # la última creada sigue viva; la desalojada es la más vieja
    assert f"spam-{_MAX_SESSIONS + 49}" in _SESSIONS
    assert "spam-0" not in _SESSIONS


def test_el_tope_no_desaloja_si_el_sid_ya_existe():
    _SESSIONS.clear()
    for i in range(_MAX_SESSIONS):
        remember(f"viva-{i}", _turno())
    antes = len(_SESSIONS)
    s = get_session("viva-0")  # ya existe: no debe desalojar nada
    assert len(_SESSIONS) == antes
    assert s.last is not None


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
