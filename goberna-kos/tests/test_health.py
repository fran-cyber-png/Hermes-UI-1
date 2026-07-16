"""Golden harness — P0.2 + P0.4: /api/health y la sesión por navegador (docs/19).

El health es el probe que hace observables P1 (caché de respuestas) y P2
(warmer). Contrato: O(1), sin fetches, sin Ollama — tiene que contestar igual
con el backend caído. La frescura que reporta es la última CONOCIDA (la dejó
collect()), no una recién pedida.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from ivi import cache
from ivi.server import HTML, health
from ivi.data_collector import last_frescura


def test_health_cumple_el_contrato():
    h = health()
    assert h["ok"] is True
    assert h["model"], "el health debe decir qué modelo sirve"
    assert isinstance(h["inflight"], int) and h["inflight"] >= 0
    assert set(h["cache"]) == {"entries", "hits", "misses"}
    assert isinstance(h["uptime_s"], float) and h["uptime_s"] >= 0
    assert set(h["frescura"]) == {"datos", "calculada"}


def test_frescura_sin_collect_es_honesta():
    # Antes de cualquier collect() no hay frescura conocida: {} y None,
    # nunca un valor inventado.
    f = last_frescura()
    assert f["datos"] == {}
    assert f["calculada"] is None


def test_cache_cuenta_hits_y_misses():
    cache.clear()
    assert cache.get("x", 60) is None          # miss
    cache.put("x", 1, 60)
    assert cache.get("x", 60) == 1             # hit
    st = cache.stats()
    assert st == {"entries": 1, "hits": 1, "misses": 1}, st


def test_cache_expirada_cuenta_como_miss_y_desaloja():
    cache.clear()
    cache.put("vieja", 1, -1)                  # ya nació expirada
    assert cache.get("vieja", 60) is None
    st = cache.stats()
    assert st["misses"] == 1 and st["entries"] == 0, st


def test_la_ui_manda_sesion_propia_por_navegador():
    # P0.2: sin esto todos los navegadores comparten sid="default" y los
    # follow-ups de dos personas se mezclan.
    assert "localStorage.sid" in HTML
    assert "session:SID" in HTML, "el body del fetch debe llevar la sesión"
    # randomUUID solo existe en contextos seguros y la UI corre en http://IP:8080
    assert "crypto.randomUUID ?" in HTML, "falta el fallback para contexto no seguro"


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
