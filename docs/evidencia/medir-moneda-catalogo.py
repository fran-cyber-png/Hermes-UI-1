#!/usr/bin/env python3
"""¿En qué moneda están `precio_normal` y `precio_promocion` de `tb_producto`?

La evidencia detrás de `docs/moneda-fuentes-afectadas.md` §2.4 (v2). La v1 lo
afirmaba por el NOMBRE de tres campos vecinos; Cerberus se contradice a sí mismo
sobre esas dos columnas (`products/views.py:1233-1234` las rotula `S/`), así que
hacía falta medirlo.

LA PRUEBA
    `tb_detalleVenta` guarda el precio unitario que se cobró y `tb_venta` guarda
    su moneda. Si el catálogo estuviera en moneda local, el unitario de una venta
    en PEN se parecería al precio de catálogo. Si estuviera en USD, se parecería
    al precio de catálogo × el multiplicador de esa moneda.

LOS DATOS
    El volcado histórico versionado en `ceberusapp/csv/extracted_from_xlsx/` — la
    exportación del sistema pre-Django. Es real, pero NO es la base de hoy: sirve
    para probar la convención, no para contar filas de producción (§5).

USO
    python3 docs/evidencia/medir-moneda-catalogo.py [ruta a ceberusapp]

Read-only: no abre red, no toca ninguna base, no escribe nada.
"""

import csv
import sys
from collections import defaultdict
from pathlib import Path
from statistics import median

RAIZ = Path(sys.argv[1] if len(sys.argv) > 1 else "../ceberusapp").expanduser()
BASE = RAIZ / "csv" / "extracted_from_xlsx"
DV = BASE / "Detalle_Venta" / "sheets"
PRODUCTOS = BASE / "Categoria" / "sheets" / "01__Producto.csv"

#: Tolerancia para «cae exacto sobre este candidato». 2 % absorbe el redondeo a
#: dos decimales de la conversión sin llegar a confundir 1× con ningún multiplicador.
TOL = 0.02


def num(s):
    try:
        return float(s)
    except (TypeError, ValueError):
        return None


def leer(path):
    if not path.exists():
        sys.exit(f"No encuentro {path}.\nPasá la ruta a ceberusapp: {sys.argv[0]} /ruta/a/ceberusapp")
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


monedas = {
    r["Codigo Moneda"]: (r["Nombre Moneda"], num(r["Radio Divisor"]), num(r["Radio Multiplicador"]))
    for r in leer(DV / "05__Moneda.csv")
    if r["Codigo Moneda"]
}
productos = {
    r["ID Producto"]: (num(r["Precio_Normal"]), num(r["Precio_Promocion"]))
    for r in leer(PRODUCTOS)
    if r["ID Producto"]
}
ventas_csv = leer(DV / "01__Ventas.csv")
ventas = {r["ID Venta"]: r["Codigo Moneda"] for r in ventas_csv if r["ID Venta"]}


# ── 1. ¿divisor × multiplicador == 1 en las filas ya congeladas? ─────────────
def coherencia_de_los_radios():
    n = mayor_1 = mayor_2 = mayor_5 = 0
    peor = (0.0, None)
    for r in ventas_csv:
        if not r["ID Venta"]:
            continue
        d, m = num(r["Radio Divisor"]), num(r["Radio Multiplicador"])
        if not d or not m:
            continue
        n += 1
        desvio = abs(d * m - 1) * 100
        mayor_1 += desvio > 1
        mayor_2 += desvio > 2
        mayor_5 += desvio > 5
        if desvio > peor[0]:
            peor = (desvio, (r["Folio"], monedas.get(r["Codigo Moneda"], ("?",))[0], d, m))
    print("== agujero A, en filas reales: los radios CONGELADOS en cada venta ==")
    print(f"  ventas con los dos radios congelados: {n}")
    print(f"  desvío |divisor × multiplicador − 1|  > 1 %: {mayor_1}   > 2 %: {mayor_2}   > 5 %: {mayor_5}")
    print(f"  peor caso: folio {peor[1][0]} ({peor[1][1]}) divisor={peor[1][2]} multiplicador={peor[1][3]} → {peor[0]:.2f} %")


# ── 2. ¿cuántas ventas no tienen radio, y de qué moneda son? ────────────────
def ventas_sin_radio():
    por_moneda = defaultdict(lambda: [0, 0])
    total = sin = 0
    for r in ventas_csv:
        if not r["ID Venta"]:
            continue
        nom = monedas.get(r["Codigo Moneda"], ("?",))[0]
        total += 1
        por_moneda[nom][0] += 1
        if num(r["Radio Multiplicador"]) is None:
            sin += 1
            por_moneda[nom][1] += 1
    print()
    print("== el «36 % sin radio»: ¿de qué moneda es? ==")
    print(f"  ventas: {total}   sin radio_multiplicador: {sin} ({sin / total * 100:.1f} %)")
    print("  moneda  ventas  sin radio")
    for nom, (n, s) in sorted(por_moneda.items(), key=lambda kv: -kv[1][0]):
        print(f"  {nom:6}  {n:<7} {s}")
    no_usd = sum(s for nom, (_, s) in por_moneda.items() if nom != "USD")
    print(f"  → de las ventas SIN radio, solo {no_usd} son de moneda ≠ USD (las USD no necesitan tasa).")


# ── 3. la pregunta del título ───────────────────────────────────────────────
def moneda_del_catalogo():
    razones_n, razones_p = defaultdict(list), defaultdict(list)
    exacto_normal, exacto_promo = defaultdict(int), defaultdict(int)
    igual_catalogo = catalogo_por_mult = ninguno = 0

    for r in leer(DV / "02__Detalle_Venta.csv"):
        v, p = r["Codigo Venta"], r["Codigo Producto"]
        if v not in ventas or p not in productos or ventas[v] not in monedas:
            continue
        nom, _, mul = monedas[ventas[v]]
        if nom == "USD" or not mul:
            continue
        unit = num(r["Precio Unitario"])
        pn, pp = productos[p]
        if not unit:
            continue
        if pn:
            razones_n[nom].append(unit / pn)
            if abs(unit - pn * mul) <= TOL * pn * mul:
                exacto_normal[nom] += 1
        if pp:
            razones_p[nom].append(unit / pp)
            if abs(unit - pp * mul) <= TOL * pp * mul:
                exacto_promo[nom] += 1
        crudos = [c for c in (pn, pp) if c]
        if any(abs(unit - c) <= TOL * max(c, 1) for c in crudos):
            igual_catalogo += 1
        elif any(abs(unit - c * mul) <= TOL * max(c * mul, 1) for c in crudos):
            catalogo_por_mult += 1
        else:
            ninguno += 1

    print()
    print("== ¿el unitario cobrado es el precio de catálogo, o el catálogo × multiplicador? ==")
    print("moneda  mult     n     mediana(unit/normal)  mediana(unit/promo)  ==normal×mult  ==promo×mult")
    for _, (nom, _, mul) in monedas.items():
        if nom == "USD" or not mul or nom not in razones_n:
            continue
        rn, rp = razones_n[nom], razones_p.get(nom, [])
        med_p = f"{median(rp):.2f}" if rp else "—"
        print(
            f"{nom:6}  {mul:<8} {len(rn):<5} {median(rn):<21.2f} {med_p:<20} "
            f"{exacto_normal[nom]:<14} {exacto_promo[nom]}"
        )
    todas = [x for v in razones_n.values() for x in v]
    print(f"\n  mediana global unit/precio_normal: {median(todas):.2f}   n={len(todas)}")
    print(f"  coincidencias exactas (±{TOL:.0%}):  == catálogo {igual_catalogo}   == catálogo × multiplicador {catalogo_por_mult}   ninguno {ninguno}")
    print()
    print("  VEREDICTO: si el catálogo estuviera en moneda local, la mediana sería ~1,00 en TODAS")
    print("  las monedas. Da el multiplicador de cada una → el catálogo está en USD, y `precio_promocion`")
    print("  también (mirá su columna de coincidencias exactas: no es inferencia por el nombre).")


if __name__ == "__main__":
    coherencia_de_los_radios()
    ventas_sin_radio()
    moneda_del_catalogo()
