"""KPIEngine — derive concrete metrics from RawData.

EVERY number Ivi reports is computed here, never by the LLM.
The backend exposes a MONTHLY sales series (`comercial.serie`) plus
pre-aggregated totals. There is no daily/weekly endpoint, so sub-month
periods (week) are APPROXIMATED by distributing each month's sales across
its calendar days. This is flagged as an approximation wherever used.

Produces a `KPIs` object consumed by the AnalyticsEngine.
"""

from dataclasses import dataclass, field
from typing import Dict, List, Optional
from calendar import monthrange
from datetime import date

from .data_collector import RawData


@dataclass
class SeriePoint:
    label: str          # "2026-05" or "2026-S18"
    ventas: int
    usd: int
    approx: bool = False


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

    def last_month(self) -> Optional[SeriePoint]:
        return self.serie_mensual[-1] if self.serie_mensual else None

    def prev_month(self) -> Optional[SeriePoint]:
        return self.serie_mensual[-2] if len(self.serie_mensual) >= 2 else None


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

    return k
