import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import type { NextFunction, Request, Response } from 'express';
import { esRutaAbierta, perimetroApi } from './perimetro.js';
import { firmarSesion } from './sesion.js';

/**
 * EL PERÍMETRO ES LA REGLA, NO LA EXCEPCIÓN. La API es pública por HTTPS
 * (hermes-api.goberna.us) y durante meses 19 de 27 routers quedaron montados sin
 * auth — la cola entera, los hilos y los adjuntos de clientes reales, abiertos a
 * internet (issue #36). Estos tests fijan el contrato inverso: TODO `/api/*`
 * exige vendedora salvo lo enumerado a mano, con su porqué.
 */

describe('esRutaAbierta — qué queda fuera del token', () => {
  test('el login y la validación de sesión quedan abiertos (sin esto nadie consigue token)', () => {
    assert.equal(esRutaAbierta('/api/auth/login'), true);
    assert.equal(esRutaAbierta('/api/auth/yo'), true); // valida su propio Bearer adentro
  });

  test('lo que no es /api no es de este perímetro (webhooks, health, la UI servida)', () => {
    assert.equal(esRutaAbierta('/health'), true);
    assert.equal(esRutaAbierta('/webhook/cerberus'), true); // trae su propio token
    assert.equal(esRutaAbierta('/webhook/landing/abc'), true); // token en la ruta
    assert.equal(esRutaAbierta('/'), true);
    assert.equal(esRutaAbierta('/assets/index-abc123.js'), true);
  });

  test('las rutas de dev quedan exentas SOLO fuera de producción', () => {
    assert.equal(esRutaAbierta('/api/whatsapp/_sim/entrante', false), true);
    assert.equal(esRutaAbierta('/api/whatsapp/_dev/mensaje', false), true);
  });

  test('en producción NO hay agujeros de dev que recordar: _sim y _dev exigen token', () => {
    // El ADR 0011 dice «el perímetro no depende de que alguien se acuerde»;
    // una exención incondicional re-creaba exactamente ese patrón (si algún
    // día _sim/_dev se montaran en prod, nacían abiertas).
    assert.equal(esRutaAbierta('/api/whatsapp/_sim/entrante', true), false);
    assert.equal(esRutaAbierta('/api/whatsapp/_dev/mensaje', true), false);
    assert.equal(esRutaAbierta('/api/auth/login', true), true); // el login sí, siempre
  });

  test('lo que el issue #36 encontró abierto queda CERRADO', () => {
    assert.equal(esRutaAbierta('/api/conversaciones'), false); // la cola entera
    assert.equal(esRutaAbierta('/api/whatsapp/conversacion/51999888777'), false); // el hilo
    assert.equal(esRutaAbierta('/api/whatsapp/media/adjunto.jpg'), false); // los adjuntos
    assert.equal(esRutaAbierta('/api/responder/123'), false); // publica en Facebook
    assert.equal(esRutaAbierta('/api/persona/123'), false);
    assert.equal(esRutaAbierta('/api/interactions'), false);
    assert.equal(esRutaAbierta('/api/sdk/catalogo'), false);
    assert.equal(esRutaAbierta('/api/sdk/invocar/no.existe'), false);
    assert.equal(esRutaAbierta('/api/config'), false); // reconfigura cuentas de pauta
    assert.equal(esRutaAbierta('/api/stream'), false); // los eventos llevan teléfonos
  });

  test('el catálogo de piezas queda fuera del token DE VENDEDORA, no sin puerta', () => {
    // Lo consume Ivi, que es un proceso: no hay vendedora que haya hecho login.
    // Su puerta es `requiereServicioDeCatalogo` (otro secreto, otra identidad),
    // montada tanto en index.ts como dentro del router — lo mismo que /api/admin.
    assert.equal(esRutaAbierta('/api/catalogo/piezas'), true);
    assert.equal(esRutaAbierta('/api/catalogo/vocabulario'), true);
  });

  test('un prefijo abierto no abre a sus vecinos con nombre parecido', () => {
    assert.equal(esRutaAbierta('/api/authx'), false);
    assert.equal(esRutaAbierta('/api/catalogos'), false);
    assert.equal(esRutaAbierta('/api/whatsapp/_simulador'), false);
    assert.equal(esRutaAbierta('/api/auth'), true); // el prefijo exacto sí
  });

  test('/api/admin queda exento: su puerta es la credencial de servicio, no la vendedora', () => {
    // Cerberus llama con HERMES_ADMIN_SERVICE_TOKEN (requiereServicio, #85).
    // Si el perímetro le exigiera además token de vendedora, el token de
    // servicio moriría en verificarSesion antes de llegar a su middleware.
    assert.equal(esRutaAbierta('/api/admin/numeros/51999888777'), true);
    assert.equal(esRutaAbierta('/api/adminx'), false); // el vecino no hereda
  });

  test('las mayúsculas no esquivan el perímetro (Express rutea case-insensitive)', () => {
    // Sin esto, GET /API/conversaciones pasaba la guardia («no es /api/») y
    // el router lo atendía igual, porque Express matchea sin distinguir caja.
    assert.equal(esRutaAbierta('/API/conversaciones'), false);
    assert.equal(esRutaAbierta('/Api/Whatsapp/Media/adjunto.jpg'), false);
    assert.equal(esRutaAbierta('/API/AUTH/LOGIN'), true); // y el login sigue entrando
  });
});

/** Fakes mínimos: alcanza con lo que `perimetroApi` y `requiereVendedora` tocan. */
function requestDe(path: string, token?: string): Request {
  return {
    path,
    headers: token ? { authorization: `Bearer ${token}` } : {},
  } as unknown as Request;
}

function responseFalsa() {
  const r = {
    codigo: 0,
    cuerpo: undefined as unknown,
    status(c: number) {
      this.codigo = c;
      return this;
    },
    json(b: unknown) {
      this.cuerpo = b;
      return this;
    },
  };
  return r as typeof r & Response;
}

describe('perimetroApi — el middleware delante de todo', () => {
  test('sin token, una ruta de datos devuelve 401 y NO sigue', () => {
    const res = responseFalsa();
    let siguio = false;
    perimetroApi(requestDe('/api/conversaciones'), res, (() => {
      siguio = true;
    }) as NextFunction);
    assert.equal(res.codigo, 401);
    assert.equal(siguio, false);
  });

  test('con un token válido, la ruta de datos sigue y cuelga la vendedora', () => {
    const req = requestDe('/api/conversaciones', firmarSesion('Usuario1'));
    const res = responseFalsa();
    let siguio = false;
    perimetroApi(req, res, (() => {
      siguio = true;
    }) as NextFunction);
    assert.equal(siguio, true);
    assert.equal(req.vendedoraId, 'Usuario1');
  });

  test('el login pasa sin token — si no, nadie podría conseguir uno', () => {
    const res = responseFalsa();
    let siguio = false;
    perimetroApi(requestDe('/api/auth/login'), res, (() => {
      siguio = true;
    }) as NextFunction);
    assert.equal(siguio, true);
    assert.equal(res.codigo, 0);
  });

  test('lo que no es /api (webhooks, la UI) pasa: tienen su propia puerta', () => {
    const res = responseFalsa();
    let siguio = false;
    perimetroApi(requestDe('/webhook/cerberus'), res, (() => {
      siguio = true;
    }) as NextFunction);
    assert.equal(siguio, true);
  });

  test('decide sin leer el body: va montado ANTES de express.json() a propósito', () => {
    // Un anónimo no merece ni el parseo de su JSON. El fake ni tiene `body`, y
    // además lo declara con un getter que revienta si alguien lo toca.
    const req = requestDe('/api/conversaciones');
    Object.defineProperty(req, 'body', {
      get() {
        throw new Error('el perímetro no debe leer el body');
      },
    });
    const res = responseFalsa();
    perimetroApi(req, res, (() => {}) as NextFunction);
    assert.equal(res.codigo, 401);
  });
});
