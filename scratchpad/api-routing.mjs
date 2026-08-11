import http from 'node:http';

/**
 * Stub de API para VER el riel con la vista Routing sin levantar Postgres ni
 * Cerberus. Contesta lo mínimo —login y «quién soy»— y **503 a todo lo demás**:
 * con un `{}` amable los hijos revientan al hacer `data?.campo.find(...)`, y con
 * un fallo cada vista cae en su estado de error, que es lo que hace que quede
 * en pie justo lo que se quiere mirar (el shell y su riel).
 *
 * ⚠️ El `.env` de la raíz apunta el front a producción: hay que arrancar Vite
 * con `VITE_API_URL=http://localhost:4199` o «local» le pega a hermes-api.
 *
 * Entrás con CUALQUIER usuario y CUALQUIER contraseña — el punto es cambiar de
 * `vendedora_id` a voluntad para ver quién tiene Routing y quién no.
 */

const CATORCE_DIAS = 14 * 24 * 60 * 60 * 1000;

const firmar = (id) =>
  `${Buffer.from(`${id}|${Date.now() + CATORCE_DIAS}`).toString('base64url')}.stub-sin-firma`;

const quienEs = (token) => {
  try {
    return Buffer.from(String(token).split('.')[0], 'base64url').toString().split('|')[0] || null;
  } catch {
    return null;
  }
};

http
  .createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const enviar = (cuerpo, estado = 200) => {
      res.writeHead(estado, {
        'content-type': 'application/json',
        'access-control-allow-origin': '*',
        'access-control-allow-headers': '*',
        'access-control-allow-methods': '*',
      });
      res.end(JSON.stringify(cuerpo));
    };
    if (req.method === 'OPTIONS') return enviar({}, 204);

    if (url.pathname === '/api/auth/login') {
      let cuerpo = '';
      req.on('data', (c) => (cuerpo += c));
      return req.on('end', () => {
        const { username } = JSON.parse(cuerpo || '{}');
        const id = String(username || '').trim();
        if (!id) return enviar({ ok: false, message: 'falta el usuario' }, 401);
        console.log(`[stub] entra ${id}`);
        return enviar({ token: firmar(id), vendedora: { id, nombre: id } });
      });
    }

    if (url.pathname === '/api/auth/yo') {
      const id = quienEs((req.headers.authorization ?? '').replace(/^Bearer /, ''));
      if (!id) return enviar({ ok: false, message: 'sin sesión' }, 401);
      return enviar({ vendedora: { id, nombre: id }, cerberus: true });
    }

    return enviar({ ok: false, message: 'stub: acá no hay server' }, 503);
  })
  .listen(4199, () => console.log('stub en :4199 — entrá con alan / usuario1 / luz'));
