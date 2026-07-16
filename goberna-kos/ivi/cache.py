"""cache — short-TTL in-memory cache keyed by endpoint URL.

Avoids hammering Postgres for slow-moving mirror data and prevents
duplicate fetches inside a single request (the collector fetches each
endpoint at most once, and across requests within TTL seconds it is free).
"""

import threading
import time
from typing import Any, Dict, Optional

_CACHE: Dict[str, tuple] = {}  # key -> (expires_at, value)

# El collector hace los fetches con un ThreadPoolExecutor y el server atiende
# requests en threads: el dict y los contadores se tocan concurrentemente.
_LOCK = threading.Lock()
_HITS = 0
_MISSES = 0


def get(key: str, ttl: int) -> Optional[Any]:
    global _HITS, _MISSES
    with _LOCK:
        item = _CACHE.get(key)
        if item is None:
            _MISSES += 1
            return None
        expires, value = item
        if time.time() > expires:
            _CACHE.pop(key, None)
            _MISSES += 1
            return None
        _HITS += 1
        return value


def put(key: str, value: Any, ttl: int) -> None:
    with _LOCK:
        _CACHE[key] = (time.time() + ttl, value)


def stats() -> Dict[str, int]:
    """Contadores acumulados del proceso, para /api/health."""
    with _LOCK:
        return {"entries": len(_CACHE), "hits": _HITS, "misses": _MISSES}


def clear() -> None:
    global _HITS, _MISSES
    with _LOCK:
        _CACHE.clear()
        _HITS = 0
        _MISSES = 0
