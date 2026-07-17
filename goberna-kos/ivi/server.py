#!/usr/bin/env python3
# ─────────────────────────────────────────────────────────
# Ivi Analytical Intelligence Engine — HTTP server (stdlib).
# Replaces chat_ivi.py with the modular pipeline.
#
#   Usuario -> IntentAnalyzer -> DataPlanner -> DataCollector
#          -> KPIEngine -> AnalyticsEngine -> InsightEngine
#          -> RecommendationEngine -> PromptBuilder -> LLM
#          -> ResponseFormatter
# ─────────────────────────────────────────────────────────
import json
import logging
import threading
import time
import urllib.request
import http.server
import socketserver
import re
from pathlib import Path

from .intent_analyzer import analyze
from .data_planner import plan
from .data_collector import collect, last_frescura
from .kpi_engine import compute
from .analytics_engine import analyze as analyze_metrics
from .insight_engine import detect
from .recommendation_engine import recommend
from .impact_engine import compute_impact
from .memory import get_session, remember, is_followup, apply_followup_filters, Turn
from .prompt_builder import build
from .response_formatter import format_response
from .config import OLLAMA_URL, MODEL, PORT, OLLAMA_CTX, OLLAMA_TEMP, OLLAMA_TIMEOUT
from . import cache

log = logging.getLogger("ivi")

# Requests currently inside handle_chat. Ollama serves a bounded number of them
# at a time and queues the rest, so this gauge is what tells a reader of the log
# whether a slow answer was slow inference or slow queue.
_inflight = 0
_inflight_lock = threading.Lock()

_START = time.monotonic()


class OllamaError(RuntimeError):
    """Ollama did not answer: timeout, connection refused, or a 5xx."""

HTML = r"""<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ivi · Inteligencia Analítica (Goberna)</title>
<style>
  :root { --bg:#0f1117; --panel:#1a1d27; --me:#2563eb; --bot:#2d3340; --txt:#e6e8ee; --mut:#8a90a2; --live:#22c55e; --warn:#f59e0b; }
  * { box-sizing: border-box; }
  body { margin:0; font-family: system-ui,-apple-system,sans-serif; background:var(--bg); color:var(--txt); height:100vh; display:flex; flex-direction:column; }
  header { padding:14px 20px; background:var(--panel); border-bottom:1px solid #2a2e3a; display:flex; align-items:center; gap:10px; }
  header .dot { width:10px; height:10px; border-radius:50%; background:var(--live); }
  header h1 { font-size:16px; margin:0; font-weight:600; }
  header small { color:var(--mut); font-weight:400; }
  #log { flex:1; overflow-y:auto; padding:20px; display:flex; flex-direction:column; gap:14px; }
  .msg { max-width:82%; padding:12px 16px; border-radius:16px; line-height:1.55; white-space:pre-wrap; }
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
  h2 { font-size:14px; margin:.6em 0 .2em; color:#9db4ff; }
  .msg table { border-collapse:collapse; margin:6px 0; font-size:12.5px; }
  .msg th, .msg td { border:1px solid #3a4050; padding:4px 9px; text-align:left; }
  .msg th { color:#9db4ff; background:#222633; font-weight:600; }
  .msg b { color:#fff; }
</style>
</head>
<body>
<header>
  <span class="dot" id="statusdot"></span>
  <h1>Ivi · Inteligencia Analítica <small>asistente BI de Goberna — Cerberus + datos en vivo</small></h1>
</header>
<div id="log"></div>
<div class="sug" id="sug"></div>
<div id="input">
  <textarea id="txt" placeholder="Pregunta de análisis comercial..." onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();send();}"></textarea>
  <button id="btn" onclick="send()">Analizar</button>
</div>
<script>
const log = document.getElementById('log');
const txt = document.getElementById('txt');
const btn = document.getElementById('btn');
const sug = document.getElementById('sug');
let busy = false;

// Sesión propia por navegador: sin esto todos comparten sid="default" y los
// follow-ups de dos personas se mezclan. crypto.randomUUID solo existe en
// contextos seguros (https/localhost) y esta UI se sirve por http://IP:8080,
// así que el fallback no es decorativo.
const SID = localStorage.sid || (localStorage.sid =
  (crypto.randomUUID ? crypto.randomUUID()
   : 'sid-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2)));

const SUG = ["ventas por semana","tendencia de ventas","ventas por producto","ventas por sede",
  "comparación mensual","qué se vende más","riesgos comerciales","embudo de estados",
  "cartera y mora","lazo con Meta y pérdidas","ticket promedio","forecast de ventas"];

// Mini-markdown honesto: escapa TODO primero (el texto viene del modelo) y
// después arma h2 CERRADOS, negritas, itálicas y tablas. El renderer anterior
// abría <h2> y nunca lo cerraba: cada sección entera quedaba dentro del título.
function md(src){
  const esc=s=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const inline=s=>esc(s)
    .replace(/\*\*([^*]+)\*\*/g,'<b>$1</b>')
    .replace(/\*([^*\s][^*]*)\*/g,'<i>$1</i>');
  const lines=src.split('\n'); const out=[];
  for(let i=0;i<lines.length;i++){
    const l=lines[i];
    if(/^## /.test(l)){ out.push('<h2>'+inline(l.slice(3))+'</h2>'); continue; }
    if(/^\s*\|.*\|\s*$/.test(l)){
      const rows=[];
      while(i<lines.length && /^\s*\|.*\|\s*$/.test(lines[i])){ rows.push(lines[i]); i++; }
      i--;
      const cells=r=>r.trim().replace(/^\||\|$/g,'').split('|').map(c=>inline(c.trim()));
      const body=rows.filter(r=>!/^\s*\|[\s\-:|]+\|\s*$/.test(r));
      let t='<table>';
      body.forEach((r,j)=>{ const tag=j===0?'th':'td';
        t+='<tr>'+cells(r).map(c=>'<'+tag+'>'+c+'</'+tag+'>').join('')+'</tr>'; });
      out.push(t+'</table>'); continue;
    }
    out.push(inline(l));
  }
  return out.join('\n');
}
function addMsg(role, content, live){
  const d=document.createElement('div'); d.className='msg '+role;
  const m=document.createElement('div'); m.className='meta';
  m.textContent= role==='me'?'Tú':'Ivi';
  const c=document.createElement('div');
  c.innerHTML = md(content);
  d.appendChild(m); d.appendChild(c);
  if(live){ const l=document.createElement('div'); l.className='live';
    l.textContent='⦿ datos en vivo de Cerberus'; d.appendChild(l); }
  log.appendChild(d); log.scrollTop=log.scrollHeight; return c;
}
function renderSugs(){ sug.innerHTML=''; SUG.forEach(s=>{ const b=document.createElement('button');
  b.textContent=s; b.onclick=()=>{txt.value=s;send();}; sug.appendChild(b);}); }
async function send(){
  if(busy) return; const q=txt.value.trim(); if(!q) return; txt.value='';
  addMsg('me',q); busy=true; btn.disabled=true;
  const t=addMsg('bot','✍️ analizando datos en vivo...'); t.classList.add('typing');
  try{
    const r=await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({message:q,session:SID})});
    const data=await r.json();
    t.classList.remove('typing');
    // El server manda 503 cuando el modelo no contesta; el payload igual trae
    // `response` legible, pero no es un análisis: no se marca como dato en vivo.
    t.innerHTML=md(data.response||'Sin respuesta del servidor.');
    if(!r.ok){ t.style.color='#f59e0b'; }
    if(r.ok&&data.live){ const l=document.createElement('div'); l.className='live';
      l.textContent='⦿ datos en vivo de Cerberus'; t.parentElement.appendChild(l); }
  }catch(e){ t.classList.remove('typing'); t.textContent='Error de red: '+e; }
  busy=false; btn.disabled=false;
}
addMsg('bot','Hola, soy Ivi. Analizo ventas de Goberna como un analista senior de BI: tendencias, comparaciones de periodo, embudos, cartera, tesorería y el lazo con Meta. Cada respuesta trae interpretación, riesgos, oportunidades y acciones. ¿Qué quieres saber?');
renderSugs();
</script>
</body>
</html>"""


def call_ollama(prompt: str) -> str:
    payload = json.dumps({
        "model": MODEL, "prompt": prompt, "stream": False,
        "options": {"temperature": OLLAMA_TEMP, "num_ctx": OLLAMA_CTX},
    }).encode()
    req = urllib.request.Request(OLLAMA_URL, data=payload, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=OLLAMA_TIMEOUT) as resp:
            return json.loads(resp.read().decode()).get("response", "")
    except Exception as e:
        raise OllamaError(f"{type(e).__name__}: {e}") from e


def related_questions(intent_scores: dict) -> list:
    pool = {
        "ventas": ["ventas por sede", "ventas por producto", "comparación mensual"],
        "tendencia": ["forecast de ventas", "variación semanal", "estacionalidad"],
        "comparacion": ["ventas vs mismo mes año pasado", "top crecimiento por producto"],
        "campanas": ["ROAS por país", "gasto por campaña", "conversion por campaña"],
        "embudo": ["tasa de reembolso", "anuladas vs cobradas", "tiempo hasta pago"],
        "tesoreria": ["latencia de confirmación", "vouchers fuera de ventana", "histograma de días"],
        "cartera": ["cuotas en mora", "saldo pendiente", "segmentos LTV"],
        "productos": ["mix de producto", "productos que se compran juntos", "ticket promedio"],
        "sedes": ["rendimiento por sede", "ticket por sede", "clientes por sede"],
        "meta": ["lazo con Meta y pérdidas", "modo de envío CAPI", "atribución"],
        "capi": ["ventas perdidas por ventana", "errores de Meta", "modo producción"],
        "atribucion": ["ROAS por país", "CAC", "conversion lead a venta"],
        "rendimiento": ["resumen ejecutivo", "riesgos comerciales", "oportunidades"],
        "forecast": ["tendencia reciente", "comparación anual", "velocidad comercial"],
        "anomalias": ["caídas recientes", "outliers por sede", "picos inesperados"],
        "riesgos": ["cartera y mora", "medios de pago que rechazan", "lazo con Meta"],
        "forecast": ["forecast de ventas", "tendencia reciente", "comparación anual",
                     "proyección próximos 30 días"],
        "atribucion": ["ROAS por país", "CAC por país", "qué país pierde plata en pauta"],
        "capi": ["ventas perdidas por ventana", "errores de Meta", "modo producción"],
    }
    out = []
    for it in intent_scores:
        out.extend(pool.get(it, []))
        if len(out) >= 4:
            break
    return out[:4] or ["resumen ejecutivo", "ventas por producto", "comparación mensual", "riesgos comerciales"]


def health() -> dict:
    """Probe para monitoreo. No dispara fetches ni toca Ollama: siempre es O(1),
    aun con el backend o el modelo caídos — mide que el server esté vivo y da
    contexto (cola, caché, frescura conocida) para leer un incidente."""
    with _inflight_lock:
        inflight = _inflight
    return {
        "ok": True,
        "model": MODEL,
        "inflight": inflight,
        "frescura": last_frescura(),
        "cache": cache.stats(),
        "uptime_s": round(time.monotonic() - _START, 1),
    }


def handle_chat(message: str, sid: str = "default") -> dict:
    global _inflight
    with _inflight_lock:
        _inflight += 1
        queued = _inflight
    t0 = time.monotonic()
    try:
        return _handle_chat(message, sid, t0, queued)
    finally:
        with _inflight_lock:
            _inflight -= 1


def _handle_chat(message: str, sid: str, t0: float, queued: int) -> dict:
    sess = get_session(sid)
    followup = is_followup(message, sid)
    intent = analyze(message)
    scope_note = ""
    if followup and sess.last:
        filters = apply_followup_filters(message, sid)
        scope_note = f"reutilizar análisis previo ({sess.last.scope or intent.dominant()}) " \
                     f"acotado por {filters}" if filters else \
                     f"continuación del análisis previo sobre {sess.last.scope or intent.dominant()}"

    endpoints = plan(intent)
    t_collect = time.monotonic()
    raw = collect(endpoints)
    collect_s = time.monotonic() - t_collect
    kpis = compute(raw)
    analysis = analyze_metrics(kpis)
    insights = detect(kpis, analysis)
    actions = recommend(kpis, analysis, insights)
    impact = compute_impact(kpis)
    related = related_questions(intent.scores)

    # remember this turn
    remember(sid, Turn(intent=intent, scope=intent.dominant(), question=message))

    live = bool(raw.endpoints_hit)
    prompt = build(intent, kpis, analysis, insights, actions, related, impact, scope_note)

    t_llm = time.monotonic()
    try:
        llm = call_ollama(prompt)
    except OllamaError as e:
        # Never dress a failure as an answer: the caller turns this into a 5xx.
        # Returning 200 with the error text inside `response` (as this did
        # before) hid every outage from status-code monitoring.
        log.error("chat sid=%s FALLO ollama=%.1fs inflight=%d prompt=%dch — %s",
                  sid, time.monotonic() - t_llm, queued, len(prompt), e)
        raise
    llm_s = time.monotonic() - t_llm

    log.info("chat sid=%s ok intents=%s endpoints=%s prompt=%dch inflight=%d "
             "collect=%.1fs ollama=%.1fs total=%.1fs — %r",
             sid, intent.intents, raw.endpoints_hit, len(prompt), queued,
             collect_s, llm_s, time.monotonic() - t0, message[:80])
    if raw.errors:
        log.warning("chat sid=%s endpoints con error: %s", sid, raw.errors)
    return format_response(llm, insights, related, impact, live)


class Handler(http.server.BaseHTTPRequestHandler):
    def _send(self, code, body, ctype="application/json"):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body if isinstance(body, bytes) else body.encode())

    def do_GET(self):
        if self.path in ("/", "/index.html"):
            self._send(200, HTML, "text/html; charset=utf-8")
        elif self.path == "/api/health":
            self._send(200, json.dumps(health(), ensure_ascii=False))
        else:
            self._send(404, "not found")

    def do_POST(self):
        if self.path != "/api/chat":
            self._send(404, "not found")
            return
        length = int(self.headers.get("Content-Length", 0))
        data = json.loads(self.rfile.read(length).decode())
        message = data.get("message", "")
        sid = data.get("session") or "default"
        try:
            out = handle_chat(message, sid)
        except OllamaError as e:
            # 503 so monitoring and the UI can both tell this apart from an
            # answer. `response` stays populated so the chat renders something
            # readable instead of blowing up on an undefined field.
            self._send(503, json.dumps({
                "response": "El modelo no respondió a tiempo. El servidor sigue vivo — "
                            "reintentá en unos segundos.",
                "error": str(e), "live": False,
                "insights": [], "related": [], "impact": [],
            }, ensure_ascii=False))
            return
        except Exception as e:
            log.exception("chat sid=%s error inesperado", sid)
            self._send(500, json.dumps({
                "response": f"Error interno del motor: {type(e).__name__}.",
                "error": str(e), "live": False,
                "insights": [], "related": [], "impact": [],
            }, ensure_ascii=False))
            return
        self._send(200, json.dumps(out, ensure_ascii=False))

    def log_message(self, fmt, *args):
        # BaseHTTPRequestHandler writes its access log to stderr by hand; route
        # it through logging so it lands in the same stream as everything else.
        # /api/health se omite: un monitor que pollea cada 30s escribiría ~3K
        # líneas/día en un log que systemd solo appendea (sin rotación).
        line = fmt % args
        if "/api/health" in line:
            return
        log.info("http %s - %s", self.address_string(), line)


def main():
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        datefmt="%Y-%m-%dT%H:%M:%S",
    )
    with socketserver.ThreadingTCPServer(("0.0.0.0", PORT), Handler) as httpd:
        log.info("Ivi Analytical Engine en http://0.0.0.0:%d — modelo=%s ctx=%d timeout=%ds",
                 PORT, MODEL, OLLAMA_CTX, OLLAMA_TIMEOUT)
        httpd.serve_forever()


if __name__ == "__main__":
    main()
