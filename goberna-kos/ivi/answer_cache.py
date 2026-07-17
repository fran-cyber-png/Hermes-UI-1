"""answer_cache — P1 (docs/19): la respuesta como función pura de (pregunta, datos).

Clave = sha256(prompt). El prompt ya es el colapso puro de TODO lo que importa
(pregunta literal, intents, período, scope de follow-up, frescura y cada número
servido): si el prompt es byte-idéntico, la respuesta es semánticamente
idéntica → se sirve la cacheada.

Invalidación POR CONSTRUCCIÓN, sin TTL: cambia un dato → cambia el prompt →
cambia el hash → regenera. Cambia el motor (P3/P4 tocan el texto del prompt) →
invalida solo. Cero riesgo de servir viejo — la lección de docs/18.

Single-flight: dos preguntas idénticas concurrentes = UNA llamada al modelo;
la segunda espera el resultado de la primera (Event por clave, con timeout).

LRU acotada (~200) + persistencia a disco (tmp + os.replace, se carga al
arrancar): con systemd reviviendo el proceso, la calidez sobrevive reinicios.
"""

import hashlib
import json
import logging
import os
import threading
import time
from collections import OrderedDict
from datetime import datetime
from typing import Callable, Dict, Optional, Tuple

log = logging.getLogger("ivi")

TOPE = 200

_LOCK = threading.RLock()
_CACHE: "OrderedDict[str, dict]" = OrderedDict()   # clave -> {"respuesta", "creado"}
_EN_VUELO: Dict[str, threading.Event] = {}
_HITS = 0
_MISSES = 0
_ARCHIVO: Optional[str] = None


def clave_de(prompt: str) -> str:
    return hashlib.sha256(prompt.encode("utf-8")).hexdigest()


def tiene(clave: str) -> bool:
    """Mirar sin tocar stats ni orden LRU (para el warmer)."""
    with _LOCK:
        return clave in _CACHE


def stats() -> Dict[str, int]:
    with _LOCK:
        return {"entries": len(_CACHE), "hits": _HITS, "misses": _MISSES}


def obtener_o_generar(prompt: str, generar: Callable[[], str],
                      timeout: float) -> Tuple[str, dict]:
    """Hit → (respuesta cacheada, {hit:True}). Miss → genera UNA vez (single-
    flight), guarda, persiste y devuelve. Si el líder falla, su excepción sube
    y un seguidor puede tomar el liderazgo en el siguiente intento."""
    global _MISSES
    clave = clave_de(prompt)
    while True:
        with _LOCK:
            item = _CACHE.get(clave)
            if item is not None:
                global _HITS
                _CACHE.move_to_end(clave)
                _HITS += 1
                return item["respuesta"], {"hit": True, "creado": item["creado"]}
            ev = _EN_VUELO.get(clave)
            if ev is None:
                ev = threading.Event()
                _EN_VUELO[clave] = ev
                _MISSES += 1
                break  # este thread lidera la generación
        # seguidor: esperar al líder y volver a mirar el caché
        if not ev.wait(timeout):
            raise TimeoutError(f"single-flight: la generación en vuelo no terminó en {timeout}s")

    try:
        respuesta = generar()
    except BaseException:
        with _LOCK:
            _EN_VUELO.pop(clave, None)
        ev.set()  # despertar seguidores: verán el caché vacío y reintentarán
        raise

    creado = datetime.now().isoformat(timespec="seconds")
    with _LOCK:
        _CACHE[clave] = {"respuesta": respuesta, "creado": creado}
        _CACHE.move_to_end(clave)
        while len(_CACHE) > TOPE:
            _CACHE.popitem(last=False)
        _EN_VUELO.pop(clave, None)
    ev.set()
    _persistir()
    return respuesta, {"hit": False, "creado": creado}


def cargar(archivo: str) -> int:
    """Cargar el caché persistido (si existe) y fijar el archivo de persistencia."""
    global _ARCHIVO
    _ARCHIVO = archivo
    try:
        with open(archivo, encoding="utf-8") as f:
            data = json.load(f)
        entradas = data.get("entradas", [])
        with _LOCK:
            for clave, item in entradas[-TOPE:]:
                if isinstance(item, dict) and "respuesta" in item:
                    _CACHE[clave] = item
            n = len(_CACHE)
        log.info("answer_cache: %d respuestas tibias cargadas de %s", n, archivo)
        return n
    except FileNotFoundError:
        return 0
    except Exception as e:  # archivo corrupto: arrancar frío, jamás caerse
        log.warning("answer_cache: no se pudo cargar %s (%s) — arranco frío", archivo, e)
        return 0


def _persistir() -> None:
    if _ARCHIVO is None:
        return
    with _LOCK:
        entradas = list(_CACHE.items())
    tmp = f"{_ARCHIVO}.tmp"
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump({"version": 1, "entradas": entradas}, f, ensure_ascii=False)
        os.replace(tmp, _ARCHIVO)
    except Exception as e:  # disco lleno / permisos: el caché en memoria sigue sirviendo
        log.warning("answer_cache: no se pudo persistir a %s: %s", _ARCHIVO, e)


def reiniciar() -> None:
    """Solo para tests: estado de fábrica."""
    global _HITS, _MISSES, _ARCHIVO
    with _LOCK:
        _CACHE.clear()
        _EN_VUELO.clear()
        _HITS = 0
        _MISSES = 0
        _ARCHIVO = None
