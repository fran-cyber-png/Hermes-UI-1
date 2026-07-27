import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ErrorApi } from './cliente';

/**
 * EL BORDE DONDE SE PERDÍA `reintentable` (#175).
 *
 * `api()` es el único `fetch` del front, así que es el único lugar donde un campo del cuerpo
 * de error puede desaparecer para siempre. Y desapareció: el server calculaba `reintentable`
 * con el estado HTTP a la vista, lo mandaba en cada 502 **para que la app no reimplementara la
 * tabla de códigos**, y acá se descartaba en silencio — la clase ni tenía el campo. La pantalla
 * la reimplementó igual, y las dos tablas ya decían cosas distintas antes de mergear.
 *
 * Un campo que se cae en un borde no se ve en ninguna pantalla ni en ningún log: se ve acá.
 */

function respuestaDeError(cuerpo: unknown, status = 502): Response {
  return new Response(JSON.stringify(cuerpo), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Deja `fetch` devolviendo lo que se le pase, y se limpia solo. */
function fetchDevuelve(res: Response) {
  vi.stubGlobal('fetch', () => Promise.resolve(res));
}

beforeEach(() => {
  // `api()` mete el token de la vendedora en cada request, y lo lee de `localStorage`. Este
  // archivo corre en el entorno `node` de siempre (no es un test de DOM: no monta nada), así
  // que se le da lo mínimo para que el request se arme. Sin esto el `TypeError` de
  // `tokenGuardado` sale ANTES del borde que acá se mide, y todo falla por el motivo equivocado.
  vi.stubGlobal('localStorage', {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * `api()` siempre tira acá: el `await expect(...).rejects` deja escapar el tipo.
 *
 * El `instanceof` NO es decorativo. Sin él, cualquier otro throw —un `TypeError` porque falta
 * `localStorage`, por ejemplo— se devolvía como si fuera el `ErrorApi` esperado, y los tests que
 * afirman `reintentable === undefined` pasaban VACÍOS: leer `.reintentable` de un `TypeError`
 * también da `undefined`. Pasó de verdad al escribir este archivo.
 */
async function errorDe(res: Response): Promise<ErrorApi> {
  fetchDevuelve(res);
  try {
    await api('/api/ivi/preguntar', { method: 'POST' });
  } catch (e) {
    if (!(e instanceof ErrorApi)) {
      throw new Error(`api() tiró algo que no es ErrorApi: ${String(e)}`);
    }
    return e;
  }
  throw new Error('se esperaba que api() tirara y no tiró');
}

describe('api() — lo que el server dice sobre el error llega entero', () => {
  it('`reintentable: true` cruza el borde', async () => {
    const err = await errorDe(
      respuestaDeError({ ok: false, codigo: 'http_inesperado', message: 'Ivi falló', reintentable: true }),
    );
    expect(err).toBeInstanceOf(ErrorApi);
    expect(err.codigo).toBe('http_inesperado');
    expect(err.reintentable).toBe(true);
  });

  it('`reintentable: false` también cruza — no se confunde con «no vino»', async () => {
    const err = await errorDe(
      respuestaDeError({ ok: false, codigo: 'falta_config', reintentable: false }),
    );
    expect(err.reintentable).toBe(false);
  });

  it('sin el campo queda `undefined`, que es lo que le cede la decisión a la tabla del front', async () => {
    const err = await errorDe(respuestaDeError({ ok: false, codigo: 'timeout' }));
    expect(err.reintentable).toBeUndefined();
  });

  it('un `reintentable` que no es booleano NO se interpreta: `null` y una cadena no son «false»', async () => {
    // Si `null` se leyera como falsy, un server que manda `null` apagaría el botón afirmando
    // algo que nunca dijo. La ausencia de opinión tiene que ser distinguible de un «no».
    expect((await errorDe(respuestaDeError({ codigo: 'timeout', reintentable: null }))).reintentable).toBeUndefined();
    expect((await errorDe(respuestaDeError({ codigo: 'timeout', reintentable: 'true' }))).reintentable).toBeUndefined();
  });

  it('un cuerpo de error que no es JSON no rompe: sigue habiendo `ErrorApi` con su estado', async () => {
    fetchDevuelve(new Response('<html>502 Bad Gateway</html>', { status: 502 }));
    await expect(api('/api/ivi/preguntar')).rejects.toBeInstanceOf(ErrorApi);
  });
});
