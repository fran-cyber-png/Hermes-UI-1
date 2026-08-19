import http from 'node:http';

/**
 * Stub de API para capturar la evidencia del chip de etapa en la cola (PR 1.1).
 *
 * Lo que este stub PRUEBA y una galería no podría: el chip sale del MISMO
 * objeto que la fila. Por eso NO sirve `/api/dashboard` — contesta 503, igual
 * que todo lo demás. Si el chip apareciera igual, saldría de otro lado.
 */

const ahora = Date.now();
const hace = (min) => new Date(ahora - min * 60_000).toISOString();

const fila = (o) => ({
  canal: 'whatsapp',
  tipo: 'mensaje',
  contexto_texto: null,
  numero_propio: '51984429504',
  ventana_abierta: true,
  pregunto: false,
  n: 2,
  nivel: 3,
  ...o,
  referencia: o.referencia ?? hace(90),
  ultimo_at: o.ultimo_at ?? hace(90),
});

const CONVERSACIONES = [
  fila({
    clave: 'conv:whatsapp:51987654321:51984429504',
    persona_id: '51987654321',
    persona_nombre: 'Rosa Quispe Mamani',
    texto: '¿Y cuánto sale el diploma completo?',
    respondida: false,
    pregunto: true,
    pregunto_precio: true,
    etapa_manual: 'cotizado',
    dias: 0,
    referencia: hace(35),
    ultimo_at: hace(35),
  }),
  fila({
    clave: 'conv:whatsapp:51955443322:51984429504',
    persona_id: '51955443322',
    persona_nombre: 'Carlos Huamán',
    texto: 'Ya hice el pago, les mando el voucher',
    respondida: true,
    ya_le_hablamos: true,
    precio_enviado: true,
    etapa_manual: 'cierre',
    dias: 1,
    referencia: hace(300),
    ultimo_at: hace(300),
  }),
  fila({
    clave: 'conv:whatsapp:51933221100:51984429504',
    persona_id: '51933221100',
    persona_nombre: 'Milagros Ríos',
    texto: 'Gracias, lo voy a conversar en casa',
    respondida: true,
    ya_le_hablamos: true,
    etapa_manual: 'contactado',
    dias: 2,
    referencia: hace(1500),
    ultimo_at: hace(1500),
  }),
  // Sin gestión asentada: NO lleva chip. Es la mayoría de la cola, y es lo que
  // hace que el chip signifique algo cuando aparece.
  fila({
    clave: 'conv:whatsapp:51911002233:51984429504',
    persona_id: '51911002233',
    persona_nombre: 'Jorge Salazar',
    texto: 'Hola Quiero más información del Diploma',
    respondida: false,
    etapa_manual: null,
    dias: 0,
    referencia: hace(12),
    ultimo_at: hace(12),
  }),
];

http
  .createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const enviar = (cuerpo, estado = 200) => {
      res.writeHead(estado, {
        'content-type': 'application/json',
        'access-control-allow-origin': '*',
        'access-control-allow-headers': '*',
      });
      res.end(JSON.stringify(cuerpo));
    };
    if (req.method === 'OPTIONS') return enviar({}, 204);

    if (url.pathname === '/api/auth/yo') return enviar({ vendedora: { id: 'luz', nombre: 'Luz' } });
    if (url.pathname === '/api/conversaciones') {
      return enviar({
        conversaciones: CONVERSACIONES,
        total: CONVERSACIONES.length,
        hayMas: false,
        conteosFiltro: { preguntoPrecio: 1, teEscribieron: 2, sinResponder: 2, yaCompraron: 1 },
      });
    }
    // TODO lo demás cae, `/api/dashboard` incluido: es la mitad del experimento.
    return enviar({ ok: false, message: 'stub' }, 503);
  })
  .listen(4199, () => console.log('stub en :4199'));
