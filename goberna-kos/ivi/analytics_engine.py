"""AnalyticsEngine — compute comparisons, momentum, rankings, anomalies.

Pure math over KPIs. Produces an `Analysis` object:
  - period comparisons (current vs previous / vs same period last month)
  - rolling averages & momentum (slope over recent window)
  - rankings (top growth / top drop by product, sede, pais)
  - anomalies (sudden drops, outliers) with simple z-score / delta rules
  - distributions / participations (share by channel, product, sede)
"""

import re
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple
from collections import defaultdict
from datetime import date

from .kpi_engine import KPIs, SeriePoint, roas_material


@dataclass
class Comparison:
    label: str
    current: float
    previous: Optional[float]
    delta_abs: Optional[float] = None
    delta_pct: Optional[float] = None
    approx: bool = False


@dataclass
class RankingItem:
    name: str
    value: float
    delta_pct: Optional[float] = None


@dataclass
class Anomaly:
    severity: str          # "warn" | "info" | "crit"
    icon: str              # emoji-free marker token: ⚠ / 📈 / 📉
    text: str


@dataclass
class Analysis:
    comparisons: List[Comparison] = field(default_factory=list)
    rolling: Dict[str, float] = field(default_factory=dict)   # window -> avg
    momentum_pct: Optional[float] = None                      # slope recent vs prior
    trend: str = "estable"                                   # sube | baja | estable
    rankings: Dict[str, List[RankingItem]] = field(default_factory=dict)
    participations: Dict[str, List[Dict]] = field(default_factory=dict)
    anomalies: List[Anomaly] = field(default_factory=list)


def _pct(cur, prev):
    if prev in (None, 0) or cur is None:
        return None
    return round((cur - prev) / prev * 100, 1)


def _last_n(serie: List[SeriePoint], n: int) -> List[SeriePoint]:
    return serie[-n:] if len(serie) >= n else serie


def analyze(k: KPIs) -> Analysis:
    a = Analysis()

    # ── Comparisons ──
    # semana EXACTA cuando hay serie diaria; si no, la aproximación mensual->semanal.
    if k.serie_diaria:
        sem = defaultdict(lambda: {"ventas": 0, "usd": 0})
        for d in k.serie_diaria:
            try:
                dt = re.sub(r"T.*", "", d.get("dia", ""))
                y, w, _ = date.fromisoformat(dt).isocalendar()
                sem[f"{y}-S{str(w).zfill(2)}"]["ventas"] += d.get("ventas", 0) or 0
                sem[f"{y}-S{str(w).zfill(2)}"]["usd"] += d.get("ventasUsd", 0) or d.get("usd", 0) or 0
            except Exception:
                continue
        semanas = sorted(sem.items())
        if semanas:
            (lk, lv) = semanas[-1]
            (pk, pv) = semanas[-2] if len(semanas) >= 2 else (None, None)
            a.comparisons.append(Comparison(
                label=f"Última semana exacta ({lk})", current=lv["ventas"],
                previous=pv["ventas"] if pv else None,
                delta_abs=(lv["ventas"] - pv["ventas"]) if pv else None,
                delta_pct=_pct(lv["ventas"], pv["ventas"]) if pv else None,
            ))
    elif k.serie_semanal and len(k.serie_semanal) >= 2:
        w = k.serie_semanal
        a.comparisons.append(Comparison(
            label=f"Última semana ({w[-1].label}) vs previa", current=w[-1].ventas,
            previous=w[-2].ventas,
            delta_abs=w[-1].ventas - w[-2].ventas,
            delta_pct=_pct(w[-1].ventas, w[-2].ventas), approx=True,
        ))

    # Scope guard de períodos (docs/14 §5 P1): si el último mes está EN CURSO, todas
    # las comparaciones multi-mes deben usar ventanas iguales (1..cutoff vs 1..cutoff),
    # nunca un mes parcial contra uno completo — esa fue "la mentira más gorda" del
    # caso 2026-07-16 (julio 155 vs junio 339 completo ⇒ "-54%" fabricado).
    cutoff = k.cutoff_mes_parcial()
    comparable = k.serie_comparable(cutoff) if cutoff else []
    serie_para_tendencia = comparable if cutoff else k.serie_mensual

    if k.serie_mensual:
        last = k.last_month()
        prev = k.prev_month()
        if cutoff and len(comparable) >= 2:
            c_last, c_prev = comparable[-1], comparable[-2]
            a.comparisons.append(Comparison(
                label=(f"Mes actual ({last.label}) — PARCIAL, datos hasta el día {cutoff}: "
                       f"comparado contra los mismos días de {c_prev.label}"),
                current=c_last.ventas, previous=c_prev.ventas,
                delta_abs=c_last.ventas - c_prev.ventas,
                delta_pct=_pct(c_last.ventas, c_prev.ventas),
            ))
        elif last:
            a.comparisons.append(Comparison(
                label=f"Mes actual ({last.label})", current=last.ventas,
                previous=prev.ventas if prev else None,
                delta_abs=(last.ventas - prev.ventas) if prev else None,
                delta_pct=_pct(last.ventas, prev.ventas) if prev else None,
            ))
        # year-level comparison if we have >=12 months
        if len(k.serie_mensual) >= 13:
            cur = sum(s.ventas for s in k.serie_mensual[-12:])
            ant = sum(s.ventas for s in k.serie_mensual[-25:-13])
            a.comparisons.append(Comparison(
                label="Últimos 12 meses vs 12 previos", current=cur, previous=ant,
                delta_abs=cur - ant, delta_pct=_pct(cur, ant),
            ))

    # ── Forecast (honesto: si R² < 0.3 no hay tendencia real — se reporta el ritmo
    # diario ± error, nunca un total "proyectado" con falsa precisión) ──
    fc = k.forecast or {}
    if fc.get("proyeccion"):
        proj = fc["proyeccion"]
        r2 = fc.get("r2")
        if r2 is not None and r2 < 0.3 and proj:
            ritmo = round(sum(p.get("ventas", 0) or 0 for p in proj) / len(proj), 1)
            a.comparisons.append(Comparison(
                label=(f"Ritmo diario reciente (no forecast — R²={r2}, sin tendencia "
                       f"estadística): ~{ritmo}/día ± {fc.get('errorTipico')}"),
                current=ritmo, previous=None,
            ))
        else:
            a.comparisons.append(Comparison(
                label=f"Forecast próximos {len(proj)} días (pendiente {fc.get('pendiente')}/día, "
                       f"error típico ±{fc.get('errorTipico')}, R²={fc.get('r2')})",
                current=sum(p.get("ventas", 0) for p in proj), previous=None,
            ))

    # ── Rolling averages ──
    if len(serie_para_tendencia) >= 3:
        a.rolling["3m"] = round(sum(s.ventas for s in _last_n(serie_para_tendencia, 3)) / 3, 1)
    if len(serie_para_tendencia) >= 6:
        a.rolling["6m"] = round(sum(s.ventas for s in _last_n(serie_para_tendencia, 6)) / 6, 1)

    # ── Momentum / trend (sobre la serie comparable si el mes está en curso: nunca
    # promediar un mes parcial junto a meses completos) ──
    if len(serie_para_tendencia) >= 4:
        recent = sum(s.ventas for s in _last_n(serie_para_tendencia, 2)) / 2
        prior = sum(s.ventas for s in serie_para_tendencia[-4:-2]) / 2
        a.momentum_pct = _pct(recent, prior)
        if a.momentum_pct is not None:
            if a.momentum_pct > 5:
                a.trend = "sube"
            elif a.momentum_pct < -5:
                a.trend = "baja"

    # ── Rankings (growth / drop) ──
    # productos
    if k.mix_top:
        items = []
        for p in k.mix_top:
            items.append(RankingItem(name=p.get("producto", "?"),
                                    value=p.get("ventas", 0) or 0))
        a.rankings["productos_top"] = sorted(items, key=lambda x: x.value, reverse=True)[:5]

    # sedes
    if k.sedes:
        sed = [RankingItem(name=s.get("sede", "?"), value=s.get("ventas", 0) or 0,
                           delta_pct=None) for s in k.sedes]
        a.rankings["sedes_top"] = sorted(sed, key=lambda x: x.value, reverse=True)[:5]

    # paises
    if k.ventas_por_pais:
        pa = [RankingItem(name=p.get("pais", "?"), value=p.get("ventas", 0) or 0)
              for p in k.ventas_por_pais]
        a.rankings["paises_top"] = sorted(pa, key=lambda x: x.value, reverse=True)[:5]

    # ── Participations (share) ──
    if k.ventas_por_pais:
        tot = sum(p.get("ventas", 0) or 0 for p in k.ventas_por_pais) or 1
        a.participations["por_pais"] = [
            {"name": p.get("pais"), "ventas": p.get("ventas", 0) or 0,
             "share_pct": round((p.get("ventas", 0) or 0) / tot * 100, 1)}
            for p in k.ventas_por_pais
        ]
    if k.mix_top:
        tot = sum(p.get("ventas", 0) or 0 for p in k.mix_top) or 1
        a.participations["por_producto"] = [
            {"name": p.get("producto"), "ventas": p.get("ventas", 0) or 0,
             "share_pct": round((p.get("ventas", 0) or 0) / tot * 100, 1)}
            for p in k.mix_top[:8]
        ]
    # canal de interacciones accionables (del overview)
    acc = (k.overview or {}).get("accionable", {}) or {}
    por_canal = acc.get("porCanal", []) or []
    if por_canal:
        tot = sum(c.get("n", 0) or 0 for c in por_canal) or 1
        a.participations["por_canal_accionable"] = [
            {"name": c.get("canal"), "n": c.get("n", 0) or 0,
             "share_pct": round((c.get("n", 0) or 0) / tot * 100, 1)}
            for c in por_canal
        ]

    # ── Anomalies (simple rules; sobre ventanas iguales si el mes está en curso) ──
    if len(serie_para_tendencia) >= 3:
        vals = [s.ventas for s in serie_para_tendencia[-3:]]
        mean = sum(vals) / len(vals)
        last_v = serie_para_tendencia[-1].ventas
        etiqueta = " (mismos días, mes parcial)" if cutoff else ""
        if mean > 0:
            drop = (last_v - mean) / mean
            if drop < -0.15:
                a.anomalies.append(Anomaly("warn", "⚠",
                    f"Caída reciente{etiqueta}: el último mes ({last_v}) está "
                    f"{abs(round(drop*100))}% bajo el promedio de los 3 meses previos "
                    f"({round(mean)})."))
            elif drop > 0.15:
                a.anomalies.append(Anomaly("info", "📈",
                    f"Pico reciente{etiqueta}: el último mes ({last_v}) está "
                    f"{round(drop*100)}% sobre el promedio reciente ({round(mean)})."))

    # Anomalia semanal EXACTA (se a serie diaria existe)
    if k.serie_diaria and len(k.serie_diaria) >= 14:
        by_iso = defaultdict(int)
        for d in k.serie_diaria:
            try:
                y, w, _ = date.fromisoformat(str(d.get("dia", ""))[:10]).isocalendar()
                by_iso[f"{y}-S{str(w).zfill(2)}"] += d.get("ventas", 0) or 0
            except Exception:
                continue
        wk = sorted(by_iso.items())
        if len(wk) >= 2:
            cur_w, prev_w = wk[-1][1], wk[-2][1]
            if prev_w > 0:
                dw = (cur_w - prev_w) / prev_w
                if dw < -0.20:
                    a.anomalies.append(Anomaly("warn", "⚠",
                        f"Caída semanal (datos diarios exactos): esta semana {cur_w} vs "
                        f"previa {prev_w} → {round(dw*100)}%."))
                elif dw > 0.20:
                    a.anomalies.append(Anomaly("info", "📈",
                        f"Alza semanal (datos diarios exactos): esta semana {cur_w} vs "
                        f"previa {prev_w} → +{round(dw*100)}%."))

    # ── Atribución / ROAS ──
    if k.roas_por_pais:
        items = []
        for r in k.roas_por_pais:
            roas = r.get("roas")
            items.append(RankingItem(
                name=r.get("pais", "?"),
                value=roas if roas is not None else -1,
                delta_pct=None,
            ))
        a.rankings["roas_por_pais"] = sorted(
            [i for i in items if i.value >= 0], key=lambda x: x.value, reverse=True)
        tot_g = sum(r.get("gastoUsd", 0) or 0 for r in k.roas_por_pais) or 1
        a.participations["roas_por_pais"] = [
            {"name": r.get("pais"), "roas": r.get("roas"),
             "gastoUsd": r.get("gastoUsd", 0) or 0,
             "budgetSharePct": r.get("budgetSharePct"),
             "accion": r.get("accion"),
             "confianza": r.get("confianza")}
            for r in k.roas_por_pais
        ]
        # país con mejor ROAS vs peor — solo con señal material (caso Honduras:
        # USD 33 de gasto no puede encabezar la anomalía que narra el modelo).
        con_gasto = [r for r in k.roas_por_pais
                     if (r.get("gastoUsd") or 0) > 0 and roas_material(r)]
        if con_gasto:
            best = max(con_gasto, key=lambda r: (r.get("roas") or 0))
            worst = min(con_gasto, key=lambda r: (r.get("roas") or 0))
            best_roas = round(best.get("roas"), 2) if best.get("roas") is not None else "s/d"
            worst_roas = round(worst.get("roas"), 2) if worst.get("roas") is not None else "s/d"
            worst_cac = worst.get("cacVenta")
            cac_txt = f"USD {round(worst_cac, 2)}" if worst_cac is not None else "s/d"
            a.anomalies.append(Anomaly("info", "📈" if (best.get("roas") or 0) > 1 else "ℹ",
                f"Atribución: mejor ROAS en '{best.get('pais')}' ({best_roas}), "
                f"peor en '{worst.get('pais')}' ({worst_roas}). "
                f"CAC venta en peor país: {cac_txt}."))

    return a
