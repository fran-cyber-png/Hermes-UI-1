"""DataCollector — fetch the planned endpoints, normalize, merge.

Runs the fetches in parallel (thread pool), each guarded by the TTL cache
so a single request never hits the same endpoint twice and repeated
requests within the TTL are free. Produces a single `RawData` object that
the KPI / Analytics engines consume.
"""

import json
import urllib.request
import concurrent.futures
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from .config import BACKEND, CACHE_TTL
from .cache import get, put
from .data_planner import ENDPOINTS


@dataclass
class RawData:
    overview: Dict = field(default_factory=dict)
    comercial: Dict = field(default_factory=dict)
    cartera: Dict = field(default_factory=dict)
    lazo: Dict = field(default_factory=dict)
    tesoreria: Dict = field(default_factory=dict)
    salud: Dict = field(default_factory=dict)
    atribucion: Dict = field(default_factory=dict)
    endpoints_hit: List[str] = field(default_factory=list)
    errors: List[str] = field(default_factory=list)
    frescura: Dict[str, str] = field(default_factory=dict)

    _SLOT = {
        "overview": "overview", "comercial": "comercial", "cartera": "cartera",
        "lazo": "lazo", "tesoreria": "tesoreria", "salud": "salud",
        "atribucion": "atribucion",
    }

    def slot(self, name: str) -> Dict:
        return getattr(self, self._SLOT[name])


def _fetch(name: str) -> Any:
    path = ENDPOINTS[name]["path"]
    url = f"{BACKEND}{path}"
    cached = get(url, CACHE_TTL)
    if cached is not None:
        return cached
    try:
        req = urllib.request.Request(url, headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode())
        put(url, data, CACHE_TTL)
        return data
    except Exception as e:  # network / timeout / 5xx
        return {"_error": str(e)}


def _frescura(raw: RawData) -> Dict[str, str]:
    """"Datos hasta el D", derivado SOLO de lo que ya se trajo — sin fetches nuevos.
    Nadie más en el pipeline calculaba esto (docs/14 §4): el modelo narraba datos
    con días de rezago en presente porque nadie se lo decía."""
    out: Dict[str, str] = {}
    diaria = (raw.comercial or {}).get("diaria") or []
    dias = [str(d.get("dia", ""))[:10] for d in diaria if d.get("dia")]
    if dias:
        out["ventas"] = f"datos de ventas hasta el {max(dias)}"
    for pieza in (raw.salud or {}).get("piezas") or []:
        clave = pieza.get("clave")
        if clave in ("cerberus", "meta_ingesta") and pieza.get("detalle"):
            out[clave] = pieza["detalle"]
    return out


def collect(plan: List[str]) -> RawData:
    raw = RawData()
    # Parallel fetch, one slot per endpoint.
    with concurrent.futures.ThreadPoolExecutor(max_workers=len(plan) or 1) as ex:
        fut = {ex.submit(_fetch, n): n for n in plan}
        for f in concurrent.futures.as_completed(fut):
            name = fut[f]
            try:
                data = f.result()
            except Exception as e:
                raw.errors.append(f"{name}: {e}")
                continue
            if isinstance(data, dict) and data.get("_error"):
                raw.errors.append(f"{name}: {data['_error']}")
                continue
            setattr(raw, RawData._SLOT[name], data or {})
            raw.endpoints_hit.append(name)
    raw.frescura = _frescura(raw)
    return raw
