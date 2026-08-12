import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { proyectarMensaje } from './proyectar.js';
import type { MensajeWhatsapp } from './transporte.js';

/**
 * El proyector es la traducción de "lo que dijo WhatsApp" a "lo que Hermes guarda".
 * Es puro a propósito: sin DB, sin red, sin reloj propio. Un mensaje entra, un par
 * {evento, interacción} sale — o un descarte con motivo. Testearlo es barato y
 * atrapa las decisiones que después son caras de deshacer en la base.
 */

function mensaje(over: Partial<MensajeWhatsapp> = {}): MensajeWhatsapp {
  return {
    idExterno: 'ABC123',
    numeroPropio: '51987654321',
    telefono: '51961506674',
    esMio: false,
    esGrupo: false,
    ocurridoEn: new Date('2026-07-21T15:00:00Z'),
    nombreVisible: 'Andre',
    texto: 'hola, info del diplomado?',
    clase: 'texto',
    ...over,
  };
}

describe('proyectarMensaje', () => {
  test('T1 — un entrante produce la interacción canónica de whatsapp', () => {
    const r = proyectarMensaje(mensaje());
    assert.ok('interaccion' in r, 'debería proyectar, no descartar');

    assert.equal(r.interaccion.canal, 'whatsapp');
    assert.equal(r.interaccion.tipo, 'mensaje');
    assert.equal(r.interaccion.direccion, 'entrante');
    assert.equal(r.interaccion.autor, 'persona');
    assert.equal(r.interaccion.personaId, '51961506674');
    assert.equal(r.interaccion.personaNombre, 'Andre');
    assert.equal(r.interaccion.texto, 'hola, info del diplomado?');
    assert.deepEqual(r.interaccion.occurredAt, new Date('2026-07-21T15:00:00Z'));

    // El evento crudo espeja lo mismo, con la clave de idempotencia prefijada.
    assert.equal(r.evento.source, 'whatsapp');
    assert.equal(r.evento.externalId, 'wa:ABC123');
    assert.equal(r.interaccion.externalId, 'wa:ABC123');
  });

  test('T2 — un saliente (esMio) es dirección saliente y autor pagina', () => {
    const r = proyectarMensaje(mensaje({ esMio: true }));
    assert.ok('interaccion' in r);
    assert.equal(r.interaccion.direccion, 'saliente');
    // El bug histórico de descartar los salientes no se repite: se guardan las
    // dos mitades de la conversación.
    assert.equal(r.interaccion.autor, 'pagina');
  });

  test('T3 — un mensaje de grupo se descarta con motivo, no produce fila', () => {
    const r = proyectarMensaje(mensaje({ esGrupo: true }));
    assert.ok('descarte' in r, 'un grupo no es un contacto que registrar');
    assert.match(r.descarte, /grupo/i);
  });

  test('T4 — multimedia: texto null, pero la clase cruda no se pierde', () => {
    const r = proyectarMensaje(mensaje({ clase: 'multimedia', texto: null }));
    assert.ok('interaccion' in r);
    assert.equal(r.interaccion.texto, null);
    // La información de que era multimedia queda en el payload del evento: el día
    // que Hermes sepa mostrar audios, se reproyecta desde acá sin perder nada.
    assert.equal(r.evento.payload.clase, 'multimedia');
    assert.equal(r.evento.payload.numeroPropio, '51987654321');
  });

  test('T5 — idempotencia determinista: el mismo mensaje da la misma clave', () => {
    const m = mensaje();
    const a = proyectarMensaje(m);
    const b = proyectarMensaje(m);
    assert.ok('evento' in a && 'evento' in b);
    assert.equal(a.evento.externalId, b.evento.externalId);
    assert.equal(a.evento.source, b.evento.source);
  });

  test('sin teléfono derivable, se descarta — nunca se inventa un contacto', () => {
    const r = proyectarMensaje(mensaje({ telefono: '' }));
    assert.ok('descarte' in r);
  });

  test('un mensaje al propio número se descarta (ruido de protocolo)', () => {
    const r = proyectarMensaje(mensaje({ telefono: '51987654321', numeroPropio: '51987654321' }));
    assert.ok('descarte' in r);
    assert.match(r.descarte, /propio|protocolo/i);
  });
});

test('T-M4 — un adjunto viaja al payload del evento y el caption es el texto de la interacción', () => {
  const r = proyectarMensaje({
    idExterno: 'IMG1',
    numeroPropio: '51987654321',
    telefono: '51961506674',
    esMio: false,
    esGrupo: false,
    ocurridoEn: new Date('2026-07-21T12:00:00Z'),
    nombreVisible: 'Jhoselyn',
    texto: 'les llegó este flyer?',
    clase: 'multimedia',
    media: { clase: 'imagen', archivo: 'wa-IMG1.jpg', mime: 'image/jpeg', nombre: null },
  });

  assert.ok('evento' in r);
  if ('evento' in r) {
    const media = r.evento.payload.media as { clase: string; archivo: string };
    assert.equal(media.clase, 'imagen');
    assert.equal(media.archivo, 'wa-IMG1.jpg');
    // El caption se muestra como texto del mensaje, igual que en WhatsApp.
    assert.equal(r.interaccion.texto, 'les llegó este flyer?');
  }
});

describe('la cita en el crudo — sin migración', () => {
  test('a qué mensaje responde queda en el payload, al lado de media y origen', () => {
    // Va al CRUDO y no a una columna porque es un atributo del mensaje: no cambia
    // nunca y no existe sin él. El hilo lo sirve con el JOIN que ya tiene.
    const r = proyectarMensaje(mensaje({ cita: { mensajeExternalId: 'wa:EL_PRECIO' } }));
    assert.ok('evento' in r);
    if ('evento' in r) assert.deepEqual(r.evento.payload.cita, { mensajeExternalId: 'wa:EL_PRECIO' });
  });

  test('un mensaje sin cita la deja en `null`, no ausente', () => {
    // Explícito y no ausente, igual que `media` y `origen`: una clave que a veces
    // está y a veces no obliga a cada consumidor del crudo a distinguir «no citó»
    // de «esta fila es de antes», y esa diferencia no le sirve a nadie acá.
    const r = proyectarMensaje(mensaje());
    assert.ok('evento' in r);
    if ('evento' in r) assert.equal(r.evento.payload.cita, null);
  });
});

/**
 * ── ATRIBUCIÓN DE LÍNEA (#185) ────────────────────────────────────────────────
 *
 * Con UNA sola línea con tráfico, "todo lo saliente es de esa vendedora" se
 * deducía por eliminación. Con dos líneas vivas esa deducción se rompe, y sin
 * `numeroPropio` proyectado las dos personas quedan en un solo pozo.
 *
 * El dato ya viajaba en el crudo del evento; lo que estos tests fijan es que
 * TAMBIÉN llegue a la interacción, y que las dos copias no puedan discrepar.
 */
describe('atribución de línea (#185)', () => {
  test('un entrante lleva la línea por la que entró', () => {
    const r = proyectarMensaje(mensaje({ numeroPropio: '51986394450' }));
    assert.ok('interaccion' in r);
    if ('interaccion' in r) assert.equal(r.interaccion.numeroPropio, '51986394450');
  });

  test('un saliente lleva la línea por la que salió — es la mitad que faltaba', () => {
    // Los salientes son el caso que importa: son los que escribe la vendedora, y
    // los que hasta ahora quedaban con `autor='pagina'` y nada que dijera cuál.
    const r = proyectarMensaje(mensaje({ esMio: true, numeroPropio: '51941654039' }));
    assert.ok('interaccion' in r);
    if ('interaccion' in r) {
      assert.equal(r.interaccion.direccion, 'saliente');
      assert.equal(r.interaccion.numeroPropio, '51941654039');
    }
  });

  test('dos líneas hablándole a la MISMA persona quedan distinguibles', () => {
    // El caso que motiva todo: sin esta columna, estas dos interacciones eran
    // indistinguibles salvo por el id, y ninguna consulta podía separarlas.
    const a = proyectarMensaje(mensaje({ idExterno: 'A1', esMio: true, numeroPropio: '51986394450' }));
    const b = proyectarMensaje(mensaje({ idExterno: 'B1', esMio: true, numeroPropio: '51941654039' }));
    assert.ok('interaccion' in a && 'interaccion' in b);
    if ('interaccion' in a && 'interaccion' in b) {
      assert.equal(a.interaccion.personaId, b.interaccion.personaId, 'la misma persona');
      assert.notEqual(
        a.interaccion.numeroPropio,
        b.interaccion.numeroPropio,
        'pero por líneas distintas: eso es lo que la columna tiene que preservar',
      );
    }
  });

  test('la línea proyectada y la del crudo son la MISMA — no pueden divergir', () => {
    // El backfill de las filas viejas deriva `numero_propio` de
    // `events.payload->>'numeroPropio'`. Si la proyección tomara el número de otro
    // lado, las filas viejas y las nuevas significarían cosas distintas bajo el
    // mismo nombre de columna, y la comparación contra la línea de base mentiría.
    const r = proyectarMensaje(mensaje({ numeroPropio: '51986394450' }));
    assert.ok('evento' in r && 'interaccion' in r);
    if ('evento' in r && 'interaccion' in r) {
      assert.equal(r.interaccion.numeroPropio, r.evento.payload.numeroPropio);
    }
  });
});
