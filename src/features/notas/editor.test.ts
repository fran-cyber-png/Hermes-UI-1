import { describe, expect, it } from 'vitest';
import { BLOQUES_RETIRADOS, DICCIONARIO_LIBRETA, ESQUEMA_LIBRETA, soloBloquesConocidos } from './editor';

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

  it('🔴 el dibujo NO es un bloque: la capa de anotaciones vive fuera del `doc`', () => {
    // Un bloque de dibujo sería el mismo agujero que image/video/audio/file con
    // otro nombre. Las anotaciones van en `notas.anotaciones`, en una capa
    // transparente sobre el documento — ver `dibujo/figuras.ts`.
    expect(Object.keys(ESQUEMA_LIBRETA.blockSchema)).not.toContain('dibujo');
  });
});

/**
 * EL FILTRO DE SANEADO. Existe para que un bloque desconocido no tumbe la app
 * entera al abrir una página — pero cuando la lista de conocidos se queda vieja,
 * el que protege es el que destruye.
 */
describe('soloBloquesConocidos', () => {
  it('conserva los bloques que el esquema sí tiene', () => {
    const bloques = [
      { type: 'paragraph', content: [] },
      { type: 'heading', props: { level: 2 }, content: [] },
      { type: 'table', content: { type: 'tableContent', rows: [] } },
    ];
    expect(soloBloquesConocidos(bloques)).toEqual(bloques);
  });

  it('saca lo que el esquema no conoce', () => {
    const imagen = { type: 'image', props: { url: 'https://…' }, children: [] };
    const parrafo = { type: 'paragraph', content: [] };
    expect(soloBloquesConocidos([parrafo, imagen])).toEqual([parrafo]);
  });

  it('⚠️ la lista de conocidos sale del ESQUEMA, no de una copia a mano', () => {
    // Con una lista escrita aparte, agregar un bloque y olvidarse de esta línea
    // hace que el filtro que protege sea el que destruye: el bloque se guarda,
    // desaparece al reabrir, y el autoguardado graba la versión sin él.
    for (const tipo of Object.keys(ESQUEMA_LIBRETA.blockSchema)) {
      expect(soloBloquesConocidos([{ type: tipo }]), `«${tipo}» se estaría descartando`).toHaveLength(1);
    }
  });

  it('un bloque sin `type` pasa: BlockNote asume `paragraph`, que sí existe', () => {
    const suelto = { content: [] };
    expect(soloBloquesConocidos([suelto])).toEqual([suelto]);
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
