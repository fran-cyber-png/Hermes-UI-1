"""KPIEngine — derive concrete metrics from RawData.

EVERY number Ivi reports is computed here, never by the LLM.
The backend exposes a MONTHLY sales series (`comercial.serie`) plus
pre-aggregated totals. There is no daily/weekly endpoint, so sub-month
periods (week) are APPROXIMATED by distributing each month's sales across
its calendar days. This is flagged as an approximation wherever used.

Produces a `KPIs` object consumed by the AnalyticsEngine.
"""

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple
from calendar import monthrange
from datetime import date

from .data_collector import RawData


@dataclass
class SeriePoint:
    label: str          # "2026-05" or "2026-S18"
    ventas: int
    usd: int
    approx: bool = False


def _dia_de(dia_str: str) -> Optional[int]:
    try:
        return date.fromisoformat(str(dia_str)[:10]).day
    except Exception:
        return None


def _dias_en_mes(mes: str) -> Optional[int]:
    try:
        y, m = (int(x) for x in mes.split("-"))
        return monthrange(y, m)[1]
    except Exception:
        return None


def dias_presentes(serie_diaria: List[Dict], mes: str) -> List[int]:
    """Días (1..31) de `mes` ('YYYY-MM') presentes en serie_diaria."""
    out = []
    for d in serie_diaria:
        dia_s = str(d.get("dia", ""))
        if not dia_s.startswith(mes):
            continue
        n = _dia_de(dia_s)
        if n:
            out.append(n)
    return out


def suma_hasta_dia(serie_diaria: List[Dict], mes: str, hasta_dia: int) -> Tuple[int, int]:
    """Suma ventas/usd de `mes` para los días 1..hasta_dia (ventana igualada)."""
    ventas = usd = 0
    for d in serie_diaria:
        dia_s = str(d.get("dia", ""))
        if not dia_s.startswith(mes):
            continue
        n = _dia_de(dia_s)
        if n is not None and n <= hasta_dia:
            ventas += d.get("ventas", 0) or 0
            usd += d.get("ventasUsd", 0) or d.get("usd", 0) or 0
    return ventas, usd


@dataclass
class KPIs:
    # totals (from overview.lazo + comercial.embudo)
    ventas_conocidas: Optional[int] = None
    ventas_reportadas_meta: Optional[int] = None
    ventas_perdidas_ventana: Optional[int] = None
    total_ventas_cobradas: Optional[int] = None
    total_usd_cobradas: Optional[int] = None

    # serie
    serie_mensual: List[SeriePoint] = field(default_factory=list)
    serie_semanal: List[SeriePoint] = field(default_factory=list)  # approximated

    # ticket
    ticket_promedio_usd: Optional[float] = None

    # mix / embudo / latencia / sedes / cartera / lazo
    mix_top: List[Dict] = field(default_factory=list)
    embudo: Dict = field(default_factory=dict)
    latencia: Dict = field(default_factory=dict)
    sedes: List[Dict] = field(default_factory=list)
    cartera: Dict = field(default_factory=dict)
    lazo: Dict = field(default_factory=dict)
    ventas_por_pais: List[Dict] = field(default_factory=list)
    overview: Dict = field(default_factory=dict)

    # series exactas (backend) + forecast + atribucion
    serie_diaria: List[Dict] = field(default_factory=list)   # [{dia,ventas,usd}] exacto
    forecast: Dict = field(default_factory=dict)            # {pendiente, proyeccion, errorTipico, r2}
    roas_por_pais: List[Dict] = field(default_factory=list)

    # frescura ("datos hasta el D" por fuente) — la calcula data_collector, sin fetches nuevos
    frescura: Dict[str, str] = field(default_factory=dict)

    def last_month(self) -> Optional[SeriePoint]:
        return self.serie_mensual[-1] if self.serie_mensual else None

    def prev_month(self) -> Optional[SeriePoint]:
        return self.serie_mensual[-2] if len(self.serie_mensual) >= 2 else None

    def cutoff_mes_parcial(self) -> Optional[int]:
        """Si el último mes de `serie_mensual` está EN CURSO (la serie diaria no llega
        a fin de mes), devuelve el último día con datos. None si el mes está completo
        o no hay serie diaria para verificarlo — nunca asume, solo lee la base."""
        last = self.last_month()
        if not last or not self.serie_diaria:
            return None
        dias = dias_presentes(self.serie_diaria, last.label)
        if not dias:
            return None
        cutoff = max(dias)
        total = _dias_en_mes(last.label)
        if total is None or cutoff >= total:
            return None
        return cutoff

    def serie_comparable(self, cutoff: int) -> List[SeriePoint]:
        """`serie_mensual` re-alineada: cada mes sumado SOLO días 1..cutoff (mismas
        ventanas), usando serie_diaria. Se detiene en el primer mes sin cobertura
        diaria suficiente — nunca inventa un número para igualar la ventana."""
        out: List[SeriePoint] = []
        for sp in reversed(self.serie_mensual):
            dias = dias_presentes(self.serie_diaria, sp.label)
            if not dias or max(dias) < cutoff:
                break
            ventas, usd = suma_hasta_dia(self.serie_diaria, sp.label, cutoff)
            out.append(SeriePoint(label=sp.label, ventas=ventas, usd=usd))
        out.reverse()
        return out


def _week_key(mes: str, day: int) -> Optional[str]:
    try:
        d = date.fromisoformat(f"{mes}-{day:02d}")
    except Exception:
        return None
    y, w, _ = d.isocalendar()
    return f"{y}-S{str(w).zfill(2)}"


def _monthly_to_weekly(serie: List[Dict]) -> List[SeriePoint]:
    from collections import defaultdict
    by_week: Dict[str, dict] = defaultdict(lambda: {"ventas": 0, "usd": 0})
    for row in serie:
        mes = row.get("mes")
        ventas = row.get("ventas", 0) or 0
        usd = row.get("ventasUsd", 0) or 0
        if not mes:
            continue
        try:
            y, m = (int(x) for x in mes.split("-"))
            dias = monthrange(y, m)[1]
        except Exception:
            continue
        pesos: Dict[str, int] = defaultdict(int)
        tot = 0
        for d in range(1, dias + 1):
            wk = _week_key(mes, d)
            if wk:
                pesos[wk] += 1
                tot += 1
        if not tot:
            continue
        for wk, p in pesos.items():
            f = p / tot
            by_week[wk]["ventas"] += round(ventas * f)
            by_week[wk]["usd"] += round(usd * f)
    return [SeriePoint(label=k, ventas=v["ventas"], usd=v["usd"], approx=True)
            for k, v in sorted(by_week.items())]


def compute(raw: RawData) -> KPIs:
    k = KPIs()

    lazo = raw.overview.get("lazo", {})
    k.ventas_conocidas = lazo.get("ventasConocidas")
    k.ventas_reportadas_meta = lazo.get("reportadas")
    k.ventas_perdidas_ventana = lazo.get("perdidasPorVentana")

    comer = raw.comercial
    if comer:
        serie = comer.get("serie", []) or []
        k.serie_mensual = [SeriePoint(label=r.get("mes"), ventas=r.get("ventas", 0) or 0,
                                       usd=r.get("ventasUsd", 0) or 0) for r in serie]
        k.serie_semanal = _monthly_to_weekly(serie)

        emb = comer.get("embudo", {}) or {}
        k.embudo = emb
        if emb.get("cobradas"):
            k.total_ventas_cobradas = emb.get("cobradas")
            k.total_usd_cobradas = None  # not provided directly; derived below if possible

        # ticket promedio: mejor del mix (por producto) o global si hay totales
        mix = comer.get("mix", []) or []
        k.mix_top = mix[:10]
        if mix:
            # ticket global aproximado: suma usd mix / suma ventas mix
            su = sum(p.get("usd", 0) or 0 for p in mix)
            sv = sum(p.get("ventas", 0) or 0 for p in mix)
            if sv:
                k.ticket_promedio_usd = round(su / sv, 2)

        k.latencia = comer.get("latencia", {}) or {}
        k.sedes = comer.get("sedes", []) or []
        # serie diaria EXACTA (backend) -> reemplaza la aproximación semanal cuando existe
        k.serie_diaria = comer.get("diaria", []) or []
        k.forecast = comer.get("forecast", {}) or {}

    # total USD cobradas: de la serie mensual (suma) si no hay otro total
    if k.total_usd_cobradas is None and k.serie_mensual:
        k.total_usd_cobradas = sum(s.usd for s in k.serie_mensual)

    # cartera
    if raw.cartera:
        k.cartera = raw.cartera

    # lazo detalle
    if raw.lazo:
        k.lazo = raw.lazo

    # ventas por pais (del overview)
    vp = raw.overview.get("ventas", []) or []
    k.ventas_por_pais = vp
    k.overview = raw.overview

    # atribucion / ROAS
    attr = raw.atribucion or {}
    if attr.get("disponible") and attr.get("roasPais"):
        k.roas_por_pais = attr["roasPais"]

    k.frescura = raw.frescura

    return k
