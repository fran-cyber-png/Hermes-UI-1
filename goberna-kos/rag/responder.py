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

REDACTOR_LOCAL = os.environ.get("RAG_REDACTOR_LOCAL", "qwen3:8b")        # geografo (sensible)
# Nova Lite anda sin formulario; Claude (us.anthropic.claude-haiku-4-5-...) cuando el use-case esté.
REDACTOR_NUBE = os.environ.get("RAG_REDACTOR_NUBE", "amazon.nova-lite-v1:0")

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


def _qwen3(prompt: str, timeout: int = 60) -> str:
    payload = json.dumps({"model": REDACTOR_LOCAL, "prompt": prompt, "think": False,
                          "stream": False, "options": {"temperature": 0.2}}).encode()
    req = urllib.request.Request(f"{config.OLLAMA_URL}/api/generate", data=payload,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode()).get("response", "").strip()


def _nube(sistema: str, usuario: str, timeout: int = 60) -> str:
    """Bedrock. Formato Nova (amazon.nova*) o Claude (anthropic*), según el modelo."""
    es_nova = REDACTOR_NUBE.startswith("amazon.nova")
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
             "--model-id", REDACTOR_NUBE, "--body", f"fileb://{bf.name}", out],
            capture_output=True, text=True, timeout=timeout)
        if r.returncode != 0:
            raise RuntimeError(f"Bedrock falló: {r.stderr.strip()[:200]}")
        data = json.load(open(out, encoding="utf-8"))
    finally:
        for p in (bf.name, out):
            if os.path.exists(p):
                os.unlink(p)
    if es_nova:
        return "".join(c.get("text", "") for c in data["output"]["message"]["content"]).strip()
    return "".join(c.get("text", "") for c in data.get("content", [])).strip()


def responder(pregunta: str, usuario: str | None = None) -> dict:
    r = ask(pregunta)
    usuario_msg = f"DATOS:\n{_bloque_datos(r)}\n\nPregunta: {pregunta}\n\nRespondé natural, para hablar:"
    if _es_sensible(r):
        texto = _qwen3(f"{SISTEMA}\n\n{usuario_msg}")
        redactor = f"qwen3-local ({REDACTOR_LOCAL})"
    else:
        texto = _nube(SISTEMA, usuario_msg)
        redactor = f"bedrock ({REDACTOR_NUBE})"
    return {"pregunta": pregunta, "texto": _limpiar(texto), "redactor": redactor,
            "modo": r["modo"], "tipo": r["tipo"], "fuentes": r["fuentes"], "ask": r}


if __name__ == "__main__":
    import sys
    q = sys.argv[1] if len(sys.argv) > 1 else "cuál es el ROAS por país"
    res = responder(q)
    print(f"[{res['redactor']} · {res['modo']}/{res['tipo']}]\n{res['texto']}")
