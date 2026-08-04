import { describe, expect, it } from 'vitest';
import { BLOQUES_RETIRADOS, DICCIONARIO_LIBRETA, ESQUEMA_LIBRETA } from './editor';

/**
 * LO QUE EL EDITOR OFRECE Y EN QUÉ IDIOMA.
 *
 * `useCreateBlockNote` recibía solo `initialContent`, así que mandaba el default
 * de BlockNote: todo en inglés, y con bloques de archivo que no se pueden
 * guardar. Los dos son visibles el primer día que alguien escribe.
 */

describe('los bloques que el editor ofrece', () => {
  it('🔴 no ofrece image/video/audio/file: una página que sea solo eso NO SE GUARDA', () => {
    // Tienen contenido "none" (su URL vive en `props`) y `aTextoPlano` no lee
    // props, así que la página aplana a "" y el server la rechaza por vacía.
    for (const bloque of BLOQUES_RETIRADOS) {
      expect(Object.keys(ESQUEMA_LIBRETA.blockSchema), `«${bloque}» sigue ofreciéndose`).not.toContain(
        bloque,
      );
    }
  });

  it('sí ofrece lo que sí se guarda', () => {
    const bloques = Object.keys(ESQUEMA_LIBRETA.blockSchema);
    for (const esperado of ['paragraph', 'heading', 'bulletListItem', 'numberedListItem', 'checkListItem', 'table']) {
      expect(bloques, `falta «${esperado}»`).toContain(esperado);
    }
  });

  it('la tabla se queda: `aTextoPlano` sabe aplanar filas y celdas', () => {
    expect(Object.keys(ESQUEMA_LIBRETA.blockSchema)).toContain('table');
  });
});

/**
 * EL IDIOMA. La locale `es` del paquete es correcta pero **peninsular**
 * («Escribe», «teclea», «Pulsa»), y Hermes escribe en voseo en toda la app.
 * Dejar el default metía inglés; dejar la locale cruda mete una segunda voz.
 */
describe('el diccionario', () => {
  /** Lo que se ve seguido: si algo de esto queda en inglés, se nota enseguida. */
  const VISIBLES = [
    DICCIONARIO_LIBRETA.placeholders.default,
    DICCIONARIO_LIBRETA.placeholders.heading,
    DICCIONARIO_LIBRETA.slash_menu.heading.title,
    DICCIONARIO_LIBRETA.slash_menu.bullet_list.title,
    DICCIONARIO_LIBRETA.slash_menu.table.title,
  ].map(String);

  it('🔴 nada visible quedó en inglés', () => {
    const EN_INGLES = /\b(Type|Enter|Heading|Bullet|Numbered|Check|List|Table|Paragraph|commands?)\b/i;
    for (const frase of VISIBLES) {
      expect(frase, `«${frase}» parece inglés`).not.toMatch(EN_INGLES);
    }
  });

  it('el placeholder principal está en voseo, no en peninsular', () => {
    const p = DICCIONARIO_LIBRETA.placeholders.default;
    expect(p).not.toMatch(/\b(Escribe|teclea|Pulsa|Haz)\b/);
    expect(p).toMatch(/Escribí/);
  });

  it('no se perdió nada de la locale: lo que no se pisó sigue estando', () => {
    // El spread tiene que conservar las claves que no tocamos, o el editor
    // quedaría con menús a medio traducir.
    expect(DICCIONARIO_LIBRETA.slash_menu.code_block?.title).toBeTruthy();
    expect(DICCIONARIO_LIBRETA.formatting_toolbar?.bold?.tooltip).toBeTruthy();
  });
});
