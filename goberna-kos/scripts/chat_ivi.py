#!/usr/bin/env python3
# ─────────────────────────────────────────────────────────
# Chat web para ivi-ventas (Ollama) + datos vivos del backend
# Servidor stdlib, sin dependencias.
#
# Ivi consulta el backend de meta-escuela y razona sobre los datos
# reales de Cerberus: serie temporal (ventas por mes/semana),
# mix de producto, embudo de estados, latencia de tesorería,
# ventas por sede, cartera de cobranza, lazo con Meta (CAPI).
#
# Uso: python3 chat_ivi.py
# ─────────────────────────────────────────────────────────
import json
import urllib.request
import urllib.error
import http.server
import socketserver
from pathlib import Path
from datetime import datetime, date
from collections import defaultdict

OLLAMA_URL = "http://localhost:11434/api/generate"
MODEL = "ivi-ventas"
PORT = 8080

# Backend de meta-escuela (Mac por Tailscale / LAN)
BACKEND = "http://100.98.60.92:4100"

HTML = """<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ivi · Ventas (Goberna)</title>
<style>
  :root { --bg:#0f1117; --panel:#1a1d27; --me:#2563eb; --bot:#2d3340; --txt:#e6e8ee; --mut:#8a90a2; --live:#22c55e; }
  * { box-sizing: border-box; }
  body { margin:0; font-family: system-ui, -apple-system, sans-serif; background:var(--bg); color:var(--txt); height:100vh; display:flex; flex-direction:column; }
  header { padding:14px 20px; background:var(--panel); border-bottom:1px solid #2a2e3a; display:flex; align-items:center; gap:10px; }
  header .dot { width:10px; height:10px; border-radius:50%; background:var(--live); }
  header .dot.off { background:#ef4444; }
  header h1 { font-size:16px; margin:0; font-weight:600; }
  header small { color:var(--mut); font-weight:400; }
  #log { flex:1; overflow-y:auto; padding:20px; display:flex; flex-direction:column; gap:14px; }
  .msg { max-width:76%; padding:12px 16px; border-radius:16px; line-height:1.55; white-space:pre-wrap; }
  .me { align-self:flex-end; background:var(--me); border-bottom-right-radius:4px; }
  .bot { align-self:flex-start; background:var(--bot); border-bottom-left-radius:4px; }
  .meta { font-size:11px; color:var(--mut); margin-bottom:4px; }
  .live { font-size:10px; color:var(--live); margin-top:6px; font-style:italic; }
  #input { display:flex; gap:10px; padding:16px 20px; background:var(--panel); border-top:1px solid #2a2e3a; }
  #input textarea { flex:1; resize:none; height:48px; max-height:140px; padding:12px 14px; border-radius:12px; border:1px solid #2a2e3a; background:#0f1117; color:var(--txt); font-family:inherit; font-size:14px; }
  #input button { padding:0 22px; border:none; border-radius:12px; background:var(--me); color:#fff; font-weight:600; cursor:pointer; font-size:14px; }
  #input button:disabled { opacity:.5; cursor:default; }
  .typing { color:var(--mut); font-style:italic; }
  .sug { display:flex; flex-wrap:wrap; gap:8px; padding:0 20px 14px; background:var(--panel); }
  .sug button { background:#222633; color:var(--txt); border:1px solid #2a2e3a; border-radius:999px; padding:6px 12px; font-size:12px; cursor:pointer; }
</style>
</head>
<body>
<header>
  <span class="dot" id="statusdot"></span>
  <h1>Ivi · Ventas <small>asistente de Goberna — Cerberus (ventas) + datos en vivo</small></h1>
</header>
<div id="log"></div>
<div class="sug" id="sug"></div>
<div id="input">
  <textarea id="txt" placeholder="Pregunta sobre ventas en Goberna..." onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();send();}"></textarea>
  <button id="btn" onclick="send()">Enviar</button>
</div>
<script>
const log = document.getElementById('log');
const txt = document.getElementById('txt');
const btn = document.getElementById('btn');
const dot = document.getElementById('statusdot');
const sug = document.getElementById('sug');
let busy = false;

const SUGERENCIAS = [
  "ventas por semana",
  "ventas por mes",
  "cuál es la tendencia",
  "qué se vende más",
  "cuántas ventas perdimos por fuera de la ventana de Meta",
  "cartera de cuotas atrasadas",
];

function addMsg(role, content, live) {
  const d = document.createElement('div');
  d.className = 'msg ' + role;
  const m = document.createElement('div');
  m.className = 'meta';
  m.textContent = role === 'me' ? 'Tú' : 'Ivi';
  const c = document.createElement('div');
  c.textContent = content;
  d.appendChild(m); d.appendChild(c);
  if (live) {
    const l = document.createElement('div');
    l.className = 'live';
    l.textContent = '⦿ datos en vivo de Cerberus';
    d.appendChild(l);
  }
  log.appendChild(d);
  log.scrollTop = log.scrollHeight;
  return c;
}

function renderSugs() {
  sug.innerHTML = '';
  SUGERENCIAS.forEach(s => {
    const b = document.createElement('button');
    b.textContent = s;
    b.onclick = () => { txt.value = s; send(); };
    sug.appendChild(b);
  });
}

async function send() {
  if (busy) return;
  const q = txt.value.trim();
  if (!q) return;
  txt.value = '';
  addMsg('me', q);
  busy = true; btn.disabled = true;
  const typing = addMsg('bot', '✍️ analizando datos en vivo...');
  typing.classList.add('typing');
  try {
    const r = await fetch('/api/chat', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ message: q })
    });
    const data = await r.json();
    typing.classList.remove('typing');
    typing.textContent = data.response || '(sin respuesta)';
    if (data.live) {
      const l = document.createElement('div');
      l.className = 'live';
      l.textContent = '⦿ datos en vivo de Cerberus';
      typing.parentElement.appendChild(l);
    }
  } catch(e) {
    typing.classList.remove('typing');
    typing.textContent = 'Error: ' + e;
  }
  busy = false; btn.disabled = false;
}

addMsg('bot', 'Hola, soy Ivi. Analizo ventas de Goberna en Cerberus con datos en vivo: tendencias por mes/semana, mix de producto, embudo de estados, cartera, tesorería y el lazo con Meta. ¿Qué quieres saber?');
renderSugs();
</script>
</body>
</html>"""


# ─────────────────────────────────────────────────────────
# Capa de datos vivos
# ─────────────────────────────────────────────────────────

def fetch_json(url, timeout=15):
    try:
        req = urllib.request.Request(url, headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode())
    except Exception as e:
        return {"_error": str(e)}


def _week_key(mes_str, iso_day):
    """Devuelve la etiqueta de semana ISO a partir de un mes YYYY-MM y un día."""
    try:
        d = date.fromisoformat(f"{mes_str}-{int(iso_day):02d}")
    except Exception:
        return None
    # Lunes de esa semana (isocalendar)
    y, w, _ = d.isocalendar()
    return f"{y}-S{str(w).zfill(2)}"


def aggregate_serie_to_weeks(serie):
    """Agrupa la serie mensual de Cerberus en semanas.

    `serie` es [{mes:'YYYY-MM', ventas:n, ventasUsd:m}]. Como el espejo solo
    expone el total mensual (no el día exacto de cada venta), no podemos ubicar
    cada venta en su semana real. Aproximamos repartiendo las ventas del mes en
    semanas usando la distribución de días del mes — suficiente para ver la
    forma de la curva semanal y comparar periodos.
    """
    from calendar import monthrange
    by_week = defaultdict(lambda: {"ventas": 0, "usd": 0})
    for row in serie:
        mes = row.get("mes")
        ventas = row.get("ventas", 0) or 0
        usd = row.get("ventasUsd", 0) or 0
        if not mes:
            continue
        try:
            y, m = (int(x) for x in mes.split("-"))
            dias_mes = monthrange(y, m)[1]
        except Exception:
            continue
        # semana ISO de cada día del mes
        pesos = defaultdict(int)
        total = 0
        for dia in range(1, dias_mes + 1):
            wk = _week_key(mes, dia)
            if wk:
                pesos[wk] += 1
                total += 1
        if total == 0:
            continue
        for wk, peso in pesos.items():
            frac = peso / total
            by_week[wk]["ventas"] += round(ventas * frac)
            by_week[wk]["usd"] += round(usd * frac)
    out = [{"semana": k, "ventas": v["ventas"], "usd": v["usd"]}
           for k, v in sorted(by_week.items())]
    return out


def get_live_context(message):
    """Consulta los endpoints del backend según la intención de la pregunta.

    Devuelve (texto_contexto, fue_live).
    """
    msg = (message or "").lower()
    parts = []

    # ── Intención temporal / series / tendencia / comparación de periodos ──
    temporal = any(k in msg for k in [
        "semana", "mes", "mensual", "diario", "día", "dia", "tendencia",
        "evolucion", "evolución", "compar", "periodo", "rango", "año", "ano", "trimestre",
    ])
    # ── Productos / mix / qué se vende ──
    producto = any(k in msg for k in ["producto", "curso", "mix", "se vende", "qué vende", "articulo", "artículo"])
    # ── Embudo / estados / anuladas / reembolsos ──
    embudo = any(k in msg for k in ["anulad", "reembols", "estado", "embudo", "proceso", "cobrad"])
    # ── Tesorería / latencia / confirmación de vouchers ──
    tesoreria = any(k in msg for k in ["tesorer", "voucher", "confirm", "latencia", "pago tard", "tardío", "tardia"])
    # ── Cartera / cuotas / cobranza / mora ──
    cartera_k = any(k in msg for k in ["cartera", "cuota", "cobranza", "moros", "mora", "deuda", "saldo", "ltv", "cliente valioso", "segmento"])
    # ── Lazo con Meta / CAPI / reportes / atribución ──
    lazo = any(k in msg for k in ["meta", "capi", "report", "lazo", "atribuc", "facebook", "instagram", "pauta", "pixel"])
    # ── Sedes ──
    sede = any(k in msg for k in ["sede", "sucursal", "oficina", "tienda"])

    # Siempre traemos el panorama (lazo + flujo) salvo si es puramente conceptual
    overview = fetch_json(f"{BACKEND}/api/overview")
    if isinstance(overview, dict) and not overview.get("_error"):
        parts.append(_fmt_overview(overview))

    if temporal or producto or embudo or tesoreria or sede:
        comer = fetch_json(f"{BACKEND}/api/overview/comercial")
        if isinstance(comer, dict) and not comer.get("_error"):
            parts.append(_fmt_comercial(comer, msg, temporal))

    if cartera_k:
        cart = fetch_json(f"{BACKEND}/api/overview/cartera")
        if isinstance(cart, dict) and not cart.get("_error"):
            parts.append(_fmt_cartera(cart))

    if lazo:
        lz = fetch_json(f"{BACKEND}/api/overview/lazo")
        if isinstance(lz, dict) and not lz.get("_error"):
            parts.append(_fmt_lazo(lz))

    if not parts:
        return None, False
    return "\n\n".join(parts), True


def _fmt_overview(ov):
    lines = ["=== PANORAMA GENERAL (Cerberus / Meta) ==="]
    lazo = ov.get("lazo", {})
    if lazo:
        lines.append(f"- Ventas conocidas en el sistema: {lazo.get('ventasConocidas', 'N/A')}")
        lines.append(f"- Ventas reportadas a Meta (CAPI): {lazo.get('reportadas', 'N/A')}")
        lines.append(f"- Ventas perdidas por fuera de ventana de Meta: {lazo.get('perdidasPorVentana', 'N/A')}")
    acc = ov.get("accionable", {})
    if acc:
        lines.append(f"- Decisiones/comentarios accionables pendientes: {acc.get('total', 'N/A')}")
        for c in acc.get("porCanal", []):
            lines.append(f"    · {c.get('canal')}: {c.get('n')}")
    cerrado = ov.get("cerrado", {})
    if cerrado:
        lines.append(f"- Interacciones cerradas (Meta): {cerrado.get('total', 'N/A')} "
                     f"(mensajes {cerrado.get('mensajes')}, comentarios {cerrado.get('comentarios')})")
    preg = ov.get("preguntas", {})
    if preg:
        lines.append(f"- Preguntas de clientes: con texto {preg.get('conTexto')}, "
                     f"de precio {preg.get('precio')}, solo teléfono {preg.get('soloTelefono')}")
    return "\n".join(lines)


def _fmt_comercial(comer, msg, temporal):
    lines = ["=== INTELIGENCIA COMERCIAL (Cerberus, ventas cobradas) ==="]

    if temporal:
        serie = comer.get("serie", [])
        if serie:
            lines.append("- SERIE MENSUAL (ventas cobradas, USD):")
            for r in serie[-12:]:
                lines.append(f"    · {r.get('mes')}: {r.get('ventas')} ventas, USD {r.get('ventasUsd')}")
            # Agrupar por semanas cuando piden semanas
            if "semana" in msg:
                weeks = aggregate_serie_to_weeks(serie)
                lines.append("- SERIE SEMANAL (aproximación por distribución de días del mes):")
                for w in weeks[-12:]:
                    lines.append(f"    · {w.get('semana')}: ~{w.get('ventas')} ventas, ~USD {w.get('usd')}")
            # Comparación último vs anterior
            if len(serie) >= 2:
                ult = serie[-1]; prev = serie[-2]
                dv = (ult.get("ventas", 0) or 0) - (prev.get("ventas", 0) or 0)
                pct = (dv / prev["ventas"] * 100) if prev.get("ventas") else 0
                lines.append(f"- Comparación: {ult.get('mes')} vs {prev.get('mes')} → "
                             f"{dv:+d} ventas ({pct:+.1f}%)")
            if len(serie) >= 3:
                recent = sum(r.get("ventas", 0) or 0 for r in serie[-3:]) / 3
                older = sum(r.get("ventas", 0) or 0 for r in serie[-6:-3]) / 3
                if older:
                    lines.append(f"- Tendencia (3 meses vs 3 previos): promedio {recent:.0f} vs {older:.0f} "
                                 f"({(recent-older)/older*100:+.1f}%)")

    mix = comer.get("mix", [])
    if mix:
        lines.append("- MIX DE PRODUCTO (top por plata):")
        for p in mix[:8]:
            lines.append(f"    · {p.get('producto')} ({p.get('categoria') or 'sin cat.'}): "
                         f"{p.get('ventas')} ventas, USD {p.get('usd')}, ticket USD {p.get('ticket')}")

    emb = comer.get("embudo", {})
    if emb:
        lines.append("- EMBUDO DE ESTADOS:")
        lines.append(f"    · Total ventas: {emb.get('total')} | cobradas: {emb.get('cobradas')} | "
                     f"en proceso: {emb.get('enProceso')} | anuladas: {emb.get('anuladas')} | "
                     f"reembolsadas: {emb.get('reembolsadas')}")
        lines.append(f"    · Tasa de reembolso: {emb.get('tasaReembolso')}% | "
                     f"tasa en cuotas: {emb.get('tasaCuotas')}%")

    lat = comer.get("latencia", {})
    if lat:
        lines.append(f"- LATENCIA DE TESORERÍA: p50={lat.get('p50')}d, p90={lat.get('p90')}d, "
                     f"fuera de ventana de Meta (>7d): {lat.get('fueraDeVentana')}, "
                     f"sin confirmar: {lat.get('sinConfirmar')}")
        for s in lat.get("porSede", [])[:5]:
            lines.append(f"    · {s.get('sede')}: p90 {s.get('p90')}d, {s.get('tarde')} tardíos")

    sedes = comer.get("sedes", [])
    if sedes:
        lines.append("- VENTAS POR SEDE:")
        for s in sedes[:8]:
            lines.append(f"    · {s.get('sede')}: {s.get('ventas')} ventas, USD {s.get('usd')}, "
                         f"{s.get('clientes')} clientes, ticket USD {s.get('ticket')}")

    bundles = comer.get("bundles", [])
    if bundles:
        lines.append("- CROSS-SELL (productos que se compran juntos):")
        for b in bundles[:5]:
            lines.append(f"    · {b.get('a')} + {b.get('b')}: {b.get('juntas')} ventas")

    return "\n".join(lines)


def _fmt_cartera(cart):
    lines = ["=== CARTERA Y CLIENTE (cobranza viva) ==="]
    cob = cart.get("cobranza", {})
    if cob:
        lines.append(f"- Saldo pendiente: USD {cob.get('saldoUsd')} en {cob.get('cuotasPendientes')} cuotas")
        lines.append(f"- En mora: {cob.get('enMora')} | sin un pago: {cob.get('sinUnPago')}")
        for a in cob.get("aging", []):
            lines.append(f"    · {a.get('tramo')}: {a.get('cuotas')} cuotas, USD {a.get('saldoUsd')}")
    medios = cart.get("medios", [])
    if medios:
        lines.append("- MEDIOS DE PAGO:")
        for m in medios[:6]:
            lines.append(f"    · {m.get('medio')}: {m.get('pagos')} pagos, USD {m.get('usd')}, "
                         f"aprobación {m.get('aprobacion')}%")
    val = cart.get("valor", {})
    if val:
        segs = val.get("segmentos", [])
        if segs:
            lines.append("- SEGMENTOS DE VALOR (LTV):")
            for s in segs:
                lines.append(f"    · {s.get('segmento')}: {s.get('personas')} personas, "
                             f"LTV USD {s.get('ltvUsd')}, ticket USD {s.get('ticket')}")
        top = val.get("top", [])
        if top:
            lines.append("- TOP CLIENTES POR VALOR:")
            for t in top[:5]:
                lines.append(f"    · {t.get('nombre') or 'sin nombre'}: USD {t.get('ltvUsd')}, "
                             f"{t.get('compras')} compras ({t.get('pais')})")
    return "\n".join(lines)


def _fmt_lazo(lz):
    lines = ["=== LAZO CON META (CAPI) ==="]
    lines.append(f"- Modo de envío: {lz.get('modo')}")
    lines.append(f"- Total conversiones: {lz.get('totalVentas')} | enviadas: {lz.get('enviadas')}")
    for d in lz.get("descartes", []):
        lines.append(f"    · No enviada ({d.get('motivo')}): {d.get('n')}")
    if lz.get("errores"):
        lines.append(f"- Errores de Meta: {len(lz.get('errores'))} (ver detalle en backend)")
    return "\n".join(lines)


# ─────────────────────────────────────────────────────────
# Prompt y Ollama
# ─────────────────────────────────────────────────────────

def build_prompt(message, live_ctx):
    base = (
        "Eres Ivi, analista de ventas de Goberna (Cerberus). "
        "Hablas español peruano neutro y eres preciso con los números.\n\n"
        "REGLAS:\n"
        "1. Usa SOLO los datos en vivo que se te dan. No inventes cifras ni las redondees fuera de lo indicado.\n"
        "2. Cuando sea un análisis, responde con este formato:\n"
        "   • Dato: el número concreto.\n"
        "   • Comparación: vs periodo anterior / vs meta / vs otro segmento.\n"
        "   • Interpretación: qué significa en el negocio (1-2 frases).\n"
        "   • Acción sugerida: qué hacer con eso.\n"
        "3. Si te piden tendencia, di si sube, baja o se mantiene y qué tan fuerte.\n"
        "4. Si no tienes el dato pedido, di exactamente qué falta, no asumas.\n\n"
    )
    if live_ctx:
        base += (
            "DATOS EN VIVO (de Cerberus, consultados al momento de la pregunta):\n"
            f"{live_ctx}\n\n"
        )
    base += f"Pregunta del usuario: {message}"
    return base


def call_ollama(prompt):
    payload = json.dumps({
        "model": MODEL,
        "prompt": prompt,
        "stream": False,
        "options": {"temperature": 0.3, "num_ctx": 8192}
    }).encode()
    req = urllib.request.Request(OLLAMA_URL, data=payload, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        return json.loads(resp.read().decode()).get("response", "")


class Handler(http.server.BaseHTTPRequestHandler):
    def _send(self, code, body, ctype="application/json"):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body if isinstance(body, bytes) else body.encode())

    def do_GET(self):
        if self.path == "/" or self.path == "/index.html":
            self._send(200, HTML, "text/html; charset=utf-8")
        else:
            self._send(404, "not found")

    def do_POST(self):
        if self.path == "/api/chat":
            length = int(self.headers.get("Content-Length", 0))
            data = json.loads(self.rfile.read(length).decode())
            message = data.get("message", "")

            live_ctx, is_live = get_live_context(message)
            prompt = build_prompt(message, live_ctx)
            try:
                response = call_ollama(prompt)
            except Exception as e:
                response = f"Error al llamar a Ollama: {e}"

            self._send(200, json.dumps({"response": response, "live": is_live}))
        else:
            self._send(404, "not found")

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    with socketserver.ThreadingTCPServer(("0.0.0.0", PORT), Handler) as httpd:
        print(f"Chat de Ivi (ventas + datos vivos) en http://0.0.0.0:{PORT}")
        httpd.serve_forever()
