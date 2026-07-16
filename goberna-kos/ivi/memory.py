"""memory — minimal conversational context for follow-up questions.

Ivi must remember what the previous turn was about so a follow-up like
"¿y solo Lima?" can resolve against the prior scope without re-asking.
This is an in-session store keyed by a client/session id (here: a single
global session is enough for the local chat; the API accepts a `session`
field to extend it later).
"""

from dataclasses import dataclass, field
from typing import Dict, List, Optional

from .intent_analyzer import IntentResult


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


def get_session(sid: str = "default") -> Session:
    return _SESSIONS.setdefault(sid, Session())


def remember(sid: str, turn: Turn) -> None:
    s = get_session(sid)
    s.history.append(turn)
    s.last = turn
    # keep history bounded
    if len(s.history) > 12:
        s.history = s.history[-12:]


# Common follow-up cues that mean "re-do last analysis under a narrower filter".
_FOLLOWUP = ["solo", "y ", "pero", "en ", "por ", "de ", "solo en", "y lima", "y solo"]


def is_followup(message: str, sid: str = "default") -> bool:
    s = get_session(sid)
    if not s.last:
        return False
    m = message.lower().strip()
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
            filters["sede" if "sede" in (get_session(sid).last.scope if get_session(sid).last else "") else "pais"] = key
            break
    return filters
