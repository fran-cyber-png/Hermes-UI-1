"""warmer — P2 (docs/19): la inferencia en background.

Cuando aterriza un dump nuevo de Cerberus, los números cambian → los prompts
de las preguntas frecuentes cambian → sus hashes ya no están en el caché → el
warmer las re-piensa SOLO, antes de que nadie pregunte. Con datos sin cambios
el poll es gratis: collect() está cacheado (TTL 60s) y el hash da hit.

Corre en un thread daemon: warm inicial ~10s después de arrancar (reemplaza
el rol del KEEP_ALIVE: el modelo queda cargado porque SE USA), después un
tick cada WARM_INTERVAL. De a UNA generación con pausa entre cada una — los
otros slots de Ollama quedan libres para usuarios en vivo. Sin sesión y sin
remember(): no contamina la memoria conversacional.
"""

import logging
import threading
import time
from typing import Callable, List

from . import answer_cache

log = logging.getLogger("ivi")


def calentar_una_vez(preguntas: List[str],
                     armar_prompt: Callable[[str], str],
                     generar: Callable[[str], str],
                     pausa: float,
                     timeout: float) -> dict:
    """Una pasada por las preguntas frecuentes. Devuelve el conteo para el log.
    Un fallo (Ollama caído, backend sin datos) no corta las demás."""
    nuevas = tibias = fallos = 0
    for pregunta in preguntas:
        try:
            prompt = armar_prompt(pregunta)
            if answer_cache.tiene(answer_cache.clave_de(prompt)):
                tibias += 1
                continue
            answer_cache.obtener_o_generar(prompt, lambda p=prompt: generar(p), timeout)
            nuevas += 1
            if pausa:
                time.sleep(pausa)
        except Exception as e:
            fallos += 1
            log.warning("warm fallo %r: %s", pregunta, e)
    log.info("warm ok %d/%d — %d nuevas · %d ya tibias · %d fallos",
             nuevas + tibias, len(preguntas), nuevas, tibias, fallos)
    return {"nuevas": nuevas, "tibias": tibias, "fallos": fallos}


def arrancar_warmer(preguntas: List[str],
                    armar_prompt: Callable[[str], str],
                    generar: Callable[[str], str],
                    intervalo: float,
                    pausa: float,
                    timeout: float) -> threading.Thread:
    def loop():
        time.sleep(10)  # dejar que el server termine de levantar
        while True:
            try:
                calentar_una_vez(preguntas, armar_prompt, generar, pausa, timeout)
            except Exception as e:  # jamás matar el thread del warmer
                log.warning("warm pasada abortada: %s", e)
            time.sleep(intervalo)

    t = threading.Thread(target=loop, daemon=True, name="warmer")
    t.start()
    return t
