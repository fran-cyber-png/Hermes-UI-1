import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { EnvioControlado, type OrdenEnvio, type RegistroEnvios } from './envioControlado.js';
import { TransporteFalso } from './transporteFalso.js';
import type { EstadoSesion, MensajeWhatsapp, ResultadoEnvio, TransporteWhatsapp } from './transporte.js';
import { A_MANO, deUnDato, deUnPasoDePlantilla } from '../procedencia/pieza.js';

/**
 * EnvioControlado es la puerta por la que sale TODO mensaje. Estos tests fijan las
 * garantías que la separan de un bot: una orden = un envío, cada intento auditado,
 * el corta-corriente y el ban frenan sin reintentar.
 */

/** Registro de auditoría en memoria: guarda qué se intentó y con qué resultado. */
class RegistroFalso implements RegistroEnvios {
  readonly intentos: OrdenEnvio[] = [];
  readonly enviados: { id: number; idExterno: string }[] = [];
  readonly fallidos: { id: number; motivo: string }[] = [];
  private siguiente = 1;

  async registrarIntento(orden: OrdenEnvio): Promise<number> {
    const id = this.siguiente++;
    this.intentos.push(orden);
    return id;
  }
  async marcarEnviado(id: number, idExterno: string): Promise<void> {
    this.enviados.push({ id, idExterno });
  }
  async marcarFallido(id: number, motivo: string): Promise<void> {
    this.fallidos.push({ id, motivo });
  }
}

const orden = (over: Partial<OrdenEnvio> = {}): OrdenEnvio => ({
  vendedoraId: 'ana',
  numeroPropio: '51987654321',
  telefono: '51961506674',
  texto: 'con gusto, te paso el temario',
  referencia: 'conv:whatsapp:51961506674:51987654321',
  ...over,
});

describe('EnvioControlado', () => {
  test('T9 — una orden = un envío, con auditoría de quién y a quién', async () => {
    const transporte = new TransporteFalso({ telefono: '51987654321' });
    const registro = new RegistroFalso();
    const envio = new EnvioControlado(transporte, registro);

    const r = await envio.enviar(orden());

    assert.ok(r.ok);
    assert.equal(transporte.enviados.length, 1, 'exactamente un envío al transporte');
    assert.equal(registro.enviados.length, 1);
    assert.equal(registro.enviados[0].idExterno, transporte.enviados[0].idExterno);
    // La auditoría sabe quién mandó y a quién.
    assert.equal(registro.intentos[0].vendedoraId, 'ana');
    assert.equal(registro.intentos[0].telefono, '51961506674');
  });

  test('T10 — sin vendedora, el transporte no recibe nada y no se audita', async () => {
    const transporte = new TransporteFalso({ telefono: '51987654321' });
    const registro = new RegistroFalso();
    const envio = new EnvioControlado(transporte, registro);

    const r = await envio.enviar(orden({ vendedoraId: '' }));

    assert.equal(r.ok, false);
    assert.equal(transporte.enviados.length, 0);
    assert.equal(registro.intentos.length, 0, 'una orden malformada no ensucia la auditoría');
  });

  test('T11 — corta-corriente: rechazo con motivo, cero envíos, intento auditado como bloqueado', async () => {
    const transporte = new TransporteFalso({ telefono: '51987654321' });
    const registro = new RegistroFalso();
    const envio = new EnvioControlado(transporte, registro, () => true); // freno activo

    const r = await envio.enviar(orden());

    assert.equal(r.ok, false);
    assert.match((r as { motivo: string }).motivo, /corta-corriente/i);
    assert.equal(transporte.enviados.length, 0, 'el transporte no se toca');
    // El intento SÍ queda: un envío bloqueado es parte de la auditoría.
    assert.equal(registro.intentos.length, 1);
    assert.equal(registro.fallidos.length, 1);
  });

  test('T12 — sesión baneada: rechazo visible con la fecha, sin llamar al transporte', async () => {
    const transporte = new TransporteFalso({ telefono: '51987654321' });
    transporte.simularBan('191', 'en 24 horas');
    const registro = new RegistroFalso();
    const envio = new EnvioControlado(transporte, registro);

    const r = await envio.enviar(orden());

    assert.equal(r.ok, false);
    assert.match((r as { motivo: string }).motivo, /suspendido|191|24 horas/i);
    assert.equal(transporte.enviados.length, 0);
    assert.equal(registro.fallidos.length, 1);
  });

  test('T9b — TOCTOU: la sesión pasa el chequeo pero el envío falla → intento fallido, sin saliente fantasma', async () => {
    // Un transporte que se REPORTA conectado pero cuyo enviarTexto explota: simula
    // el ban que llega justo entre el chequeo de estado y el envío.
    const transporteTraidor: TransporteWhatsapp = {
      nombre: 'falso',
      numeroPropio: '51987654321',
      async iniciar() {},
      estado(): EstadoSesion {
        return { estado: 'conectado', telefono: '51987654321' };
      },
      onMensaje(_cb: (m: MensajeWhatsapp) => void) {},
      onEstado(_cb: (e: EstadoSesion) => void) {},
      async enviarTexto(): Promise<ResultadoEnvio> {
        throw new Error('el número se baneó en el envío');
      },
      async enviarMedia(): Promise<ResultadoEnvio> {
        throw new Error('el número se baneó en el envío');
      },
      async marcarLeido() {},
      async detener() {},
    };
    const registro = new RegistroFalso();
    const envio = new EnvioControlado(transporteTraidor, registro);

    const r = await envio.enviar(orden());

    assert.equal(r.ok, false);
    // El intento quedó registrado como fallido — nunca como enviado.
    assert.equal(registro.enviados.length, 0, 'no hay saliente fantasma');
    assert.equal(registro.fallidos.length, 1);
  });
});

/**
 * Los adjuntos salen por la MISMA puerta y con las MISMAS garantías. Estos tests
 * fijan que enviarMedia no es un bypass: audita, exige vendedora y respeta el ban.
 */
describe('EnvioControlado — media', () => {
  const media = { ruta: '/tmp/flyer.pdf', clase: 'documento' as const, mime: 'application/pdf', nombre: 'flyer.pdf', texto: null };

  test('T-M1 — un adjunto = un envío, auditado con descripción del archivo', async () => {
    const transporte = new TransporteFalso({ telefono: '51987654321' });
    const registro = new RegistroFalso();
    const envio = new EnvioControlado(transporte, registro);

    const r = await envio.enviarMedia({ ...orden(), media });

    assert.equal(r.ok, true);
    assert.equal(transporte.enviadosMedia.length, 1);
    assert.equal(transporte.enviadosMedia[0].media.nombre, 'flyer.pdf');
    assert.equal(registro.intentos.length, 1);
    assert.match(registro.intentos[0].texto, /flyer\.pdf/);
    assert.equal(registro.enviados.length, 1);
  });

  test('T-M2 — sin archivo o sin vendedora, el transporte no recibe nada', async () => {
    const transporte = new TransporteFalso({ telefono: '51987654321' });
    const registro = new RegistroFalso();
    const envio = new EnvioControlado(transporte, registro);

    const sinArchivo = await envio.enviarMedia({ ...orden(), media: { ...media, ruta: '' } });
    const sinVendedora = await envio.enviarMedia({ ...orden({ vendedoraId: '' }), media });

    assert.equal(sinArchivo.ok, false);
    assert.equal(sinVendedora.ok, false);
    assert.equal(transporte.enviadosMedia.length, 0);
    assert.equal(registro.intentos.length, 0);
  });

  test('T-M3 — sesión baneada: rechazo visible, cero llamadas al transporte', async () => {
    const transporte = new TransporteFalso({ telefono: '51987654321' });
    const registro = new RegistroFalso();
    const envio = new EnvioControlado(transporte, registro);
    transporte.simularBan('191', 'mañana');

    const r = await envio.enviarMedia({ ...orden(), media });

    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.motivo, /suspendido/);
    assert.equal(transporte.enviadosMedia.length, 0);
    assert.equal(registro.fallidos.length, 1);
  });
});

/**
 * LA EXCEPCIÓN DECLARADA (#125, ADR 0015): la auto-respuesta fuera de horario
 * pasa por esta MISMA puerta. Lo que estos tests fijan es que se note.
 */
describe('EnvioControlado — la marca de automático', () => {
  test('un envío humano NO viaja marcado: el default es «lo apretó una persona»', async () => {
    const transporte = new TransporteFalso({ telefono: '51987654321' });
    const registro = new RegistroFalso();
    const envio = new EnvioControlado(transporte, registro);

    await envio.enviar(orden());

    assert.equal(registro.intentos[0].automatico, undefined);
  });

  test('un envío automático queda marcado en la auditoría, con las mismas guardas', async () => {
    const transporte = new TransporteFalso({ telefono: '51987654321' });
    const registro = new RegistroFalso();
    const envio = new EnvioControlado(transporte, registro);

    const r = await envio.enviar(orden({ vendedoraId: 'auto-respuesta', automatico: true }));

    assert.ok(r.ok);
    assert.equal(registro.intentos[0].automatico, true);
    assert.equal(registro.intentos[0].vendedoraId, 'auto-respuesta', 'el autor no finge ser una vendedora');
  });

  test('automático NO es un pase libre: el corta-corriente lo frena igual', async () => {
    const transporte = new TransporteFalso({ telefono: '51987654321' });
    const registro = new RegistroFalso();
    const envio = new EnvioControlado(transporte, registro, () => true);

    const r = await envio.enviar(orden({ vendedoraId: 'auto-respuesta', automatico: true }));

    assert.equal(r.ok, false);
    assert.equal(transporte.enviados.length, 0);
    assert.equal(registro.fallidos.length, 1);
  });
});

/**
 * LA PROCEDENCIA VIAJA EN LA ORDEN (épica #169). No es un `update` posterior:
 * viaja por la MISMA puerta, se audita en la MISMA fila, y por eso un envío
 * bloqueado también deja escrito de qué pieza iba a salir.
 */
describe('EnvioControlado — de qué pieza salió', () => {
  test('sin declarar pieza, el intento queda como escrito a mano: LA LÍNEA DE BASE', async () => {
    const transporte = new TransporteFalso({ telefono: '51987654321' });
    const registro = new RegistroFalso();
    const envio = new EnvioControlado(transporte, registro);

    await envio.enviar(orden());

    // No es `undefined` ni un hueco: es un valor con nombre. Contra esto se
    // compara toda pieza, así que tiene que existir aunque nadie lo declare.
    assert.deepEqual(registro.intentos[0].procedencia, A_MANO);
  });

  test('la pieza declarada llega entera a la auditoría', async () => {
    const transporte = new TransporteFalso({ telefono: '51987654321' });
    const registro = new RegistroFalso();
    const envio = new EnvioControlado(transporte, registro);

    const pieza = deUnPasoDePlantilla({
      plantillaId: 12,
      orden: 3,
      via: 'panel-sugerencia',
      contenido: { texto: 'hola {nombre}' },
    });
    await envio.enviar(orden({ procedencia: pieza }));

    assert.deepEqual(registro.intentos[0].procedencia, pieza);
  });

  test('un envío BLOQUEADO también deja escrita la pieza que se iba a mandar', async () => {
    // Si la procedencia se anotara recién al confirmar el envío, los bloqueos
    // quedarían como escritos a mano — o sea, el freno ensuciaría la línea de
    // base con envíos que ni siquiera salieron.
    const transporte = new TransporteFalso({ telefono: '51987654321' });
    const registro = new RegistroFalso();
    const envio = new EnvioControlado(transporte, registro, () => true);

    const pieza = deUnDato({ clave: 'cuotas', editada: false, contenido: { texto: 'en 2 cuotas' } });
    const r = await envio.enviar(orden({ procedencia: pieza }));

    assert.equal(r.ok, false);
    assert.equal(registro.fallidos.length, 1);
    assert.deepEqual(registro.intentos[0].procedencia, pieza);
  });

  test('un adjunto declara pieza igual que un texto (misma puerta, misma auditoría)', async () => {
    const transporte = new TransporteFalso({ telefono: '51987654321' });
    const registro = new RegistroFalso();
    const envio = new EnvioControlado(transporte, registro);

    const pieza = deUnPasoDePlantilla({
      plantillaId: 4,
      orden: 1,
      via: 'panel-secuencias',
      contenido: { texto: null, archivo: 'flyer.jpg' },
    });
    await envio.enviarMedia({
      vendedoraId: 'ana',
      numeroPropio: '51987654321',
      telefono: '51961506674',
      referencia: 'conv:whatsapp:51961506674:51987654321',
      media: { ruta: '/tmp/flyer.jpg', clase: 'imagen', mime: 'image/jpeg', nombre: 'flyer.jpg', texto: null },
      procedencia: pieza,
    });

    assert.deepEqual(registro.intentos[0].procedencia, pieza);
  });

  test('un adjunto sin pieza también cae a la línea de base, no a `undefined`', async () => {
    const transporte = new TransporteFalso({ telefono: '51987654321' });
    const registro = new RegistroFalso();
    const envio = new EnvioControlado(transporte, registro);

    await envio.enviarMedia({
      vendedoraId: 'ana',
      numeroPropio: '51987654321',
      telefono: '51961506674',
      referencia: 'conv:whatsapp:51961506674:51987654321',
      media: { ruta: '/tmp/x.jpg', clase: 'imagen', mime: 'image/jpeg', nombre: 'x.jpg', texto: null },
    });

    assert.deepEqual(registro.intentos[0].procedencia, A_MANO);
  });
});

/**
 * GUARDA #0 — QUE UN ENVÍO NO SALGA POR LA LÍNEA EQUIVOCADA (#50).
 *
 * Con un solo transporte esto no se podía ni escribir: había una sola línea. Con
 * varias vivas, el enrutado lo hace el gestor, y un error de enrutado **no se ve
 * desde adentro**: el mensaje sale bien y se audita bien. Lo que se rompe está
 * afuera — le llega al lead desde un número que no conoce, en otro chat, y la
 * respuesta cae en un hilo que nadie está mirando.
 *
 * Se rechaza SIN auditar, como la validación dura: no es un envío que falló, es
 * una orden mal enrutada. Anotarla ensuciaría `envios_wa` y, con él, la línea de
 * base del lazo de resultados.
 */
describe('EnvioControlado — la línea de la orden y la del transporte', () => {
  test('T20 — una orden para OTRO número no sale, y no ensucia la auditoría', async () => {
    const transporte = new TransporteFalso({ telefono: '51987654321' });
    const registro = new RegistroFalso();
    const envio = new EnvioControlado(transporte, registro);

    const r = await envio.enviar(orden({ numeroPropio: '51999888777' }));

    assert.equal(r.ok, false);
    assert.match((r as { motivo: string }).motivo, /línea equivocada/);
    assert.equal(transporte.enviados.length, 0, 'el transporte no se toca');
    assert.equal(registro.intentos.length, 0, 'una orden mal enrutada no es un intento de envío');
  });

  test('T21 — el adjunto pasa por la MISMA guarda: si no, la mitad de los envíos la esquiva', async () => {
    const transporte = new TransporteFalso({ telefono: '51987654321' });
    const registro = new RegistroFalso();
    const envio = new EnvioControlado(transporte, registro);

    const r = await envio.enviarMedia({
      vendedoraId: 'ana',
      numeroPropio: '51999888777',
      telefono: '51961506674',
      referencia: 'conv:whatsapp:51961506674:51999888777',
      media: { ruta: '/tmp/flyer.jpg', mime: 'image/jpeg', clase: 'imagen', nombre: 'flyer.jpg' },
    });

    assert.equal(r.ok, false);
    assert.match((r as { motivo: string }).motivo, /línea equivocada/);
    assert.equal(registro.intentos.length, 0);
  });

  test('T22 — el mismo número con formato distinto NO es otra línea', async () => {
    // Un guardarraíl que rechaza por un `+` estorba en vez de proteger: el número
    // propio llega de la app, de la base y del env, y no siempre normalizado.
    const transporte = new TransporteFalso({ telefono: '51987654321' });
    const registro = new RegistroFalso();
    const envio = new EnvioControlado(transporte, registro);

    const r = await envio.enviar(orden({ numeroPropio: '+51 987 654 321' }));

    assert.ok(r.ok, 'el mismo número escrito distinto tiene que salir');
    assert.equal(transporte.enviados.length, 1);
  });

  test('T23 — un transporte SIN número propio no inventa un veredicto', async () => {
    // El falso sin vincular no sabe cuál es su línea. Sin con qué comparar, la
    // guarda se calla: afirmar «es ajena» sin saberlo bloquearía envíos buenos.
    const transporte = new TransporteFalso();
    const registro = new RegistroFalso();
    const envio = new EnvioControlado(transporte, registro);

    const r = await envio.enviar(orden());

    // No pasa por la guarda #0; la frena la guarda de sesión, que es la correcta acá.
    assert.equal(r.ok, false);
    assert.doesNotMatch((r as { motivo: string }).motivo, /línea equivocada/);
    assert.equal(registro.intentos.length, 1, 'esto SÍ es un intento real: se audita');
  });
});
