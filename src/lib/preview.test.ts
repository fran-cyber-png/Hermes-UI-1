import { describe, expect, test } from 'vitest';
import { DEL_ANUNCIO, SIN_TEXTO, textoDePreview } from './preview';

/** El texto exacto que WhatsApp prellena al tocar el botón de un anuncio. */
const TEXTO_DEL_ANUNCIO = 'Hola Quiero más información del Diploma de Inteligencia y Contrainteligencia';

/**
 * 🔴 EL PASO 0 — «lo escribió el anuncio» le gana a «hay palabras».
 *
 * Medido en producción el 11-ago-2026: **563 de 3.995 conversaciones** (14 % de
 * la mesa) tienen ese texto como último entrante, 424 palabra por palabra. La
 * fila lo mostraba como preview y la vendedora leía una pregunta donde hubo un
 * clic — y contestaba, en vez de ABRIR la conversación.
 */
describe('textoDePreview — el texto que escribió el anuncio', () => {
  test('con `soloClic`, el texto de Meta NO se muestra como algo que la persona dijo', () => {
    expect(textoDePreview({ texto: TEXTO_DEL_ANUNCIO, soloClic: true })).toBe(DEL_ANUNCIO);
  });

  test('le gana a las palabras Y a la media: es el primer peldaño de la cadena', () => {
    expect(textoDePreview({ texto: TEXTO_DEL_ANUNCIO, clase: 'imagen', soloClic: true })).toBe(DEL_ANUNCIO);
  });

  test('🔴 AUSENTE se comporta como antes del frente: muestra el texto', () => {
    // Un server viejo no manda el campo, y una respuesta rehidratada del caché de
    // IndexedDB (ADR 0007) tampoco. Degrada hacia lo viejo, nunca hacia una fila
    // muda — que sería una regresión invisible atada al deploy.
    expect(textoDePreview({ texto: TEXTO_DEL_ANUNCIO })).toBe(TEXTO_DEL_ANUNCIO);
    expect(textoDePreview({ texto: TEXTO_DEL_ANUNCIO, soloClic: false })).toBe(TEXTO_DEL_ANUNCIO);
  });

  test('reusa la frase que la cadena YA tenía, no una nueva', () => {
    // Sin texto ni media y con origen de anuncio, el peldaño 3 dice lo mismo. Dos
    // redacciones para el mismo hecho es cómo nacen las pantallas que se
    // contradicen (#37) — y acá conviven en la MISMA lista.
    expect(textoDePreview({ texto: null, origen: { fuente: 'anuncio' } })).toBe(DEL_ANUNCIO);
  });
});

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
