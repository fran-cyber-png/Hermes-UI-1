"""IntentAnalyzer — classify what the user wants, without raw keyword `if`s.

Instead of `if "ventas" in msg`, we score each known intent against the
message using weighted lexical signals (stems, synonyms, negations) and
return the ranked intents plus the dominant analysis *dimension*
(temporal / structural / attribution / risk).

The result drives the DataPlanner: each intent maps to a set of endpoints.
"""

from dataclasses import dataclass, field
from typing import List


# Intents the engine understands. Each has weighted signal tokens.
# weight > 1 means a strong discriminator; 0.5 means a weak hint.
_INTENTS = {
    "ventas":        {"venta": 2, "vendio": 1.5, "vendió": 1.5, "comercial": 1, "facturacion": 1, "compra": 1},
    "tendencia":     {"tendencia": 2, "evolucion": 2, "evolución": 2, "crecimiento": 1.5, "crece": 1.2, "sube": 1,
                       "baja": 1, "caida": 1.5, "caída": 1.5, "comporta": 1, "ritmo": 1},
    "comparacion":   {"compar": 2, "vs": 2, "versus": 2, "contra": 1, "mejor": 1, "peor": 1, "diferencia": 1.5,
                       "ranking": 1.2, "top": 1, "posicion": 1},
    "campanas":      {"campaña": 2, "campana": 2, "pauta": 1.5, "anuncio": 1.5, "ads": 1.5, "adset": 1.2,
                       "presupuesto": 1, "inversion": 1, "gasto": 0.8},
    "embudo":        {"embudo": 2, "funnel": 2, "conversion": 1.5, "convert": 1, "reembols": 1.5,
                       "anulad": 1.5, "proceso": 1, "abandon": 1},
    "tesoreria":     {"tesoreria": 2, "tesorería": 2, "voucher": 1.5, "confirmacion": 1.5, "confirmación": 1.5,
                       "latencia": 1.5, "pago tard": 1.5, "tardio": 1.2, "tardía": 1.2, "caja": 1},
    "cartera":       {"cartera": 2, "cuota": 1.5, "cobranza": 2, "moros": 1.5, "mora": 1.5, "deuda": 1.5,
                       "saldo": 1, "ltv": 1.5, "cliente valioso": 1.5, "segmento": 1},
    "productos":     {"producto": 2, "curso": 1.5, "mix": 1.5, "articulo": 1.5, "artículo": 1.5, "catalogo": 1,
                       "catálogo": 1, "lo_que_se_vende": 1, "se_vende": 1},
    "sedes":         {"sede": 2, "sucursal": 1.5, "oficina": 1, "tienda": 1, "local": 1, "casa_goberna": 1},
    "vendedores":    {"vendedor": 2, "asesor": 2, "ventas_por": 1.5, "equipo": 1, "comision": 1, "seller": 1.5},
    "leads":         {"lead": 2, "leads": 2, "prospecto": 1.5, "formulario": 1, "cold": 1, "frio": 1,
                       "sin_contactar": 1.5, "atencion": 1},
    "meta":          {"meta": 2, "facebook": 1.5, "instagram": 1.5, "whatsapp": 1, "messenger": 1},
    "capi":          {"capi": 2, "conversion": 1.2, "pixel": 1.5, "evento": 1, "reportar": 1.5, "reporte": 1,
                       "atribuc": 1.5, "lazo": 1.5},
    "atribucion":    {"atribuc": 2, "roas": 2, "cac": 1.5, "retorno": 1.5, "origen": 1, "fuente_venta": 1,
                       "canal_venta": 1},
    "rendimiento":   {"rendimiento": 2, "performance": 2, "kpi": 1.5, "indicador": 1, "metrica": 1.5,
                       "dashboard": 1, "como_vamos": 1.5, "como_estamos": 1.5},
    "forecast":      {"forecast": 2, "proyeccion": 2, "proyección": 2, "predic": 1.5, "estimar": 1.5,
                      "cuanto_vamos_a": 1.5, "meta_de": 1, "objetivo": 1},
    "anomalias":     {"anomal": 2, "raro": 1.5, "extraño": 1.5, "pico": 1.5, "outlier": 2, "inesperado": 1.5,
                       "bajo_lo_normal": 1.5, "alerta": 1.2},
    "riesgos":       {"riesgo": 2, "riesgos": 2, "problema": 1.2, "preocupa": 1.5, "vulnerab": 1.5,
                      "debil": 1.2, "amenaza": 1.5},
    "salud":         {"salud": 2, "estado_del_sistema": 1.5, "funciona": 1, "conectado": 1, "sin_cronizar": 1.5},
}

# Temporal dimension detection — drives period comparison logic.
_TEMPORAL_TOKENS = {
    "hoy": 2, "dia": 1, "día": 1, "semana": 2, "semanal": 2, "mes": 2, "mensual": 2, "trimestre": 2,
    "año": 1.5, "ano": 1.5, "anual": 1.5, "diario": 1.5, "ultimo": 1, "último": 1, "ultimos": 1,
    "últimos": 1, "ahora": 1, "actual": 1, "periodo": 1, "período": 1, "este": 1, "esta": 1,
    "rango": 1, "90d": 1, "30d": 1, "7d": 1, "reciente": 1,
}

# Which dimension a temporal question lands in (used for default comparisons).
_PERIOD_WORDS = {
    "hoy": "day", "dia": "day", "día": "day", "diario": "day",
    "semana": "week", "semanal": "week",
    "mes": "month", "mensual": "month",
    "trimestre": "quarter",
    "año": "year", "ano": "year", "anual": "year",
}


@dataclass
class IntentResult:
    intents: List[str] = field(default_factory=list)   # ranked, most likely first
    scores: dict = field(default_factory=dict)
    temporal: bool = False
    primary_period: str = "month"   # day | week | month | quarter | year
    target_month: str = ""            # "2026-07" when user asks a specific month
    target_year: str = ""            # "2026" when user asks a specific year
    relative_period: str = ""        # "month"|"week" for "este mes"/"esta semana" — resolved
                                     # against the last date of the series by prompt_builder
    is_followup: bool = False       # set by memory, not here
    raw: str = ""

    def dominant(self) -> str:
        return self.intents[0] if self.intents else "rendimiento"


def _tokenize(text: str) -> List[str]:
    # crude but sufficient: lowercase, split on non-word, strip accents-ish
    import re
    text = text.lower()
    text = re.sub(r"[áàä]", "a", text)
    text = re.sub(r"[éèë]", "e", text)
    text = re.sub(r"[íìï]", "i", text)
    text = re.sub(r"[óòö]", "o", text)
    text = re.sub(r"[úùü]", "u", text)
    text = re.sub(r"ñ", "n", text)
    return re.findall(r"[a-z0-9_]+", text)


def analyze(message: str) -> IntentResult:
    toks = _tokenize(message)
    # count token frequencies
    freq = {}
    for t in toks:
        # match on exact token or token containing a signal stem
        freq[t] = freq.get(t, 0) + 1

    scores = {}
    for intent, signals in _INTENTS.items():
        s = 0.0
        for sig, w in signals.items():
            # exact token hit
            if sig in toks:
                s += w
            else:
                # stem containment (e.g. "ventas" matches stem "venta")
                for t in toks:
                    if sig in t and len(t) >= len(sig):
                        s += w * 0.6
                        break
        if s > 0:
            scores[intent] = round(s, 2)

    # temporal detection
    tscore = 0.0
    period = "month"
    for sig, w in _TEMPORAL_TOKENS.items():
        hit = sig in toks or any(sig in t for t in toks)
        if hit:
            tscore += w
            if sig in _PERIOD_WORDS:
                period = _PERIOD_WORDS[sig]
    temporal = tscore > 0

    # ── Specific month / year extraction ──
    # Supports: "julio 2026", "2026-07", "mes de julio 2026", "julio del 26", "año 2025"
    MESES = {"enero":1,"ene":1,"febrero":2,"feb":2,"marzo":3,"mar":3,"abril":4,"abr":4,
             "mayo":5,"may":5,"junio":6,"jun":6,"julio":7,"jul":7,"agosto":8,"ago":8,
             "setiembre":9,"sep":9,"septiembre":9,"octubre":10,"oct":10,"noviembre":11,"nov":11,
             "diciembre":12,"dic":12}
    target_month = ""
    target_year = ""
    # explicit YYYY-MM
    import re as _re
    m = _re.search(r"(20\d{2})[-/](\d{1,2})", message)
    if m:
        target_year = m.group(1)
        target_month = f"{target_year}-{int(m.group(2)):02d}"
    else:
        # month name + year (year may be 2 or 4 digits, optional)
        yr = _re.search(r"(20\d{2}|\d{2})", message)
        for name, num in MESES.items():
            if name in toks or name in message.lower():
                if yr:
                    yy = yr.group(1)
                    target_year = "20" + yy[-2:] if len(yy) == 2 else yy
                    target_month = f"{target_year}-{num:02d}"
                else:
                    target_month = f"MM-{num:02d}"   # month known, year unknown
                break
    # year-only mention
    if not target_year:
        y2 = _re.search(r"\b(20\d{2})\b", message)
        if y2:
            target_year = y2.group(1)

    # ── Relative period ("este mes", "esta semana") ──
    # No explicit month given: mark it relative so prompt_builder resolves it
    # against the LAST date of the series instead of asking for clarification.
    relative_period = ""
    if not target_month:
        norm = " ".join(toks)
        if _re.search(r"\beste mes\b|\bmes (actual|en curso|presente)\b", norm):
            relative_period = "month"
        elif _re.search(r"\besta semana\b|\bsemana (actual|en curso)\b", norm):
            relative_period = "week"

    ranked = sorted(scores.items(), key=lambda kv: kv[1], reverse=True)
    intents = [i for i, _ in ranked]

    # Fallback: if nothing matched, treat as a general commercial/rendimiento query.
    if not intents:
        intents = ["rendimiento"]
        scores = {"rendimiento": 1.0}

    return IntentResult(
        intents=intents,
        scores=scores,
        temporal=temporal,
        primary_period=period,
        target_month=target_month,
        target_year=target_year,
        relative_period=relative_period,
        raw=message,
    )
