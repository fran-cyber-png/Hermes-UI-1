"""Golden harness — P1: caché de respuestas por huella de datos (docs/19).

Contrato: la respuesta es una función pura de (pregunta, datos) colapsada en
el prompt. Byte-idéntico → se sirve la cacheada sin tocar el modelo.
Invalidación por construcción (el hash), jamás por TTL. Single-flight: dos
idénticas concurrentes = UNA generación. La calidez sobrevive reinicios
(round-trip a disco). Sin red: `generar` es un stub.
"""

import os
import sys
import threading
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from ivi import answer_cache as ac


def _contador():
    """Un generar() stub que cuenta cuántas veces lo invocaron."""
    llamadas = []

    def generar():
        llamadas.append(1)
        return f"respuesta #{len(llamadas)}"

    return generar, llamadas


def test_segunda_llamada_identica_no_invoca_al_modelo():
    ac.reiniciar()
    generar, llamadas = _contador()
    r1, m1 = ac.obtener_o_generar("prompt A", generar, timeout=5)
    r2, m2 = ac.obtener_o_generar("prompt A", generar, timeout=5)
    assert len(llamadas) == 1, f"el modelo se invocó {len(llamadas)} veces para el mismo prompt"
    assert r1 == r2
    assert m1["hit"] is False and m2["hit"] is True
    assert m2["creado"] == m1["creado"]


def test_prompt_distinto_es_miss():
    ac.reiniciar()
    generar, llamadas = _contador()
    ac.obtener_o_generar("prompt A", generar, timeout=5)
    ac.obtener_o_generar("prompt B (un dato cambió)", generar, timeout=5)
    assert len(llamadas) == 2
    assert ac.stats() == {"entries": 2, "hits": 0, "misses": 2}


def test_single_flight_dos_threads_una_generacion():
    ac.reiniciar()
    llamadas = []

    def generar_lento():
        llamadas.append(1)
        time.sleep(0.3)
        return "la única generación"

    resultados = []
    hilos = [threading.Thread(
        target=lambda: resultados.append(ac.obtener_o_generar("mismo prompt", generar_lento, timeout=5)))
        for _ in range(4)]
    for h in hilos:
        h.start()
    for h in hilos:
        h.join()
    assert len(llamadas) == 1, f"single-flight roto: {len(llamadas)} generaciones concurrentes"
    assert len(resultados) == 4
    assert all(r[0] == "la única generación" for r in resultados)


def test_si_el_lider_falla_el_siguiente_reintenta():
    ac.reiniciar()
    intentos = []

    def generar_fallando_una_vez():
        intentos.append(1)
        if len(intentos) == 1:
            raise RuntimeError("ollama caído")
        return "al segundo intento salió"

    try:
        ac.obtener_o_generar("prompt X", generar_fallando_una_vez, timeout=5)
        raise AssertionError("el primer intento debía fallar")
    except RuntimeError:
        pass
    r, m = ac.obtener_o_generar("prompt X", generar_fallando_una_vez, timeout=5)
    assert r == "al segundo intento salió" and m["hit"] is False


def test_round_trip_a_disco():
    import tempfile
    ac.reiniciar()
    generar, llamadas = _contador()
    with tempfile.TemporaryDirectory() as d:
        archivo = os.path.join(d, "answers-cache.json")
        ac.cargar(archivo)                      # fija la persistencia (frío)
        ac.obtener_o_generar("prompt persistente", generar, timeout=5)
        assert os.path.exists(archivo)

        ac.reiniciar()                          # "reinicio del proceso"
        n = ac.cargar(archivo)
        assert n == 1
        r, m = ac.obtener_o_generar("prompt persistente", generar, timeout=5)
        assert m["hit"] is True and len(llamadas) == 1, "tras recargar, debía servir sin generar"


def test_archivo_corrupto_arranca_frio_sin_caerse():
    import tempfile
    ac.reiniciar()
    with tempfile.TemporaryDirectory() as d:
        archivo = os.path.join(d, "answers-cache.json")
        with open(archivo, "w") as f:
            f.write("esto no es json {{{")
        assert ac.cargar(archivo) == 0


def test_tope_lru_desaloja_lo_mas_viejo():
    ac.reiniciar()
    generar, _ = _contador()
    tope_original = ac.TOPE
    ac.TOPE = 3
    try:
        for i in range(5):
            ac.obtener_o_generar(f"prompt {i}", generar, timeout=5)
        st = ac.stats()
        assert st["entries"] == 3, st
        assert not ac.tiene(ac.clave_de("prompt 0"))
        assert ac.tiene(ac.clave_de("prompt 4"))
    finally:
        ac.TOPE = tope_original


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
