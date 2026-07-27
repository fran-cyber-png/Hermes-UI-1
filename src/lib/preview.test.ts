import { describe, expect, test } from 'vitest';
import { SIN_TEXTO, textoDePreview } from './preview';

/**
 * Lo que se fija es el ORDEN de la cadena de respaldo, que es toda la decisión:
 * de lo más específico (lo que la persona escribió) a lo más genérico.
 */
describe('textoDePreview — qué llegó', () => {
  test('si hay palabras, mandan las palabras', () => {
    expect(textoDePreview({ texto: 'quiero el temario', clase: 'imagen' })).toBe('quiero el temario');
  });

  test('sin texto, dice qué clase de archivo llegó', () => {
    // «📷 Foto» le dice a la vendedora si vale la pena abrir; «(sin texto)» no.
    expect(textoDePreview({ texto: null, clase: 'imagen' })).toBe('📷 Foto');
    expect(textoDePreview({ texto: null, clase: 'audio' })).toBe('🎤 Audio');
  });

  test('sin texto ni media, dice de dónde vino si vino de un anuncio', () => {
    // Un primer contacto de Click-to-WhatsApp puede llegar sin nada; que vino de
    // un anuncio sigue siendo información útil para arrancar la conversación.
    expect(textoDePreview({ texto: null, clase: null, origen: { fuente: 'anuncio' } })).toBe('📣 Vino del anuncio');
  });

  test('un origen que no es anuncio no inventa nada', () => {
    expect(textoDePreview({ texto: null, clase: null, origen: { fuente: 'organico' } })).toBe(SIN_TEXTO);
  });

  test('sin nada, se rinde honestamente en vez de quedar en blanco', () => {
    // Una fila vacía se lee como un bug de la pantalla; «(sin texto)» se lee como
    // un mensaje sin texto, que es lo que es.
    expect(textoDePreview({})).toBe(SIN_TEXTO);
    expect(textoDePreview({ texto: null, clase: null, origen: null })).toBe(SIN_TEXTO);
  });

  test('un texto en blanco no cuenta como texto', () => {
    // WhatsApp manda cuerpos con solo espacios más seguido de lo que parece; sin
    // esto la fila quedaba visualmente vacía teniendo una foto que mostrar.
    expect(textoDePreview({ texto: '   \n ', clase: 'documento' })).toBe('📄 Documento');
  });

  test('una clase desconocida no rompe: cae al siguiente respaldo', () => {
    // `etiquetaDeMedia` devuelve null si no conoce la clase — nunca inventa un
    // ícono. Acá se comprueba que ese null sigue de largo en vez de cortar.
    expect(textoDePreview({ texto: null, clase: 'holograma', origen: { fuente: 'anuncio' } })).toBe(
      '📣 Vino del anuncio',
    );
  });
});
