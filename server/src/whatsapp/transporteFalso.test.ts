import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { TransporteFalso } from './transporteFalso.js';
import { FotoNoDisponibleError, type EstadoSesion, type MensajeWhatsapp } from './transporte.js';

/**
 * El falso es la base de todos los tests de WhatsApp de Hermes. Si el falso miente
 * distinto de como se comporta un transporte real, cada test que se apoye en él
 * miente también. Por eso el falso tiene su propio test: fija el contrato que
 * después el transporte whatsmeow (que escribe el equipo) tiene que cumplir.
 */

const RELOJ_FIJO = () => new Date('2026-07-21T15:00:00Z');

describe('TransporteFalso', () => {
  test('sin número, arranca sin vincular y al iniciar muestra un QR', async () => {
    const t = new TransporteFalso({ ahora: RELOJ_FIJO });
    assert.equal(t.estado().estado, 'sin-vincular');

    await t.iniciar();
    const e = t.estado();
    assert.equal(e.estado, 'sin-vincular');
    assert.ok(e.estado === 'sin-vincular' && e.qr, 'debería exponer un QR para pintar');
  });

  test('con número, arranca conectado', () => {
    const t = new TransporteFalso({ telefono: '51987654321' });
    assert.deepEqual(t.estado(), { estado: 'conectado', telefono: '51987654321' });
  });

  test('un entrante llega al suscriptor con esMio=false', () => {
    const t = new TransporteFalso({ telefono: '51987654321', ahora: RELOJ_FIJO });
    const recibidos: MensajeWhatsapp[] = [];
    t.onMensaje((m) => recibidos.push(m));

    t.simularEntrante('51961506674', 'hola, info del diplomado?', 'Andre');

    assert.equal(recibidos.length, 1);
    assert.equal(recibidos[0].esMio, false);
    assert.equal(recibidos[0].telefono, '51961506674');
    // El número propio de la sesión queda estampado: es lo que separa el hilo de
    // este número del de otro número hablándole a la misma persona.
    assert.equal(recibidos[0].numeroPropio, '51987654321');
    assert.equal(recibidos[0].texto, 'hola, info del diplomado?');
    assert.equal(recibidos[0].nombreVisible, 'Andre');
  });

  test('enviar registra el envío y lo emite como esMio=true', async () => {
    const t = new TransporteFalso({ telefono: '51987654321', ahora: RELOJ_FIJO });
    const recibidos: MensajeWhatsapp[] = [];
    t.onMensaje((m) => recibidos.push(m));

    const r = await t.enviarTexto('51961506674', 'con gusto, te paso el temario');

    // El envío queda registrado (las guardas de "quién envió qué" leen esto).
    assert.equal(t.enviados.length, 1);
    assert.equal(t.enviados[0].telefono, '51961506674');
    assert.equal(t.enviados[0].texto, 'con gusto, te paso el temario');
    assert.equal(r.idExterno, t.enviados[0].idExterno);

    // Y aparece en el hilo como mensaje mío.
    assert.equal(recibidos.length, 1);
    assert.equal(recibidos[0].esMio, true);
  });

  test('los idExterno son únicos entre entrantes y salientes (clave de idempotencia)', async () => {
    const t = new TransporteFalso({ telefono: '51987654321', ahora: RELOJ_FIJO });
    const ids = new Set<string>();
    t.onMensaje((m) => ids.add(m.idExterno));

    t.simularEntrante('51961506674', 'uno');
    await t.enviarTexto('51961506674', 'dos');
    t.simularEntrante('51961506674', 'tres');

    assert.equal(ids.size, 3, 'tres mensajes distintos, tres ids distintos');
  });

  test('no se puede enviar si la sesión no está conectada', async () => {
    const t = new TransporteFalso({ ahora: RELOJ_FIJO }); // sin número => sin-vincular
    await assert.rejects(
      () => t.enviarTexto('51961506674', 'esto no debería salir'),
      /no se puede enviar/i,
    );
    assert.equal(t.enviados.length, 0);
  });

  test('el ban temporal se propaga a los suscriptores de estado', () => {
    const t = new TransporteFalso({ telefono: '51987654321' });
    const estados: EstadoSesion[] = [];
    t.onEstado((e) => estados.push(e));

    t.simularBan('191', 'en 24 horas');

    const ultimo = estados.at(-1);
    assert.ok(ultimo && ultimo.estado === 'baneado');
    assert.equal(ultimo.estado === 'baneado' && ultimo.codigo, '191');
    // Y el estado consultable también lo refleja: nadie que pregunte "¿cómo está?"
    // puede recibir "conectado" cuando en verdad está baneado.
    assert.equal(t.estado().estado, 'baneado');
  });

  test('tras un ban, enviar falla — no se escribe contra un número muerto', async () => {
    const t = new TransporteFalso({ telefono: '51987654321' });
    t.simularBan();
    await assert.rejects(() => t.enviarTexto('51961506674', 'hola'), /no se puede enviar/i);
  });

  /**
   * Regresión del hallazgo de la revisión del PR #75: un restart del server deja
   * la sesión en `'conectando'` (o cualquier estado que no sea `'conectado'`)
   * mientras whatsmeow reconecta, y el server ya acepta HTTP en ese hueco. Si
   * `fotoDePerfil` devolviera `null` ahí (en vez de señalizar "no pude
   * preguntar"), la ruta lo cachearía 7 días como "no tiene foto" — sobre
   * cualquier contacto que la cola pida en ese momento. `FotoNoDisponibleError`
   * es la señal distinguible que evita eso.
   */
  test('fotoDePerfil: sin sesión conectada, señala "no disponible" — nunca null', async () => {
    const t = new TransporteFalso(); // sin número => arranca 'sin-vincular', no 'conectado'
    await assert.rejects(() => t.fotoDePerfil('51961506674'), FotoNoDisponibleError);
  });

  test('fotoDePerfil: estado "conectando" también señala "no disponible"', async () => {
    const t = new TransporteFalso({ telefono: '51987654321' });
    t.simularEstado({ estado: 'conectando' });
    await assert.rejects(() => t.fotoDePerfil('51961506674'), FotoNoDisponibleError);
  });

  test('fotoDePerfil: con sesión conectada, el falso resuelve null (sin foto) sin lanzar', async () => {
    const t = new TransporteFalso({ telefono: '51987654321' });
    const foto = await t.fotoDePerfil('51961506674');
    assert.equal(foto, null);
  });
});
