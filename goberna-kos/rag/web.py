"""Probador web LOCAL del cerebro RAG de Ivi. Corré en la Mac y abrí http://localhost:8091.

Sirve una página simple + `POST /ask` que llama a rag.ask.ask(). Para probar/investigar el ruteo
(estructurada/semántica/mixta), los HECHOS del catálogo SDK y las citas de documentos.

Uso (desde goberna-kos/):  python3 -m rag.web
Requiere: backend meta-escuela arriba (:4100), Ollama con bge-m3 (geografo), y la tabla rag.documentos.
"""

import json
import os
import sys
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from . import config
from .ask import ask
from .responder import responder

# Voz de Ivi (Piper) DIRECTA vía ivi.voz cuando está disponible (deploy en geografo) — así el chat
# es autosuficiente y se puede retirar el motor viejo. Si no, cae al proxy TTS_URL (dev en la Mac).
try:
    from ivi import voz as _voz
except Exception:  # noqa: BLE001
    _voz = None

PORT = int(os.environ.get("RAG_WEB_PORT", "8091"))
# Fallback de TTS para el tester de la Mac (donde no hay Piper): pega al chat de geografo por HTTPS.
# En geografo el chat usa _voz (Piper directo) y no toca esto.
TTS_URL = os.environ.get("RAG_TTS_URL", "https://geografo.tailf59792.ts.net/tts")

PAGE = """<!doctype html>
<html lang="es"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ivi · probador del cerebro RAG</title>
<style>
  :root { --azul:#0b2545; --azul2:#13315c; --oro:#c9a227; --bg:#0d1117; --card:#161b22;
          --line:#232a33; --tx:#e6edf3; --mut:#8b98a5; --ok:#2ea043; --ctx:#3b82f6; --sin:#8b98a5; }
  * { box-sizing:border-box; } body { margin:0; background:var(--bg); color:var(--tx);
      font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; }
  .wrap { max-width:820px; margin:0 auto; padding:28px 20px 80px; }
  header { display:flex; align-items:baseline; gap:12px; border-bottom:2px solid var(--oro); padding-bottom:14px; }
  header h1 { font-size:20px; margin:0; letter-spacing:.3px; }
  header .sub { color:var(--mut); font-size:13px; }
  .chips { display:flex; flex-wrap:wrap; gap:8px; margin:18px 0; }
  .chip { background:var(--card); border:1px solid var(--line); color:var(--tx); border-radius:999px;
          padding:6px 12px; font-size:13px; cursor:pointer; transition:.15s; }
  .chip:hover { border-color:var(--oro); color:var(--oro); }
  .bar { display:flex; gap:10px; }
  #q { flex:1; background:var(--card); border:1px solid var(--line); color:var(--tx); border-radius:10px;
       padding:12px 14px; font-size:15px; outline:none; } #q:focus { border-color:var(--oro); }
  #go { background:var(--oro); color:#1a1200; border:0; border-radius:10px; padding:0 20px; font-weight:700;
        cursor:pointer; font-size:15px; } #go:disabled { opacity:.5; cursor:default; }
  .out { margin-top:22px; }
  .badges { display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin-bottom:6px; }
  .b { border-radius:6px; padding:3px 10px; font-size:12px; font-weight:700; letter-spacing:.4px; }
  .b.modo { background:var(--azul2); color:#cfe0ff; } .b.HECHO { background:rgba(46,160,67,.15); color:#4ae168; border:1px solid #2ea043; }
  .b.CONTEXTO { background:rgba(59,130,246,.15); color:#7fb0ff; border:1px solid var(--ctx); }
  .b.SIN_EVIDENCIA { background:rgba(139,152,165,.15); color:var(--mut); border:1px solid var(--sin); }
  .router { color:var(--mut); font-size:12px; margin-bottom:14px; font-family:ui-monospace,Menlo,monospace; }
  .card { background:var(--card); border:1px solid var(--line); border-left:3px solid var(--line);
          border-radius:10px; padding:14px 16px; margin-bottom:12px; }
  .card.HECHO { border-left-color:var(--ok); } .card.CONTEXTO { border-left-color:var(--ctx); }
  .card.SIN_EVIDENCIA { border-left-color:var(--sin); }
  .card .head { display:flex; justify-content:space-between; gap:10px; align-items:center; margin-bottom:8px; }
  .card .fuente { font-family:ui-monospace,Menlo,monospace; font-size:12px; color:var(--oro); word-break:break-all; }
  .card .sim { color:var(--mut); font-size:12px; white-space:nowrap; }
  pre { margin:0; white-space:pre-wrap; word-break:break-word; font-family:ui-monospace,Menlo,monospace;
        font-size:12.5px; color:#cbd5e1; max-height:320px; overflow:auto; }
  .extracto { color:#c3ccd6; font-size:13.5px; }
  .loading { color:var(--oro); } .err { color:#f87171; }
  footer { margin-top:34px; color:var(--mut); font-size:12px; border-top:1px solid var(--line); padding-top:12px; }
  a { color:var(--oro); }
</style></head>
<body><div class="wrap">
  <header>
    <h1>Ivi · <span style="color:var(--oro)">cerebro RAG</span></h1>
    <span class="sub">probador local — router · consultar_bi (SDK) · buscar_docs (pgvector)</span>
  </header>

  <div class="chips" id="chips"></div>
  <div class="bar">
    <input id="q" placeholder="Preguntá algo… (ej: cuál es el ROAS por país)" autocomplete="off">
    <button id="go">Preguntar</button>
  </div>
  <div class="out" id="out"></div>

  <footer>
    Regla de Oro (Ley I): los números salen del SQL/SDK (HECHO); los docs son contexto citado
    (CONTEXTO). El modelo no inventa ni recalcula. · <span id="meta"></span>
  </footer>
</div>
<script>
const SUG = ["cuál es el ROAS por país","cómo está el lazo con la CAPI de Meta",
  "por qué Cerberus no tiene datos de Meta","qué embedder usa el RAG y por qué no Titan",
  "estados de venta","qué es el SDK y las herramientas governa"];
const chips = document.getElementById('chips');
SUG.forEach(s => { const c=document.createElement('span'); c.className='chip'; c.textContent=s;
  c.onclick=()=>{ document.getElementById('q').value=s; preguntar(); }; chips.appendChild(c); });

const q = document.getElementById('q'), go = document.getElementById('go'), out = document.getElementById('out');
q.addEventListener('keydown', e => { if (e.key==='Enter') preguntar(); });
go.onclick = preguntar;

function esc(s){ return (s==null?'':String(s)).replace(/[&<>]/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[m])); }

async function preguntar(){
  const pregunta = q.value.trim(); if(!pregunta) return;
  go.disabled=true; out.innerHTML='<p class="loading">Pensando… (embebe la consulta + rutea + consulta SDK/docs)</p>';
  const t0=performance.now();
  try{
    const r = await fetch('/ask',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pregunta})});
    const d = await r.json();
    if(d.error){ out.innerHTML='<p class="err">Error: '+esc(d.error)+'</p>'; return; }
    render(d, Math.round(performance.now()-t0));
  }catch(e){ out.innerHTML='<p class="err">Error de red: '+esc(e.message)+'</p>'; }
  finally{ go.disabled=false; }
}

function render(d, ms){
  const rt = d.router||{};
  let h = '<div class="badges"><span class="b modo">'+esc((d.modo||'').toUpperCase())+'</span>'+
          '<span class="b '+esc(d.tipo)+'">'+esc(d.tipo)+'</span>'+
          '<span class="sim" style="color:var(--mut);font-size:12px">'+ms+' ms</span></div>'+
          '<div class="router">router: bi_score='+esc(rt.bi_score)+' · intent='+esc(rt.intent)+' · sem_top='+esc(rt.sem_top)+'</div>';
  (d.evidencia||[]).forEach(e=>{
    h += '<div class="card '+esc(e.tipo)+'">';
    if(e.tipo==='HECHO'){
      h += '<div class="head"><span class="b HECHO">HECHO</span><span class="fuente">'+esc(e.fuente)+'</span></div>';
      h += '<pre>'+esc(JSON.stringify(e.salida,null,2))+'</pre>';
    } else if(e.tipo==='CONTEXTO'){
      h += '<div class="head"><span class="fuente">'+esc(e.fuente)+'</span><span class="sim">sim '+esc(e.similitud)+(e.sensible?' · 🔒':'')+'</span></div>';
      h += '<div class="extracto">'+esc(e.extracto)+'…</div>';
    } else {
      h += '<div class="head"><span class="b SIN_EVIDENCIA">SIN_EVIDENCIA</span><span class="fuente">'+esc(e.fuente||'')+'</span></div>';
      h += '<div class="extracto">'+esc(e.motivo||'')+'</div>';
    }
    h += '</div>';
  });
  out.innerHTML = h;
}
</script></body></html>"""


VOZ_PAGE = """<!doctype html>
<html lang="es"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Hablá con Ivi</title>
<style>
  :root { --oro:#c9a227; --bg:#0d1117; --card:#161b22; --line:#232a33; --tx:#e6edf3; --mut:#8b98a5;
          --ivi:#13315c; --user:#1f2937; }
  * { box-sizing:border-box; } html,body { height:100%; }
  body { margin:0; background:var(--bg); color:var(--tx); display:flex; flex-direction:column;
         font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; }
  header { text-align:center; padding:16px; border-bottom:2px solid var(--oro); }
  header h1 { margin:0; font-size:19px; } header span { color:var(--mut); font-size:12px; }
  #log { flex:1; overflow:auto; padding:20px; max-width:760px; margin:0 auto; width:100%; }
  .msg { margin:10px 0; display:flex; } .msg.user { justify-content:flex-end; }
  .bub { max-width:80%; padding:11px 15px; border-radius:16px; }
  .user .bub { background:var(--user); border-bottom-right-radius:4px; }
  .ivi .bub { background:var(--ivi); border-bottom-left-radius:4px; }
  .meta { color:var(--mut); font-size:11px; margin-top:5px; font-family:ui-monospace,Menlo,monospace; }
  .foot { padding:16px 20px 26px; border-top:1px solid var(--line); display:flex; flex-direction:column;
          align-items:center; gap:12px; }
  #status { color:var(--oro); font-size:13px; min-height:18px; }
  #mic { width:74px; height:74px; border-radius:50%; border:0; background:var(--oro); color:#1a1200;
         font-size:30px; cursor:pointer; transition:.15s; box-shadow:0 4px 18px rgba(201,162,39,.3); }
  #mic:active { transform:scale(.94); } #mic.rec { background:#e5484d; color:#fff; animation:p 1.2s infinite; }
  @keyframes p { 0%,100%{box-shadow:0 0 0 0 rgba(229,72,77,.5)} 50%{box-shadow:0 0 0 16px rgba(229,72,77,0)} }
  .row { display:flex; gap:8px; width:100%; max-width:600px; }
  #t { flex:1; background:var(--card); border:1px solid var(--line); color:var(--tx); border-radius:10px;
       padding:10px 13px; outline:none; } #t:focus { border-color:var(--oro); }
  #send { background:transparent; border:1px solid var(--line); color:var(--tx); border-radius:10px; padding:0 16px; cursor:pointer; }
  label.sp { color:var(--mut); font-size:12px; display:flex; gap:6px; align-items:center; }
</style></head>
<body>
  <header><h1>Hablá con <span style="color:var(--oro)">Ivi</span></h1><br><span>tocá el micrófono y preguntá — números por SQL, prosa natural, voz de Ivi</span></header>
  <div id="log"></div>
  <div class="foot">
    <div id="status">Tocá el micrófono para hablar</div>
    <button id="mic" title="Hablar">🎙️</button>
    <div class="row"><input id="t" placeholder="…o escribí acá" autocomplete="off"><button id="send">Enviar</button></div>
    <label class="sp"><input type="checkbox" id="auto" checked> que Ivi hable la respuesta</label>
  </div>
<script>
const log=document.getElementById('log'), statusEl=document.getElementById('status'), mic=document.getElementById('mic'),
      t=document.getElementById('t'), auto=document.getElementById('auto');
function esc(s){return (s==null?'':String(s)).replace(/[&<>]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[m]));}
function add(who, texto, meta){ const d=document.createElement('div'); d.className='msg '+who;
  d.innerHTML='<div class="bub">'+esc(texto)+(meta?'<div class="meta">'+esc(meta)+'</div>':'')+'</div>';
  log.appendChild(d); log.scrollTop=log.scrollHeight; return d; }

let audio=null;
let conversacion=[];  // memoria multi-turno (se manda el historial reciente a /responder)
async function hablar(texto){
  if(!auto.checked) return;
  try{ statusEl.textContent='Ivi hablando…';
    const r=await fetch('/tts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:texto})});
    if(!r.ok) throw 0; const b=await r.blob();
    if(audio){audio.pause();} audio=new Audio(URL.createObjectURL(b));
    audio.onended=()=>{statusEl.textContent='Tocá el micrófono para hablar';}; audio.play();
  }catch(e){ statusEl.textContent='(sin voz — revisá /api/tts de geografo)'; }
}
async function preguntar(pregunta){
  add('user', pregunta); statusEl.textContent='Ivi pensando…';
  try{
    const r=await fetch('/responder',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({pregunta, historial: conversacion.slice(-3)})});
    const d=await r.json();
    if(d.error){ add('ivi','Uy, hubo un error: '+d.error); statusEl.textContent=''; return; }
    const g = d.grounding_ok===false ? ' · ⚠️ '+(d.numeros_no_verificados||[]).join(', ')+' sin verificar' : '';
    add('ivi', d.texto, d.redactor+' · '+d.modo+'/'+d.tipo+g);
    conversacion.push({q: pregunta, a: d.texto});
    hablar(d.texto);
  }catch(e){ add('ivi','Error de red: '+e.message); statusEl.textContent=''; }
}
document.getElementById('send').onclick=()=>{ const v=t.value.trim(); if(v){t.value='';preguntar(v);} };
t.addEventListener('keydown',e=>{ if(e.key==='Enter'){const v=t.value.trim(); if(v){t.value='';preguntar(v);}} });

// Voz → texto con el navegador (Web Speech). Chrome/Safari.
const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
if(SR){ const rec=new SR(); rec.lang='es-ES'; rec.interimResults=false; rec.maxAlternatives=1;
  let rec_ing=false;
  mic.onclick=()=>{ if(rec_ing){rec.stop();return;} try{rec.start();}catch(e){} };
  rec.onstart=()=>{rec_ing=true; mic.classList.add('rec'); statusEl.textContent='Escuchando…';};
  rec.onend=()=>{rec_ing=false; mic.classList.remove('rec'); if(statusEl.textContent==='Escuchando…')statusEl.textContent='Tocá el micrófono para hablar';};
  rec.onerror=e=>{statusEl.textContent='mic: '+e.error;};
  rec.onresult=e=>{ const txt=e.results[0][0].transcript; preguntar(txt); };
} else { mic.disabled=true; mic.title='Tu navegador no soporta dictado; usá el texto'; statusEl.textContent='Dictado no disponible — escribí abajo'; }
</script></body></html>"""


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, body, ctype="application/json; charset=utf-8"):
        data = body.encode("utf-8") if isinstance(body, str) else body
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path in ("/", "/index.html"):
            self._send(200, PAGE, "text/html; charset=utf-8")
        elif self.path in ("/voz", "/voz.html"):
            self._send(200, VOZ_PAGE, "text/html; charset=utf-8")
        else:
            self._send(404, json.dumps({"error": "no encontrado"}))

    def do_POST(self):
        try:
            n = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(n).decode("utf-8")) if n else {}
        except Exception:  # noqa: BLE001
            return self._send(400, json.dumps({"error": "json inválido"}))

        if self.path in ("/ask", "/responder"):
            pregunta = (body.get("pregunta") or "").strip()
            if not pregunta:
                return self._send(400, json.dumps({"error": "falta la pregunta"}))
            try:
                if self.path == "/responder":
                    res = responder(pregunta, historial=body.get("historial") or None)
                else:
                    res = ask(pregunta)
                self._send(200, json.dumps(res, ensure_ascii=False, default=str))
            except Exception as e:  # noqa: BLE001
                self._send(500, json.dumps({"error": str(e)}))
        elif self.path == "/tts":
            texto = (body.get("text") or "").strip()
            if not texto:
                return self._send(400, json.dumps({"error": "falta text"}))
            if _voz is not None:  # Piper directo (geografo)
                try:
                    return self._send(200, _voz.tts(texto), "audio/wav")
                except Exception:  # noqa: BLE001 — cae al proxy
                    pass
            try:                  # proxy (dev en la Mac)
                req = urllib.request.Request(TTS_URL, data=json.dumps({"text": texto}).encode(),
                                             headers={"Content-Type": "application/json"})
                with urllib.request.urlopen(req, timeout=30) as r:
                    self._send(200, r.read(), "audio/wav")
            except Exception as e:  # noqa: BLE001
                self._send(502, json.dumps({"error": f"tts: {e}"}))
        else:
            self._send(404, json.dumps({"error": "no encontrado"}))

    def log_message(self, *a):  # silencioso
        pass


def main() -> int:
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"Probador RAG de Ivi → http://localhost:{PORT}")
    print(f"  backend SDK: {config.BACKEND} · embedder: {config.OLLAMA_URL} ({config.EMBEDDER_MODEL})")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        srv.shutdown()
    return 0


if __name__ == "__main__":
    sys.exit(main())
