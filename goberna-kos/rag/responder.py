"""responder(pregunta) — la capa conversacional: ask() + redacción NATURAL para HABLAR.

Redactor HÍBRIDO por sensibilidad (Ley I):
  - respuesta con datos SENSIBLES (HECHO del SDK, o CONTEXTO marcado sensible) → qwen3 LOCAL
    (geografo). El dato sensible NUNCA sale a la nube.
  - respuesta pública / documental / general → Bedrock (Nova Lite; Claude cuando el account tenga
    el use-case de Anthropic aprobado) → prosa más natural.

Los NÚMEROS los calcula ask()/SQL (deterministas). Para que el redactor NO los altere (Ley I), la
evidencia se PRE-FORMATEA en frases mínimas y limpias (un hecho por línea, solo lo relevante) — no
se le pasa JSON crudo. Devuelve texto para TTS: corto, sin markdown.
"""

import json
import os
import re
import subprocess
import tempfile
import urllib.request

from . import config
from .ask import ask

# La redacción NATURAL la hace un modelo en la NUBE (mejor prosa); geografo queda para embeddings +
# voz (bge-m3, whisper, Piper). Preferencia de Estephano (2026-07-18): "geografo solo para embedding".
#   nube     → SIEMPRE Bedrock (default). Las cifras agregadas van a Bedrock (no entrena, in-account).
#   hibrido  → qwen3 local para lo sensible, Bedrock para lo público (Ley I estricta).
#   local    → SIEMPRE qwen3 (offline, sin nube).
REDACTOR_MODO = os.environ.get("RAG_REDACTOR_MODO", "nube")
REDACTOR_LOCAL = os.environ.get("RAG_REDACTOR_LOCAL", "qwen3:8b")       # geografo (modo local/hibrido)
# Haiku 4.5 = mejor prosa; requiere el use-case de Anthropic aprobado en Bedrock. Hasta entonces cae
# a Nova Lite (anda sin formulario). Se auto-actualiza a Haiku al aprobarse el formulario.
REDACTOR_NUBE = os.environ.get("RAG_REDACTOR_NUBE", "us.anthropic.claude-haiku-4-5-20251001-v1:0")
REDACTOR_NUBE_FALLBACK = os.environ.get("RAG_REDACTOR_NUBE_FB", "amazon.nova-lite-v1:0")

SISTEMA = (
    "Sos Ivi, la analista de datos de Goberna (escuela de formación política en LATAM). "
    "Respondés para ser ESCUCHADO en voz: natural, cálida y directa, en español neutro, de 1 a 3 "
    "frases en PROSA. Está PROHIBIDO usar markdown, títulos, guiones, listas, viñetas, tablas o emojis "
    "— aunque los DATOS vengan en tabla, respondé en prosa hablada. "
    "Los números en DATOS son EXACTOS y verificados: usalos TAL CUAL, está PROHIBIDO cambiarlos, "
    "redondearlos distinto o inventar cifras que no estén. Si un dato no está en DATOS, decílo con "
    "honestidad ('no tengo ese dato todavía'). Si hay muchos valores, resumí lo importante (quién "
    "lidera, la tendencia), no los enumeres todos. "
    "REGLA DURA DE PRECISIÓN: mencioná COMO MÁXIMO 2 o 3 números, y SOLO los que aparecen "
    "TEXTUALMENTE en DATOS; si no estás 100% seguro de un número, NO lo digas. Es mejor decir menos "
    "y ser exacto que dar un número aproximado. No sumes, no promedies, no calcules porcentajes."
)

MAX_ITEMS = 8


def _num(x, d=1):
    try:
        return round(float(x), d)
    except Exception:
        return x


def _formatear_hecho(fuente: str, s) -> str:
    """Evidencia numérica → frase mínima y limpia (un hecho claro), para que el redactor no invente."""
    if not isinstance(s, dict):
        return f"[{fuente}] " + json.dumps(s, ensure_ascii=False)[:400]

    if "atribucion.roasPorPais" in fuente:
        rp = s.get("roasPais") or []
        top = sorted(rp, key=lambda x: -(x.get("ventas") or 0))[:6]
        partes = [f"{x.get('pais')} {_num(x.get('roas'))}x ({x.get('accion','')})" for x in top]
        corte = (s.get("revisadoAt") or "")[:10]
        return f"ROAS por país (top por ventas; dato del {corte}): " + "; ".join(partes) + "."
    if "ventas.porPaisMes" in fuente:
        comp = s.get("comparacion") or []
        partes = [f"{c['pais']}: {c['ventasActual']} ventas / {c['usdActual']} USD / ticket "
                  f"{c.get('ticketActual')} USD (vs {c['ventasPrevio']} ventas / {c['usdPrevio']} USD "
                  f"el mes previo)" for c in comp[:8]]
        # El país con ticket promedio más alto, con su volumen (para que el redactor pueda avisar si
        # es de pocas ventas y no confundir 'ticket alto' con 'país que más factura').
        con_ticket = [c for c in comp if c.get("ticketActual")]
        extra = ""
        if con_ticket:
            top = max(con_ticket, key=lambda c: c["ticketActual"])
            extra = (f" El ticket promedio más alto lo tiene {top['pais']} con {top['ticketActual']} "
                     f"USD, sobre solo {top['ventasActual']} ventas.")
        return (f"Ventas cobradas por país, {s.get('mesActual')} vs {s.get('mesPrevio')} "
                f"(al mismo día del mes): " + "; ".join(partes) + f".{extra} {s.get('nota','')}")
    if "ventas.pulso" in fuente:
        pl = s.get("paisLider") or {}
        pr = s.get("productoLider") or {}
        partes = [
            f"Pulso del negocio ({s.get('mesActual')} vs {s.get('mesPrevio')}, al mismo día del mes): "
            f"{s.get('ventasMes')} ventas cobradas por {s.get('ingresosUsd')} USD "
            f"(el mes previo, a esta altura, {s.get('ventasMesPrevio')} ventas y "
            f"{s.get('ingresosUsdPrevio')} USD).",
            f"Ticket promedio {s.get('ticketPromedioUsd')} USD." if s.get("ticketPromedioUsd") else "",
            f"País líder: {pl.get('pais')} con {pl.get('usd')} USD." if pl else "",
            f"Producto líder: {pr.get('nombre')} ({pr.get('ventas')} ventas)." if pr else "",
        ]
        return " ".join(x for x in partes if x)
    if "ventas.porProducto" in fuente:
        prods = (s.get("productos") or [])[:6]
        partes = [f"{p['nombre']} ({p['ventas']} ventas, {p['usd']} USD)" for p in prods]
        return (f"Productos por ingresos, últimos {s.get('dias')} días (solo cobradas): "
                + "; ".join(partes) + ".")
    if "ventas.estados" in fuente:
        est = s.get("estados") or []
        vivos = [f"{e.get('nombre')} {e.get('ventas')}" for e in est if e.get("ventas")]
        return f"Estados de venta (total {s.get('total')}): " + ", ".join(vivos) + "."
    if "lazo.estado" in fuente:
        con = "conectado" if s.get("conectado") else "desconectado"
        return (f"Lazo con la CAPI de Meta: {con}; {s.get('ventasConocidas')} ventas conocidas, "
                f"{s.get('reportadas')} reportadas a Meta, {s.get('perdidasPorVentana')} perdidas por ventana.")
    if "pauta.serie" in fuente or "historia.resumen" in fuente:
        return f"[{fuente}] " + json.dumps(_compacta(s), ensure_ascii=False)[:400]
    return f"[{fuente}] " + json.dumps(_compacta(s), ensure_ascii=False)[:400]


def _compacta(v):
    if isinstance(v, list):
        return [_compacta(x) for x in v[:MAX_ITEMS]] + (["…"] if len(v) > MAX_ITEMS else [])
    if isinstance(v, dict):
        return {k: _compacta(x) for k, x in v.items() if k not in ("explicacion",)}
    return v


def _bloque_datos(r: dict) -> str:
    lineas = []
    for e in r["evidencia"]:
        if e["tipo"] == "HECHO":
            lineas.append("• " + _formatear_hecho(e["fuente"], e.get("salida")))
        elif e["tipo"] == "CONTEXTO":
            lineas.append(f"• (doc {e['fuente']}) {e.get('extracto','')}")
        else:
            lineas.append(f"• (sin evidencia) {e.get('motivo','')}")
    return "\n".join(lineas) if lineas else "(sin datos)"


def _es_sensible(r: dict) -> bool:
    return any(e.get("sensible") for e in r["evidencia"])


def _limpiar(t: str) -> str:
    """Red de seguridad para TTS: saca markdown/viñetas por si el modelo las mete igual."""
    t = re.sub(r"[#*`_>]+", "", t)
    t = re.sub(r"^\s*[-•·]\s*", "", t, flags=re.M)
    t = re.sub(r"\n{2,}", " ", t).replace("\n", " ")
    return re.sub(r"\s{2,}", " ", t).strip()


_NUM_TOK = re.compile(r"(\d[\d.,]*\d|\d)\s*(millones|millón|millon|mil(?:es)?|k)?", re.I)


def _a_valor(raw: str, mag: str | None) -> float | None:
    """'19.988'→19988, '6,8'→6.8, '16.0'→16.0, '20 mil'→20000, '1,5 millones'→1500000.
    Resuelve la ambigüedad de separadores es-AR (. miles, , decimal) vs en-US mirando el ÚLTIMO."""
    s = raw.strip()
    if "." in s and "," in s:
        s = s.replace(".", "").replace(",", ".") if s.rfind(",") > s.rfind(".") else s.replace(",", "")
    elif "," in s:
        s = s.replace(",", ".") if (s.count(",") == 1 and len(s.split(",")[-1]) <= 2) else s.replace(",", "")
    elif "." in s and not (s.count(".") == 1 and len(s.split(".")[-1]) <= 2):
        s = s.replace(".", "")  # el punto es de miles (p.ej. 19.988), no decimal
    try:
        v = float(s)
    except ValueError:
        return None
    m = (mag or "").lower()
    if "millon" in m or "millón" in m:
        v *= 1_000_000
    elif m.startswith("mil") or m == "k":
        v *= 1000
    return v


def _valores(t: str) -> list[float]:
    return [v for m in _NUM_TOK.finditer(t) if (v := _a_valor(m.group(1), m.group(2))) is not None]


def _no_verificados(texto: str, datos: str) -> list[str]:
    """Cifras que Ivi dijo pero que NO están en los DATOS ni son un REDONDEO de algo que sí está.
    Red de seguridad Ley I (dominio financiero). Tolerancia 2% + magnitudes (mil/millones), así
    'casi 20 mil' no se marca cuando el dato es 19.988. Ignora números de 1 dígito (ruido)."""
    ref = _valores(datos)
    # También son válidas las SUMAS de 2 valores verificados: si los DATOS traen "Perú 6.001" y
    # "México 4.087", que Ivi diga el total "10.088" es aritmética correcta sobre datos verificados,
    # no una cifra inventada. Solo pares (2% de tolerancia); no cubre todo el eje, así el neto Ley I
    # sigue atrapando cifras fabricadas (un ROAS de 42x, un total que no cuadra con nada).
    sumas = [a + b for i, a in enumerate(ref) for b in ref[i + 1:]]
    ref_ext = ref + sumas
    out = []
    for m in _NUM_TOK.finditer(texto):
        if len(re.sub(r"\D", "", m.group(1))) < 2:
            continue
        v = _a_valor(m.group(1), m.group(2))
        if v is None or any(abs(v - r) <= max(1.0, 0.02 * max(abs(v), abs(r))) for r in ref_ext):
            continue
        out.append(m.group(0).strip())
    return sorted(set(out))


def _qwen3(prompt: str, timeout: int = 60) -> str:
    payload = json.dumps({"model": REDACTOR_LOCAL, "prompt": prompt, "think": False,
                          "stream": False, "options": {"temperature": 0.2}}).encode()
    req = urllib.request.Request(f"{config.OLLAMA_URL}/api/generate", data=payload,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode()).get("response", "").strip()


def _invoke_bedrock(sistema: str, usuario: str, modelo: str, timeout: int = 60) -> str:
    """Un modelo de Bedrock. Formato Nova (amazon.nova*) o Claude (anthropic*), según el modelo."""
    es_nova = "nova" in modelo
    if es_nova:
        body = {"system": [{"text": sistema}],
                "messages": [{"role": "user", "content": [{"text": usuario}]}],
                "inferenceConfig": {"maxTokens": 240, "temperature": 0.5}}
    else:
        body = {"anthropic_version": "bedrock-2023-05-31", "max_tokens": 240, "temperature": 0.5,
                "system": sistema, "messages": [{"role": "user", "content": usuario}]}
    bf = tempfile.NamedTemporaryFile("wb", suffix=".json", delete=False)
    bf.write(json.dumps(body).encode()); bf.close()
    out = bf.name + ".out"
    try:
        r = subprocess.run(
            ["aws", "bedrock-runtime", "invoke-model", "--region", config.BEDROCK_REGION,
             "--model-id", modelo, "--body", f"fileb://{bf.name}", out],
            capture_output=True, text=True, timeout=timeout)
        if r.returncode != 0:
            raise RuntimeError(f"Bedrock ({modelo}) falló: {r.stderr.strip()[:200]}")
        data = json.load(open(out, encoding="utf-8"))
    finally:
        for p in (bf.name, out):
            if os.path.exists(p):
                os.unlink(p)
    if es_nova:
        return "".join(c.get("text", "") for c in data["output"]["message"]["content"]).strip()
    return "".join(c.get("text", "") for c in data.get("content", [])).strip()


def _nube(sistema: str, usuario: str) -> tuple[str, str]:
    """Redactor de nube: intenta REDACTOR_NUBE (Haiku); si está bloqueado (use-case sin aprobar)
    cae a Nova. Devuelve (texto, modelo_usado)."""
    try:
        return _invoke_bedrock(sistema, usuario, REDACTOR_NUBE), REDACTOR_NUBE
    except RuntimeError:
        if REDACTOR_NUBE_FALLBACK == REDACTOR_NUBE:
            raise
        return _invoke_bedrock(sistema, usuario, REDACTOR_NUBE_FALLBACK), REDACTOR_NUBE_FALLBACK


def responder(pregunta: str, usuario: str | None = None, historial: list | None = None) -> dict:
    # Follow-up corto ("¿y en México?"): darle contexto al RETRIEVAL combinando con la pregunta previa.
    consulta = pregunta
    if historial and len(pregunta.split()) <= 6:
        consulta = f"{(historial[-1] or {}).get('q', '')} {pregunta}".strip()
    r = ask(consulta)
    datos = _bloque_datos(r)

    hist_txt = ""
    if historial:
        turnos = "\n".join(f"Usuario: {h.get('q','')}\nIvi: {h.get('a','')}" for h in historial[-3:])
        hist_txt = ("CONVERSACIÓN PREVIA (usala para resolver referencias como 'y en México', "
                    f"'¿por qué?', pero NO repitas cifras viejas como si fueran nuevas):\n{turnos}\n\n")
    usuario_msg = (f"{hist_txt}DATOS:\n{datos}\n\nPregunta actual: {pregunta}\n\n"
                   "Respondé natural, para hablar:")

    usar_local = REDACTOR_MODO == "local" or (REDACTOR_MODO == "hibrido" and _es_sensible(r))
    if usar_local:
        texto = _qwen3(f"{SISTEMA}\n\n{usuario_msg}")
        redactor = f"qwen3-local ({REDACTOR_LOCAL})"
    else:
        texto, modelo = _nube(SISTEMA, usuario_msg)
        redactor = f"bedrock ({modelo})"
    texto = _limpiar(texto)
    # grounding: las cifras deben estar en los DATOS actuales o en lo ya dicho en la conversación
    no_verif = _no_verificados(texto, datos + " " + hist_txt)
    return {"pregunta": pregunta, "texto": texto, "redactor": redactor,
            "modo": r["modo"], "tipo": r["tipo"], "fuentes": r["fuentes"],
            "grounding_ok": not no_verif, "numeros_no_verificados": no_verif,
            "consulta_retrieval": consulta if consulta != pregunta else None, "ask": r}


if __name__ == "__main__":
    import sys
    q = sys.argv[1] if len(sys.argv) > 1 else "cuál es el ROAS por país"
    res = responder(q)
    print(f"[{res['redactor']} · {res['modo']}/{res['tipo']}]\n{res['texto']}")
