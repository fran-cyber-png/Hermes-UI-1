"""memory — minimal conversational context for follow-up questions.

Ivi must remember what the previous turn was about so a follow-up like
"¿y solo Lima?" can resolve against the prior scope without re-asking.
This is an in-session store keyed by a client/session id (here: a single
global session is enough for the local chat; the API accepts a `session`
field to extend it later).
"""

import threading
from dataclasses import dataclass, field
from typing import Dict, List, Optional

from .intent_analyzer import IntentResult
from .config import PREGUNTAS_SUGERIDAS, PREGUNTAS_STUDIO

# Los botones de la UI y las chips del estudio mandan estas preguntas VERBATIM.
# Son temas nuevos completos, jamás un acotamiento del turno anterior — sin esta
# lista, el segundo botón de una sesión se marcaba follow-up (≤4 palabras), ganaba
# scope_note, cambiaba el prompt y el caché del warmer no servía de nada. El pool
# del estudio (Fase B) TIENE que estar acá por el mismo motivo: sin él, la segunda
# chip de datos de una sesión hace cache miss y encima se enmarca como follow-up.
_CANONICAS = {q.lower().strip() for q in PREGUNTAS_SUGERIDAS + PREGUNTAS_STUDIO}


@dataclass
class Turn:
    intent: IntentResult
    filters: Dict[str, str] = field(default_factory=dict)   # e.g. {"pais":"PE","sede":"Lima"}
    scope: str = ""                                          # human description of scope
    question: str = ""


@dataclass
class Session:
    last: Optional[Turn] = None
    history: List[Turn] = field(default_factory=list)


_SESSIONS: Dict[str, Session] = {}

# Con OLLAMA_NUM_PARALLEL=4 hay 4 requests reales mutando este dict a la vez.
# RLock (no Lock): apply_followup_filters llama a get_session ya con el lock tomado.
_LOCK = threading.RLock()

# El sid lo genera el navegador (localStorage), así que es entrada del cliente:
# sin tope, un cliente que rote sids infla el dict sin límite. Al llegar al tope
# se desaloja la sesión creada hace más tiempo (orden de inserción del dict);
# esa conversación solo pierde sus follow-ups, no rompe nada.
_MAX_SESSIONS = 200


def get_session(sid: str = "default") -> Session:
    with _LOCK:
        if sid not in _SESSIONS and len(_SESSIONS) >= _MAX_SESSIONS:
            _SESSIONS.pop(next(iter(_SESSIONS)))
        return _SESSIONS.setdefault(sid, Session())


def remember(sid: str, turn: Turn) -> None:
    with _LOCK:
        s = get_session(sid)
        s.history.append(turn)
        s.last = turn
        # keep history bounded
        if len(s.history) > 12:
            s.history = s.history[-12:]


# Common follow-up cues that mean "re-do last analysis under a narrower filter".
_FOLLOWUP = ["solo", "y ", "pero", "en ", "por ", "de ", "solo en", "y lima", "y solo"]


def is_followup(message: str, sid: str = "default") -> bool:
    with _LOCK:
        s = get_session(sid)
        if not s.last:
            return False
    m = message.lower().strip()
    if m in _CANONICAS:
        return False
    # short messages that are not a fresh full question
    if len(m.split()) <= 4 and not any(
        w in m for w in ["cuanto", "cuánto", "ventas totales", "resumen", "hola", "gracias"]
    ):
        return True
    return False


def apply_followup_filters(message: str, sid: str = "default") -> Dict[str, str]:
    """Extract a narrowing filter from a follow-up (e.g. 'solo Lima' -> sede=Lima)."""
    filters: Dict[str, str] = {}
    m = message.lower()
    # sede / ciudad
    for ciudad, key in [("lima", "Lima"), ("arequipa", "Arequipa"), ("cusco", "Cusco"),
                         ("trujillo", "Trujillo"), ("peru", "Perú"), ("pe", "Perú"),
                         ("mx", "México"), ("mexico", "México"), ("ecuador", "Ecuador")]:
        if ciudad in m:
            # decide if it's sede or pais by prior scope
            with _LOCK:
                last = get_session(sid).last
            filters["sede" if "sede" in (last.scope if last else "") else "pais"] = key
            break
    return filters
