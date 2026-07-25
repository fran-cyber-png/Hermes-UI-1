import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { campanaDe, limpiarTitulo, reconocerFamilia } from './campana.js';

/**
 * DE QUÉ CAMPAÑA VINO — el dato con el que la auto-respuesta deja de contestar
 * lo mismo a todo el mundo (#125 · ADR 0016).
 *
 * «Si vino de "[JUL] INTELIGENCIA", responde lo de Inteligencia» (dueño,
 * 2026-07-25). Acá vive el reconocimiento, puro: limpiar el prefijo de mes que
 * le pone el equipo de pauta, elegir entre las tres fuentes con la MISMA
 * precedencia del chip de la cola (#72) y reconocer la familia sin inventar.
 */

describe('el título, limpio', () => {
  test('el prefijo de mes de pauta no es parte del curso', () => {
    assert.equal(limpiarTitulo('[JUL] INTELIGENCIA'), 'INTELIGENCIA');
    assert.equal(limpiarTitulo('[ABR] OSINT Y SOCMINT'), 'OSINT Y SOCMINT');
    assert.equal(limpiarTitulo('  [SET 2026]   BICAMERAL  '), 'BICAMERAL');
  });

  test('lo que no tiene prefijo se deja tal cual', () => {
    assert.equal(limpiarTitulo('Diploma de Inteligencia'), 'Diploma de Inteligencia');
  });

  test('un título que es SOLO el prefijo no se convierte en vacío', () => {
    assert.equal(limpiarTitulo('[JUL]'), '[JUL]');
  });
});

describe('reconocer la familia', () => {
  test('inteligencia, escrito como venga', () => {
    assert.equal(reconocerFamilia('[JUL] INTELIGENCIA')?.id, 'inteligencia');
    assert.equal(reconocerFamilia('Diploma de Especialización en Inteligencia y Contrainteligencia 14')?.id, 'inteligencia');
    assert.equal(reconocerFamilia('analista de inteligencia')?.id, 'inteligencia');
  });

  test('los acentos no cambian la familia', () => {
    assert.equal(reconocerFamilia('GESTIÓN PÚBLICA')?.id, 'gestion-publica');
    assert.equal(reconocerFamilia('gestion publica')?.id, 'gestion-publica');
  });

  test('OSINT es su propia familia, no «inteligencia» a secas', () => {
    assert.equal(reconocerFamilia('[ABR] OSINT Y SOCMINT')?.id, 'osint');
  });

  test('lo que no reconozco es null, no un cajón de sastre', () => {
    assert.equal(reconocerFamilia('[MAY] webinar gratuito'), null);
    assert.equal(reconocerFamilia(''), null);
  });

  test('cada familia dice su nombre en criollo, para no gritarle al cliente', () => {
    assert.equal(reconocerFamilia('[JUL] INTELIGENCIA')?.etiqueta, 'Inteligencia y Contrainteligencia');
  });
});

describe('de dónde sale la campaña de una conversación', () => {
  const base = { interes: null, lead: null, anuncio: null };

  test('el interés que asentó la vendedora manda sobre todo', () => {
    const c = campanaDe({ interes: 'OSINT & SOCMINT', lead: '[JUL] INTELIGENCIA', anuncio: '[JUN] BICAMERAL' });
    assert.equal(c?.fuente, 'interes');
    assert.equal(c?.familia?.id, 'osint');
  });

  test('sin interés, el formulario que llenó la persona', () => {
    const c = campanaDe({ ...base, lead: '[JUL] INTELIGENCIA', anuncio: '[JUN] BICAMERAL' });
    assert.equal(c?.fuente, 'lead');
    assert.equal(c?.familia?.id, 'inteligencia');
  });

  test('último, el anuncio: es de dónde vino, no lo que dijo', () => {
    const c = campanaDe({ ...base, anuncio: '[JUL] OPERACIONES CLANDESTINAS' });
    assert.equal(c?.fuente, 'anuncio');
    assert.equal(c?.familia?.id, 'operaciones');
  });

  test('sin ninguna de las tres no hay campaña, y no se inventa', () => {
    assert.equal(campanaDe(base), null);
    assert.equal(campanaDe({ interes: '   ', lead: '', anuncio: null }), null);
  });

  test('una campaña que no reconozco igual sirve para nombrarla', () => {
    const c = campanaDe({ ...base, interes: 'Taller de oratoria' });
    assert.equal(c?.familia, null);
    assert.equal(c?.nombre, 'Taller de oratoria');
  });

  test('reconocida, se la nombra por su nombre propio y no a los gritos', () => {
    const c = campanaDe({ ...base, interes: '[JUL] INTELIGENCIA' });
    assert.equal(c?.nombre, 'Inteligencia y Contrainteligencia');
  });

  test('un nombre ya escrito como se escribe se respeta, aunque reconozca la familia', () => {
    // Lo escribió una persona con lo que dice de más («Diplomado en…»); el
    // nombre de la familia lo perdería.
    const c = campanaDe({ ...base, interes: 'Diplomado en Gestión Pública' });
    assert.equal(c?.familia?.id, 'gestion-publica');
    assert.equal(c?.nombre, 'Diplomado en Gestión Pública');
  });

  test('el crudo se conserva siempre: es de dónde salió el dato', () => {
    const c = campanaDe({ ...base, anuncio: '[JUL] INTELIGENCIA' });
    assert.equal(c?.crudo, '[JUL] INTELIGENCIA');
  });
});
