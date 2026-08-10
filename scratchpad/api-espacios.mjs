import http from 'node:http';

/**
 * Stub de API para capturar la evidencia de la Libreta con espacios (ADR 0046).
 * Contesta lo mínimo y 503 a todo lo demás — con `{}` amable, los hijos revientan
 * al hacer `data?.campo.find(...)`.
 */

const ESPACIOS = [
  { id: 7, nombre: 'Equipo de ventas', creadaPor: 'luz', creadoAt: '2026-08-05T00:00:00Z', miembros: ['luz', 'Sindy', 'ventas10@grupogoberna.com'] },
  { id: 9, nombre: 'Precios y objeciones', creadaPor: 'luz', creadoAt: '2026-08-08T00:00:00Z', miembros: ['luz', 'Tracy'] },
];

const PADRON = ['Luz', 'Sindy', 'Tracy', 'Walter', 'ventas10@grupogoberna.com', 'ventas11@grupogoberna.com', 'ventas12@grupogoberna.com'];

const pagina = (id, texto, vendedoraId, espacioId, creadoAt, editadoAt = null, fijada = false, token = null) => ({
  id, clave: 'general', vendedoraId, texto, doc: null, fijada,
  creadoAt, editadoAt, archivadoAt: null, origen: 'nota', espacioId, token,
});

const PAGINAS = {
  privada: [
    pagina(1, 'Primera nota\nVoy a hacer llamadas', 'luz', null, '2026-08-04T20:27:50Z', '2026-08-10T14:29:05Z'),
    pagina(5, 'Mis pendientes de mañana\nLlamar a los 3 de Gestión Pública', 'luz', null, '2026-08-07T23:12:33Z'),
  ],
  7: [
    pagina(11, 'Precios México 2026\nDiplomado: MXN 4,900 · cuotas: 2 de 2,450', 'Sindy', 7, '2026-08-06T15:00:00Z', '2026-08-09T11:02:00Z', true, '7f3a9c2e8b1d40561122334455667788'),
    pagina(12, 'Objeción: «lo voy a pensar»\nLo que mejor funcionó: preguntar cuándo arranca su gestión', 'luz', 7, '2026-08-07T09:30:00Z'),
    pagina(13, 'Dónde pagar por país\nPerú: Yape / BCP · Ecuador: Banco Pichincha', 'ventas10@grupogoberna.com', 7, '2026-08-08T18:45:00Z', '2026-08-10T08:15:00Z'),
  ],
  9: [],
};

http
  .createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const enviar = (cuerpo, estado = 200) => {
      res.writeHead(estado, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' });
      res.end(JSON.stringify(cuerpo));
    };
    if (req.method === 'OPTIONS') return enviar({}, 204);

    if (url.pathname === '/api/auth/yo') return enviar({ vendedora: { id: 'luz', nombre: 'Luz' } });
    if (url.pathname === '/api/espacios/padron') return enviar({ personas: PADRON });
    if (url.pathname === '/api/espacios') return enviar({ espacios: ESPACIOS });
    if (/^\/api\/notas\/\d+\/link$/.test(url.pathname)) return enviar({ ok: true, token: '7f3a9c2e8b1d40561122334455667788' });
    if (/^\/api\/notas\/\d+\/mover$/.test(url.pathname)) return enviar({ ok: true });
    if (url.pathname === '/api/notas') {
      if (url.searchParams.get('q')) return enviar({ notas: [] });
      return enviar({ notas: PAGINAS[url.searchParams.get('espacio') ?? 'privada'] ?? [] });
    }
    return enviar({ ok: false, message: 'stub' }, 503);
  })
  .listen(4199, () => console.log('stub en :4199'));
