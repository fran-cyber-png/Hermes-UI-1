import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { ordenarPorUrgencia, claveUrgencia, ACTIVO_MS, type ItemUrgencia } from './urgencia.js';

/**
 * La urgencia decide qué ve primero la vendedora. Equivocarse acá no es cosmético:
 * entierra al lead que está comprando AHORA debajo del que puede esperar. Estos
 * tests fijan los seis niveles y su orden interno.
 */

const AHORA = new Date('2026-07-21T18:00:00Z');
const hDe = (n: number) => new Date(AHORA.getTime() - n * 60 * 60 * 1000);
const dDe = (n: number) => new Date(AHORA.getTime() - n * 24 * 60 * 60 * 1000);

const msg = (over: Partial<ItemUrgencia>): ItemUrgencia => ({
  tipo: 'mensaje', ventanaAbierta: false, respondida: false, referencia: hDe(2), ...over,
});
const com = (over: Partial<ItemUrgencia>): ItemUrgencia => ({
  tipo: 'comentario', ventanaAbierta: true, respondida: false, referencia: hDe(2), ...over,
});

describe('urgencia de la cola', () => {
  test('un chat VIVO (mensaje sin responder, reciente) va arriba de un comentario que expira', () => {
    // Alguien está escribiendo por WhatsApp hace 2h. Un comentario de Meta con la
    // ventana abierta hace 5 días. Goberna vende por WhatsApp: el vivo primero.
    const vivo = msg({ referencia: hDe(2) });
    const expira = com({ referencia: dDe(5) });

    assert.equal(claveUrgencia(vivo, AHORA).nivel, 0);
    assert.equal(claveUrgencia(expira, AHORA).nivel, 2);
    assert.deepEqual(ordenarPorUrgencia([expira, vivo], AHORA), [vivo, expira]);
  });

  test('T7 — comentarios que expiran: el más VIEJO va primero', () => {
    const viejo = com({ referencia: dDe(6) });
    const nuevo = com({ referencia: hDe(1) });
    assert.deepEqual(ordenarPorUrgencia([nuevo, viejo], AHORA), [viejo, nuevo]);
  });

  test('T8 — los SEIS niveles en orden: vivo, vencido, expira, espera, silencio, resto', () => {
    const vivo = msg({ referencia: hDe(3) }); //                              nivel 0
    const vencido = msg({ referencia: dDe(6), seguimientoEn: hDe(4) }); //     nivel 1
    const expira = com({ referencia: hDe(10) }); //                           nivel 2
    const espera = msg({ referencia: dDe(3) }); //                            nivel 3
    const silencio = msg({ referencia: hDe(1), respondida: true }); //        nivel 4
    const archivo = com({ referencia: hDe(2), ventanaAbierta: false }); //    nivel 5

    assert.deepEqual(
      ordenarPorUrgencia([archivo, silencio, espera, expira, vencido, vivo], AHORA),
      [vivo, vencido, expira, espera, silencio, archivo],
    );
  });

  test('un mensaje sin responder de más de 24h deja de ser "vivo" y cae a ESPERA', () => {
    const recien = msg({ referencia: hDe(2) });
    const viejo = msg({ referencia: hDe(30) });
    assert.equal(claveUrgencia(recien, AHORA).nivel, 0);
    assert.equal(claveUrgencia(viejo, AHORA).nivel, 3);
  });

  test('dentro de VIVO, el lead más RECIENTE va primero (velocidad de respuesta)', () => {
    // Un lead que escribió hace 5 min tiene que estar arriba de uno de hace 20h.
    const recienLlegado = msg({ referencia: hDe(0.1) });
    const esperando = msg({ referencia: hDe(20) });
    assert.deepEqual(ordenarPorUrgencia([esperando, recienLlegado], AHORA), [recienLlegado, esperando]);
  });

  test('un comentario respondido cae al resto aunque tenga ventana abierta', () => {
    const pendiente = com({ referencia: hDe(5) });
    const respondido = com({ referencia: hDe(1), respondida: true });
    assert.deepEqual(ordenarPorUrgencia([respondido, pendiente], AHORA), [pendiente, respondido]);
  });

  test('dentro del resto, lo más reciente va primero', () => {
    // El resto son ventanas cerradas y comentarios respondidos. Un mensaje
    // respondido NO entra acá: eso es Silencio (nivel 4), y tiene su propio test.
    const viejo = com({ referencia: dDe(9), ventanaAbierta: false });
    const reciente = com({ referencia: hDe(1), respondida: true });
    assert.deepEqual(ordenarPorUrgencia([viejo, reciente], AHORA), [reciente, viejo]);
  });

  test('el borde de las 24h entre VIVO y ESPERA, por los dos lados', () => {
    const justoAdentro = new Date(AHORA.getTime() - (ACTIVO_MS - 1));
    const justoAfuera = new Date(AHORA.getTime() - ACTIVO_MS);
    assert.equal(claveUrgencia(msg({ referencia: justoAdentro }), AHORA).nivel, 0);
    assert.equal(claveUrgencia(msg({ referencia: justoAfuera }), AHORA).nivel, 3);
  });

  test('un mensaje NUNCA cae en el nivel de la ventana, tenga la edad que tenga', () => {
    // En WhatsApp no hay ventana: el número está vinculado como dispositivo de un
    // teléfono real, no como cuenta de negocio. Si alguna vez llega un mensaje con
    // ventanaAbierta en true, es un error de quien arma el item — y no debe
    // colarse al nivel de los comentarios que expiran.
    for (const edad of [hDe(1), hDe(23), dDe(2), dDe(30)]) {
      assert.notEqual(claveUrgencia(msg({ referencia: edad, ventanaAbierta: true }), AHORA).nivel, 2);
    }
  });
});

describe('SILENCIO — le contestamos y la persona no volvió', () => {
  test('una conversación respondida sale de Deuda y cae en SILENCIO, arriba del archivo', () => {
    const espera = msg({ referencia: dDe(3) }); //                        Deuda
    const silencio = msg({ referencia: dDe(2), respondida: true }); //     Silencio
    const archivo = com({ referencia: dDe(9), ventanaAbierta: false }); // Resto

    assert.equal(claveUrgencia(silencio, AHORA).nivel, 4);
    assert.deepEqual(ordenarPorUrgencia([archivo, silencio, espera], AHORA), [espera, silencio, archivo]);
  });

  test('entre silencios, el más RECIENTE va primero: a los dos días se rescata, a los catorce es archivo', () => {
    const rescatable = msg({ referencia: dDe(2), respondida: true });
    const casiMuerto = msg({ referencia: dDe(14), respondida: true });
    assert.deepEqual(ordenarPorUrgencia([casiMuerto, rescatable], AHORA), [rescatable, casiMuerto]);
  });

  test('un comentario respondido NO es silencio: el silencio es de conversaciones', () => {
    // CONTEXT.md: un Comentario sigue siendo individual, no es una Conversación.
    // Responder un comentario no abre una espera; lo archiva.
    assert.equal(claveUrgencia(com({ referencia: hDe(1), respondida: true }), AHORA).nivel, 5);
  });
});

describe('VENCIDO — el seguimiento que la vendedora se prometió', () => {
  test('un vencido va debajo de lo VIVO y arriba de todo lo demás', () => {
    // La decisión: quien está escribiendo AHORA se contesta al toque (velocidad =
    // venta) y una promesa de ayer aguanta cinco minutos más. Al revés de lo que
    // dice la intuición — NO es un descuido, no lo "arregles".
    const vivo = msg({ referencia: hDe(2) });
    const vencido = msg({ referencia: dDe(4), seguimientoEn: dDe(1) });
    const expira = com({ referencia: dDe(5) });

    assert.equal(claveUrgencia(vencido, AHORA).nivel, 1);
    assert.deepEqual(ordenarPorUrgencia([expira, vencido, vivo], AHORA), [vivo, vencido, expira]);
  });

  test('entre vencidos ordena por la fecha del COMPROMISO, no por la del mensaje', () => {
    // Cruzados a propósito: el de la conversación más nueva tiene el compromiso
    // más viejo. Si el módulo ordenara por `referencia` en vez de por el
    // seguimiento, este test daría al revés — que es justo lo que tiene que
    // detectar.
    const compromisoViejo = msg({ referencia: dDe(2), seguimientoEn: dDe(5) });
    const compromisoNuevo = msg({ referencia: dDe(9), seguimientoEn: hDe(1) });
    assert.deepEqual(
      ordenarPorUrgencia([compromisoNuevo, compromisoViejo], AHORA),
      [compromisoViejo, compromisoNuevo],
    );
  });

  test('un seguimiento que todavía no llegó NO está vencido', () => {
    // Agendar para mañana no es una deuda de hoy. El MISMO item con la fecha ya
    // pasada sí lo es: si este par deja de discriminar, el test no protege nada.
    const futuro = new Date(AHORA.getTime() + 24 * 60 * 60 * 1000);
    assert.equal(claveUrgencia(msg({ referencia: dDe(3), seguimientoEn: futuro }), AHORA).nivel, 3);
    assert.equal(claveUrgencia(msg({ referencia: dDe(3), seguimientoEn: hDe(1) }), AHORA).nivel, 1);
  });
});
