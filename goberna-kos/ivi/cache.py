"""cache — short-TTL in-memory cache keyed by endpoint URL.

Avoids hammering Postgres for slow-moving mirror data and prevents
duplicate fetches inside a single request (the collector fetches each
endpoint at most once, and across requests within TTL seconds it is free).
"""

import time
from typing import Any, Dict, Optional

_CACHE: Dict[str, tuple] = {}  # key -> (expires_at, value)


def get(key: str, ttl: int) -> Optional[Any]:
    item = _CACHE.get(key)
    if item is None:
        return None
    expires, value = item
    if time.time() > expires:
        _CACHE.pop(key, None)
        return None
    return value


def put(key: str, value: Any, ttl: int) -> None:
    _CACHE[key] = (time.time() + ttl, value)


def clear() -> None:
    _CACHE.clear()
