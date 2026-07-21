import { Router } from 'express';
import { vinculador } from '../whatsapp/vinculador.js';

/**
 * LA CONSOLA DE VINCULACIÓN (D13). Una página local donde el operador enlaza un
 * número: entra el número, ve el QR en vivo (se refresca solo), y la página
 * confirma cuando conecta. Reemplaza el ir-pasando-screenshots del script.
 *
 * OJO: en producción esto va detrás de auth de operador (o solo accesible desde
 * el server, no expuesto). En local es la herramienta de trabajo.
 */
export const vincularRouter = Router();

vincularRouter.post('/iniciar', (req, res) => {
  const numero = String(req.body?.numero ?? '');
  // Fire-and-forget: la vinculación corre en segundo plano; la página consulta el estado.
  void vinculador.iniciar(numero);
  res.json({ ok: true });
});

vincularRouter.get('/estado', (_req, res) => {
  res.json(vinculador.estado());
});

vincularRouter.post('/cerrar', async (_req, res) => {
  await vinculador.cerrar();
  res.json({ ok: true });
});

vincularRouter.get('/', (_req, res) => {
  res.type('html').send(PAGINA);
});

const PAGINA = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Vincular WhatsApp · Hermes</title>
<style>
  :root{--navy:#0E2A52;--blue:#2563EB;--bg:#F5F7FB;--card:#fff;--border:#E6EAF2;--muted:#5B6B86;
        --green:#16A34A;--red:#DC2626;--gold:#CAA106}
  *{box-sizing:border-box} body{margin:0;font-family:system-ui,sans-serif;background:var(--bg);color:var(--navy);
    display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px}
  .card{background:var(--card);border:1px solid var(--border);border-radius:20px;box-shadow:0 6px 30px rgba(14,42,82,.08);
    padding:28px;max-width:440px;width:100%;text-align:center}
  h1{font-weight:800;letter-spacing:.5px;margin:0 0 2px} .sub{color:var(--muted);font-size:14px;margin:0 0 20px}
  input{width:100%;padding:11px 13px;border:1px solid var(--border);border-radius:11px;font-size:15px;font-family:ui-monospace,monospace;text-align:center}
  button{margin-top:12px;width:100%;padding:12px;border:0;border-radius:11px;background:var(--blue);color:#fff;font-weight:700;font-size:15px;cursor:pointer}
  button:disabled{opacity:.5;cursor:default}
  .qr{margin:18px auto;width:300px;height:300px;background:#fff;border:1px solid var(--border);border-radius:14px;padding:10px;object-fit:contain}
  .estado{font-size:14px;padding:10px;border-radius:11px;margin-top:6px}
  .esperando{background:#EFF4FE;color:var(--navy)} .ok{background:#EAF7EE;color:var(--green);font-weight:700}
  .err{background:#FDECEC;color:var(--red)} .ban{background:#FDECEC;color:var(--red);font-weight:700}
  .pasos{font-size:13px;color:var(--muted);text-align:left;margin:14px 4px 0;line-height:1.5}
  code{background:var(--bg);padding:1px 5px;border-radius:5px}
</style></head>
<body><div class="card">
  <h1>HERMES</h1><p class="sub">Vincular un número de WhatsApp</p>
  <input id="numero" placeholder="51955135507" inputmode="numeric" />
  <button id="btn" onclick="iniciar()">Vincular</button>
  <div id="salida"></div>
  <div class="pasos">
    En el teléfono de ese número: <b>WhatsApp → Ajustes → Dispositivos vinculados →
    Vincular un dispositivo</b> → escaneá el QR. El QR se refresca solo cada pocos segundos.
  </div>
</div>
<script>
let poll=null;
async function iniciar(){
  const numero=document.getElementById('numero').value.replace(/\\D/g,'');
  if(numero.length<8){alert('Número inválido');return}
  document.getElementById('btn').disabled=true;
  document.getElementById('btn').textContent='Conectando…';
  await fetch('/vincular/iniciar',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({numero})});
  if(poll)clearInterval(poll);
  poll=setInterval(refrescar,1500);
  refrescar();
}
async function refrescar(){
  const s=await (await fetch('/vincular/estado')).json();
  const out=document.getElementById('salida');
  if(s.estado==='qr'){
    out.innerHTML='<img class="qr" src="'+s.qr+'"><div class="estado esperando">Escaneá el QR desde el teléfono</div>';
  }else if(s.estado==='esperando'){
    out.innerHTML='<div class="estado esperando">Generando QR…</div>';
  }else if(s.estado==='conectado'){
    out.innerHTML='<div class="estado ok">✅ Conectado como '+s.jid+'<br>El número quedó vinculado.</div>';
    clearInterval(poll);document.getElementById('btn').textContent='Vinculado';
  }else if(s.estado==='baneado'){
    out.innerHTML='<div class="estado ban">⛔ WhatsApp suspendió el número (código '+s.codigo+'). Se levanta '+s.expira+'.</div>';
    clearInterval(poll);
  }else if(s.estado==='error'){
    out.innerHTML='<div class="estado err">Error: '+s.motivo+'</div>';
    clearInterval(poll);document.getElementById('btn').disabled=false;document.getElementById('btn').textContent='Reintentar';
  }
}
</script></body></html>`;
