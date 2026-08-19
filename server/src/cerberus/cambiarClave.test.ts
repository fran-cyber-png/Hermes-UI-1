import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ResultadoAuth, SesionCerberus } from './auth.js';
import {
  cambiarClaveEnCerberus,
  clasificarRespuestaCambioDeClave,
  type DepsCambioDeClave,
} from './cambiarClave.js';

/**
 * Lo que se fija acá no es el camino feliz: es **qué sesión queda guardada** y
 * **cuándo NO se llega a pedir el cambio**. El defecto que importa —guardar la
 * cookie que el cambio acaba de matar, o mandar la clave nueva a Cerberus con
 * una actual que no validó— deja el mismo `{ok:true}`/`{ok:false}` que el
 * comportamiento correcto si solo se mira el resultado.
 */

const ID = 'luz';
const SESION_FRESCA: SesionCerberus = { sessionid: 'sid-fresca', csrftoken: 'csrf-fresco' };

interface Registro {
  logins: { username: string; password: string }[];
  posts: { url: string; cookie: string; body: URLSearchParams }[];
  guardadas: { vendedoraId: string; sesion: SesionCerberus }[];
}

function armar(escenario: {
  login: ResultadoAuth;
  respuesta?: { status: number; cuerpo?: unknown; setCookie?: string[] } | 'red';
  guardarFalla?: boolean;
}): { deps: DepsCambioDeClave; registro: Registro } {
  const registro: Registro = { logins: [], posts: [], guardadas: [] };
  const deps: DepsCambioDeClave = {
    autenticar: async (username, password) => {
      registro.logins.push({ username, password });
      return escenario.login;
    },
    fetch: (async (url: string | URL | Request, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>;
      registro.posts.push({ url: String(url), cookie: headers.cookie, body: init?.body as URLSearchParams });
      if (escenario.respuesta === 'red') throw new TypeError('fetch failed');
      const r = escenario.respuesta ?? { status: 200, cuerpo: { ok: true } };
      const h = new Headers();
      for (const c of r.setCookie ?? []) h.append('set-cookie', c);
      return new Response(r.cuerpo === undefined ? '' : JSON.stringify(r.cuerpo), { status: r.status, headers: h });
    }) as typeof fetch,
    guardarSesion: async (vendedoraId, sesion) => {
      if (escenario.guardarFalla) throw new Error('base caída');
      registro.guardadas.push({ vendedoraId, sesion });
    },
  };
  return { deps, registro };
}

const LOGIN_OK: ResultadoAuth = { ok: true, vendedora: { id: ID, nombre: ID }, sesion: SESION_FRESCA };

test('camino feliz: entra con la actual, pide el cambio con ESA sesión y guarda la CICLADA', async () => {
  const { deps, registro } = armar({
    login: LOGIN_OK,
    respuesta: {
      status: 200,
      cuerpo: { ok: true },
      setCookie: ['sessionid=sid-ciclada; Path=/; HttpOnly', 'csrftoken=csrf-ciclado; Path=/'],
    },
  });
  const r = await cambiarClaveEnCerberus(ID, 'vieja', 'Nueva-Segura-1', deps);
  assert.deepEqual(r, { ok: true });

  assert.deepEqual(registro.logins, [{ username: ID, password: 'vieja' }]);
  assert.equal(registro.posts.length, 1);
  assert.match(registro.posts[0].url, /\/perfil\/clave\/$/);
  assert.equal(registro.posts[0].cookie, 'sessionid=sid-fresca; csrftoken=csrf-fresco');
  assert.equal(registro.posts[0].body.get('old_password'), 'vieja');
  assert.equal(registro.posts[0].body.get('new_password1'), 'Nueva-Segura-1');
  assert.equal(registro.posts[0].body.get('new_password2'), 'Nueva-Segura-1');
  assert.equal(registro.posts[0].body.get('csrfmiddlewaretoken'), 'csrf-fresco');

  // 🔴 La que se guarda es la del Set-Cookie del cambio, no la que entró.
  assert.deepEqual(registro.guardadas, [{ vendedoraId: ID, sesion: { sessionid: 'sid-ciclada', csrftoken: 'csrf-ciclado' } }]);
});

test('sin Set-Cookie en la respuesta, se guarda la fresca — jamás nada anterior', async () => {
  const { deps, registro } = armar({ login: LOGIN_OK, respuesta: { status: 200, cuerpo: { ok: true } } });
  assert.deepEqual(await cambiarClaveEnCerberus(ID, 'vieja', 'Nueva-Segura-1', deps), { ok: true });
  assert.deepEqual(registro.guardadas, [{ vendedoraId: ID, sesion: SESION_FRESCA }]);
});

test('clave actual incorrecta: NO se pide el cambio y no se guarda nada', async () => {
  const { deps, registro } = armar({ login: { ok: false, motivo: 'usuario o contraseña incorrectos' } });
  const r = await cambiarClaveEnCerberus(ID, 'mala', 'Nueva-Segura-1', deps);
  assert.deepEqual(r, { ok: false, tipo: 'clave_actual_incorrecta' });
  assert.equal(registro.posts.length, 0);
  assert.equal(registro.guardadas.length, 0);
});

test('Cerberus caído en el login es «caído», no «clave incorrecta» — y tampoco se pide el cambio', async () => {
  const { deps, registro } = armar({ login: { ok: false, motivo: 'Cerberus no responde en este momento.', caido: true } });
  const r = await cambiarClaveEnCerberus(ID, 'vieja', 'Nueva-Segura-1', deps);
  assert.deepEqual(r, { ok: false, tipo: 'cerberus_caido' });
  assert.equal(registro.posts.length, 0);
});

test('Django rechaza la nueva: los motivos viajan tal cual y no se guarda sesión', async () => {
  const errores = ['Esta contraseña es demasiado corta. Debe contener al menos 8 caracteres.'];
  const { deps, registro } = armar({ login: LOGIN_OK, respuesta: { status: 400, cuerpo: { ok: false, errores } } });
  const r = await cambiarClaveEnCerberus(ID, 'vieja', '1234', deps);
  assert.deepEqual(r, { ok: false, tipo: 'clave_nueva_rechazada', errores });
  assert.equal(registro.guardadas.length, 0);
});

test('un 404 es «Cerberus sin soporte» (deploy de Hermes antes que el de Cerberus), no una caída', async () => {
  const { deps } = armar({ login: LOGIN_OK, respuesta: { status: 404, cuerpo: undefined } });
  assert.deepEqual(await cambiarClaveEnCerberus(ID, 'vieja', 'Nueva-Segura-1', deps), {
    ok: false,
    tipo: 'cerberus_sin_soporte',
  });
});

test('la red se cae en el POST: caído, y no queda ninguna sesión guardada', async () => {
  const { deps, registro } = armar({ login: LOGIN_OK, respuesta: 'red' });
  assert.deepEqual(await cambiarClaveEnCerberus(ID, 'vieja', 'Nueva-Segura-1', deps), { ok: false, tipo: 'cerberus_caido' });
  assert.equal(registro.guardadas.length, 0);
});

test('si la clave cambió y guardar la sesión falla, la respuesta sigue siendo ok: el cambio es un hecho', async () => {
  const { deps } = armar({ login: LOGIN_OK, respuesta: { status: 200, cuerpo: { ok: true } }, guardarFalla: true });
  assert.deepEqual(await cambiarClaveEnCerberus(ID, 'vieja', 'Nueva-Segura-1', deps), { ok: true });
});

test('la clasificación, caso por caso', () => {
  assert.deepEqual(clasificarRespuestaCambioDeClave(200, { ok: true }), { ok: true });
  // Un 200 que no dice ok:true no es un éxito (una página de mantenimiento con 200, por ejemplo).
  assert.deepEqual(clasificarRespuestaCambioDeClave(200, '<html>'), { ok: false, tipo: 'cerberus_caido' });
  assert.deepEqual(clasificarRespuestaCambioDeClave(200, null), { ok: false, tipo: 'cerberus_caido' });
  assert.deepEqual(clasificarRespuestaCambioDeClave(400, { ok: false, errores: ['a', 'b'] }), {
    ok: false,
    tipo: 'clave_nueva_rechazada',
    errores: ['a', 'b'],
  });
  // Un 400 sin motivo legible no se le puede explicar: es «no se pudo», no «tu clave está mal».
  assert.deepEqual(clasificarRespuestaCambioDeClave(400, { ok: false, errores: [] }), { ok: false, tipo: 'cerberus_caido' });
  assert.deepEqual(clasificarRespuestaCambioDeClave(400, { ok: false, errores: [1, ''] }), { ok: false, tipo: 'cerberus_caido' });
  assert.deepEqual(clasificarRespuestaCambioDeClave(400, {}), { ok: false, tipo: 'cerberus_caido' });
  assert.deepEqual(clasificarRespuestaCambioDeClave(404, null), { ok: false, tipo: 'cerberus_sin_soporte' });
  // El 302 al login (sesión muerta entre el login y el POST) y los 5xx son caída.
  assert.deepEqual(clasificarRespuestaCambioDeClave(302, null), { ok: false, tipo: 'cerberus_caido' });
  assert.deepEqual(clasificarRespuestaCambioDeClave(500, null), { ok: false, tipo: 'cerberus_caido' });
  assert.deepEqual(clasificarRespuestaCambioDeClave(502, '<html>'), { ok: false, tipo: 'cerberus_caido' });
});
