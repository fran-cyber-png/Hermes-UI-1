import { describe, expect, it } from 'vitest';
import { parsearWhatsapp } from './formatoWhatsapp';

/**
 * EL FORMATO DE WHATSAPP, como lo ve el cliente. El parser es PURO: devuelve un
 * árbol (AST) fácil de afirmar; el componente `TextoWhatsapp` lo pinta (eso se
 * verifica con screenshot, no acá — el vitest del front corre en `node`, sin DOM).
 *
 * Regla de oro del parser: si algo no matchea, se muestra CRUDO. Jamás se come un
 * carácter ni se rompe el mensaje.
 */
describe('parsearWhatsapp', () => {
  it('texto sin marcas es un solo nodo de texto', () => {
    expect(parsearWhatsapp('hola mundo')).toEqual([{ tipo: 'texto', valor: 'hola mundo' }]);
  });

  it('reconoce *negrita*, _cursiva_ y ~tachado~', () => {
    expect(parsearWhatsapp('*Precio*')).toEqual([
      { tipo: 'negrita', hijos: [{ tipo: 'texto', valor: 'Precio' }] },
    ]);
    expect(parsearWhatsapp('_desarrolla_')).toEqual([
      { tipo: 'cursiva', hijos: [{ tipo: 'texto', valor: 'desarrolla' }] },
    ]);
    expect(parsearWhatsapp('~antes~')).toEqual([
      { tipo: 'tachado', hijos: [{ tipo: 'texto', valor: 'antes' }] },
    ]);
  });

  it('una marca en medio del texto lo parte en pedazos', () => {
    expect(parsearWhatsapp('el *Diploma* cuesta')).toEqual([
      { tipo: 'texto', valor: 'el ' },
      { tipo: 'negrita', hijos: [{ tipo: 'texto', valor: 'Diploma' }] },
      { tipo: 'texto', valor: ' cuesta' },
    ]);
  });

  it('permite espacios ADENTRO del énfasis, no pegados a las marcas', () => {
    expect(parsearWhatsapp('*Sofía, asesora comercial*')).toEqual([
      { tipo: 'negrita', hijos: [{ tipo: 'texto', valor: 'Sofía, asesora comercial' }] },
    ]);
  });

  it('anida: _*negrita dentro de cursiva*_', () => {
    expect(parsearWhatsapp('_*hola*_')).toEqual([
      { tipo: 'cursiva', hijos: [{ tipo: 'negrita', hijos: [{ tipo: 'texto', valor: 'hola' }] }] },
    ]);
  });

  it('una marca sin cierre queda literal — no se come nada', () => {
    expect(parsearWhatsapp('*sin cierre')).toEqual([{ tipo: 'texto', valor: '*sin cierre' }]);
    expect(parsearWhatsapp('2 * 3')).toEqual([{ tipo: 'texto', valor: '2 * 3' }]);
  });

  it('marcas con espacio pegado por dentro no formatean (regla de WhatsApp)', () => {
    expect(parsearWhatsapp('* no *')).toEqual([{ tipo: 'texto', valor: '* no *' }]);
  });

  it('```monoespaciado``` es literal, no anida', () => {
    expect(parsearWhatsapp('```*x*```')).toEqual([{ tipo: 'mono', valor: '*x*' }]);
  });

  it('linkifica http(s) y recorta la puntuación final', () => {
    expect(parsearWhatsapp('pagá en https://api.openpay.pe/occ/M6ftU74Q8acJ.')).toEqual([
      { tipo: 'texto', valor: 'pagá en ' },
      {
        tipo: 'enlace',
        href: 'https://api.openpay.pe/occ/M6ftU74Q8acJ',
        valor: 'https://api.openpay.pe/occ/M6ftU74Q8acJ',
      },
      { tipo: 'texto', valor: '.' },
    ]);
  });

  it('un guion bajo dentro de una URL no la vuelve cursiva', () => {
    expect(parsearWhatsapp('https://x.pe/a_b_c')).toEqual([
      { tipo: 'enlace', href: 'https://x.pe/a_b_c', valor: 'https://x.pe/a_b_c' },
    ]);
  });

  it('conserva los saltos de línea en el texto', () => {
    expect(parsearWhatsapp('hola\nmundo')).toEqual([{ tipo: 'texto', valor: 'hola\nmundo' }]);
  });

  it('el mensaje real del flyer: saludo + negrita + resto', () => {
    expect(parsearWhatsapp('👋Hola, te saluda *Sofía de Goberna* enseguida')).toEqual([
      { tipo: 'texto', valor: '👋Hola, te saluda ' },
      { tipo: 'negrita', hijos: [{ tipo: 'texto', valor: 'Sofía de Goberna' }] },
      { tipo: 'texto', valor: ' enseguida' },
    ]);
  });
});
