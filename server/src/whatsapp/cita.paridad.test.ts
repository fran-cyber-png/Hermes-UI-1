import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { citaDeCloudApi, citaDeWhatsmeow } from './cita.js';
import { externalIdDeWa } from '../reacciones/dominio.js';

/**
 * LOS DOS CANALES, UNA SOLA FORMA — el candado que impide que diverjan.
 *
 * Es el mismo patrón que `entrega/paridad.test.ts` y `meta/caminos.paridad.test.ts`:
 * dos dialectos escriben la MISMA fila, y si uno cambia de receta el JOIN deja de
 * cerrar **sin error y sin log** — que se lee como «nadie citó nunca a nadie».
 *
 * Lo que se fija es la RELACIÓN, no una de las dos funciones: para el mismo
 * mensaje citado, los dos canales tienen que producir el mismo `CitaEntrante`, y
 * ese id tiene que salir de la MISMA receta que usan los mensajes y las
 * reacciones (`externalIdDeWa`).
 */

/** Ids con las formas reales de cada canal: whatsmeow da hex, Meta da base64 con `=`. */
const IDS = ['3EB0C4A1F2D9', 'wamid.HBgLNTE5ODc2NTQzMjEVAgASGBQzQTAwMDAwMDAwMDAwMDAwMDAwMA=='];

describe('paridad whatsmeow ↔ cloud api', () => {
  test('🔴 el mismo mensaje citado da el mismo `mensajeExternalId` por los dos caminos', () => {
    for (const id of IDS) {
      const porWhatsmeow = citaDeWhatsmeow({ extendedTextMessage: { text: 'sí', contextInfo: { stanzaID: id } } });
      const porCloudApi = citaDeCloudApi({ context: { id } });
      assert.deepEqual(porWhatsmeow, porCloudApi, `divergen para ${id}`);
      assert.ok(porWhatsmeow, 'ninguno de los dos puede devolver null acá');
    }
  });

  test('🔴 la receta del id es la MISMA que la de los mensajes y las reacciones', () => {
    // Si alguien escribe `'wa:' + id` a mano en un lado y mañana cambia el
    // prefijo en `reacciones/dominio.ts`, esto se pone rojo antes de que el JOIN
    // devuelva cero filas en producción.
    for (const id of IDS) {
      assert.equal(citaDeCloudApi({ context: { id } })?.mensajeExternalId, externalIdDeWa(id));
      assert.equal(
        citaDeWhatsmeow({ extendedTextMessage: { text: 'x', contextInfo: { stanzaID: id } } })?.mensajeExternalId,
        externalIdDeWa(id),
      );
    }
  });

  test('los dos coinciden también en el NEGATIVO: sin id, no hay cita', () => {
    // Que uno de los dos «rescate» algo que el otro descarta es la otra mitad de
    // la divergencia, y la más difícil de ver: la misma conversación tendría
    // tirita en una línea y no en otra.
    assert.equal(citaDeWhatsmeow({ extendedTextMessage: { text: 'hola', contextInfo: {} } }), null);
    assert.equal(citaDeCloudApi({ context: {} as { id?: string } }), null);
  });

  test('espacios de más no hacen dos ids distintos', () => {
    const conEspacios = citaDeWhatsmeow({ extendedTextMessage: { text: 'x', contextInfo: { stanzaID: `  ${IDS[0]} ` } } });
    assert.deepEqual(conEspacios, citaDeCloudApi({ context: { id: IDS[0] } }));
  });
});

/**
 * ── EL CANDADO DE LA GRAFÍA ──
 *
 * `stanzaID` (D mayúscula) es lo que el binario Go serializa; `stanzaId` es lo
 * que dicen el `.d.ts` y el ejemplo del paquete. Un refactor bienintencionado
 * que «corrija» la grafía siguiendo los tipos rompe el frente entero **sin un
 * solo error**: el mensaje sale y la cita no. Por eso está acá y no solo en un
 * comentario.
 */
describe('la grafía verificada contra el binario', () => {
  const fuente = readFileSync(new URL('./cita.ts', import.meta.url), 'utf8');

  test('🔴 el proto de salida escribe `stanzaID`', () => {
    assert.match(fuente, /stanzaID: cita\.mensajeId/);
  });

  test('la lectura acepta las dos grafías, en ese orden', () => {
    assert.match(fuente, /c\.stanzaID\s*\)\s*\?\?\s*texto\(c\.stanzaId/);
  });

  test('el porqué queda escrito: el próximo va a leer el `.d.ts` y creerle', () => {
    assert.match(fuente, /stanzaID,omitempty/, 'falta la evidencia medida sobre el binario');
  });
});
