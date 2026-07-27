import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { firmarSesion } from '../auth/sesion.js';
import {
  CODIGO_ERROR_IVI,
  ErrorIvi,
  TIPO_IVI,
  type CodigoErrorIvi,
  type PreguntarAIvi,
  type RespuestaIviConTraza,
  type TurnoHistorial,
} from '../ivi/cliente.js';
import { iviRouter } from './ivi.js';

/**
 * El proxy con el cliente INYECTADO (cero red hacia Ivi): que exija la sesión, valide
 * el body, pase el `usuario` del token, devuelva 200 con la respuesta, y traduzca cada
 * clase de fallo a un 502 con motivo. El server efímero es 127.0.0.1 (loopback): probamos
 * NUESTRA ruta + middleware, no salimos a ningún servicio.
 */

const TOKEN = firmarSesion('ana');

function respuestaValida(): RespuestaIviConTraza {
  return { texto: 'ok', tipo: 'dato', fuentes: [], groundingOk: true, edadDelDato: null, trazaId: 'traza-1' };
}

interface Respuesta {
  status: number;
  json: Record<string, unknown> | null;
}

/** Levanta el router con el cliente inyectado, hace UN request y cierra. */
async function pedir(
  preguntar: PreguntarAIvi,
  opciones: { token?: string; body?: unknown },
): Promise<Respuesta> {
  const app = express();
  app.use(express.json());
  app.use('/api/ivi', iviRouter(preguntar));

  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;

  try {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (opciones.token) headers.authorization = `Bearer ${opciones.token}`;
    const resp = await fetch(`http://127.0.0.1:${port}/api/ivi/preguntar`, {
      method: 'POST',
      headers,
      body: JSON.stringify(opciones.body ?? {}),
    });
    const json = (await resp.json().catch(() => null)) as Record<string, unknown> | null;
    return { status: resp.status, json };
  } finally {
    server.close();
    await once(server, 'close');
  }
}

describe('POST /api/ivi/preguntar', () => {
  test('sin token: 401 y ni llama al cliente', async () => {
    let llamado = false;
    const preguntar: PreguntarAIvi = async () => {
      llamado = true;
      return respuestaValida();
    };
    const r = await pedir(preguntar, { body: { pregunta: 'hola' } });
    assert.equal(r.status, 401);
    assert.equal(llamado, false);
  });

  test('body inválido (sin pregunta): 400 y ni llama al cliente', async () => {
    let llamado = false;
    const preguntar: PreguntarAIvi = async () => {
      llamado = true;
      return respuestaValida();
    };
    const r = await pedir(preguntar, { token: TOKEN, body: {} });
    assert.equal(r.status, 400);
    assert.equal(llamado, false);
  });

  test('pregunta que pasa el tope de tamaño: 400 y ni llama al cliente (#98, sin amplificación hacia Ivi)', async () => {
    let llamado = false;
    const preguntar: PreguntarAIvi = async () => {
      llamado = true;
      return respuestaValida();
    };
    const r = await pedir(preguntar, { token: TOKEN, body: { pregunta: 'x'.repeat(4_001) } });
    assert.equal(r.status, 400);
    assert.equal(llamado, false);
  });

  test('historial con más turnos que el tope: 400 y ni llama al cliente (#98)', async () => {
    let llamado = false;
    const preguntar: PreguntarAIvi = async () => {
      llamado = true;
      return respuestaValida();
    };
    const historialEnorme: TurnoHistorial[] = Array.from({ length: 31 }, () => ({
      rol: 'vendedora' as const,
      texto: 'hola',
    }));
    const r = await pedir(preguntar, { token: TOKEN, body: { pregunta: 'hola', historial: historialEnorme } });
    assert.equal(r.status, 400);
    assert.equal(llamado, false);
  });

  test('éxito: 200 con la respuesta, y el usuario sale del token', async () => {
    let visto: { pregunta: string; usuario: string; historial?: TurnoHistorial[] } | null = null;
    const preguntar: PreguntarAIvi = async (pregunta, usuario, historial) => {
      visto = { pregunta, usuario, historial };
      return respuestaValida();
    };
    const historial: TurnoHistorial[] = [{ rol: 'vendedora', texto: 'hola' }];
    const r = await pedir(preguntar, { token: TOKEN, body: { pregunta: '¿ventas?', historial } });

    assert.equal(r.status, 200);
    assert.equal(r.json?.ok, true);
    assert.deepEqual(r.json?.respuesta, respuestaValida());
    assert.equal(visto!.pregunta, '¿ventas?');
    assert.equal(visto!.usuario, 'ana'); // del token, no del body
    assert.deepEqual(visto!.historial, historial);
  });

  test('cada clase de ErrorIvi → 502 con su codigo y motivo', async () => {
    const codigos = Object.values(CODIGO_ERROR_IVI) as CodigoErrorIvi[];
    for (const codigo of codigos) {
      const preguntar: PreguntarAIvi = async () => {
        throw new ErrorIvi(codigo, `falló: ${codigo}`);
      };
      const r = await pedir(preguntar, { token: TOKEN, body: { pregunta: 'hola' } });
      assert.equal(r.status, 502, `codigo ${codigo}`);
      assert.equal(r.json?.ok, false);
      assert.equal(r.json?.codigo, codigo);
      assert.equal(typeof r.json?.message, 'string');
    }
  });

  test('un error no tipado → 502 genérico, sin inventar respuesta', async () => {
    const preguntar: PreguntarAIvi = async () => {
      throw new Error('boom inesperado');
    };
    const r = await pedir(preguntar, { token: TOKEN, body: { pregunta: 'hola' } });
    assert.equal(r.status, 502);
    assert.equal(r.json?.ok, false);
    assert.equal(r.json?.codigo, CODIGO_ERROR_IVI.DESCONOCIDO);
    assert.equal(r.json?.reintentable, false, 'un bug nuestro no se arregla preguntando otra vez');
  });
});

/**
 * H4 — la mitad que faltaba del fail-closed: que un fallo se vea como fallo NO puede
 * costar que una respuesta honesta se vea como fallo. Los dos caminos, uno al lado del otro.
 */
describe('POST /api/ivi/preguntar — SIN_EVIDENCIA sale por el camino de las respuestas', () => {
  test('200 con tipo SIN_EVIDENCIA: la app lo recibe como respuesta, no como error', async () => {
    let llamadas = 0;
    const preguntar: PreguntarAIvi = async () => {
      llamadas += 1;
      return {
        ...respuestaValida(),
        texto: 'No tengo datos para responder eso.',
        tipo: TIPO_IVI.SIN_EVIDENCIA,
        groundingOk: false,
      };
    };
    const r = await pedir(preguntar, { token: TOKEN, body: { pregunta: '¿ventas en Marte?' } });

    assert.equal(r.status, 200, 'un «no sé» de Ivi NO es un 502');
    assert.equal(r.json?.ok, true);
    const respuesta = r.json?.respuesta as Record<string, unknown>;
    assert.equal(respuesta.tipo, TIPO_IVI.SIN_EVIDENCIA, 'el tipo llega intacto: la UI ramifica con él');
    assert.equal(respuesta.texto, 'No tengo datos para responder eso.');
    assert.equal(llamadas, 1, 'la ruta no reintenta: Ivi ya decidió');
    assert.equal('codigo' in (r.json ?? {}), false, 'sin `codigo`: no es un error');
  });

  test('la traza vuelve en el éxito y en el 502 — es lo único que cruza los dos logs', async () => {
    const ok = await pedir(async () => respuestaValida(), { token: TOKEN, body: { pregunta: 'hola' } });
    assert.equal(ok.json?.trazaId, 'traza-1');

    const falla: PreguntarAIvi = async () => {
      const e = new ErrorIvi(CODIGO_ERROR_IVI.TIMEOUT, 'tardó');
      e.trazaId = 'traza-2';
      throw e;
    };
    const mal = await pedir(falla, { token: TOKEN, body: { pregunta: 'hola' } });
    assert.equal(mal.status, 502);
    assert.equal(mal.json?.trazaId, 'traza-2');
    assert.equal(mal.json?.reintentable, true, 'un timeout sí se puede reintentar');
  });
});
