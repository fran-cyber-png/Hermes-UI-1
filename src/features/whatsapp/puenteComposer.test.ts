import { afterEach, describe, expect, it } from 'vitest';
import { leerBorrador, limpiarBorrador } from './borradorComposer';
import { alPonerEnComposer, limpiarEscuchas, ponerEnComposer } from './puenteComposer';

afterEach(() => {
  limpiarEscuchas();
  limpiarBorrador('51900000000');
});

describe('el puente al composer', () => {
  it('avisa al composer que escucha', () => {
    const visto: string[] = [];
    alPonerEnComposer((v) => visto.push(`${v.telefono}:${v.texto}`));
    ponerEnComposer({ telefono: '51900000000', texto: 'Hola Ana' });
    expect(visto).toEqual(['51900000000:Hola Ana']);
  });

  it('guarda el borrador aunque NADIE esté escuchando', () => {
    // El caso real: el panel manda el texto de una conversación cuyo composer
    // todavía no se montó. El texto tiene que estar ahí igual al abrirla.
    ponerEnComposer({ telefono: '51900000000', texto: 'Te dejo el temario' });
    expect(leerBorrador('51900000000')).toBe('Te dejo el temario');
  });

  it('desuscribirse corta el cable', () => {
    const visto: string[] = [];
    const cortar = alPonerEnComposer((v) => visto.push(v.texto));
    cortar();
    ponerEnComposer({ telefono: '51900000000', texto: 'nada' });
    expect(visto).toEqual([]);
  });

  it('sin teléfono o sin texto no hace nada (no ensucia borradores)', () => {
    const visto: string[] = [];
    alPonerEnComposer((v) => visto.push(v.texto));
    ponerEnComposer({ telefono: '', texto: 'algo' });
    ponerEnComposer({ telefono: '51900000000', texto: '' });
    expect(visto).toEqual([]);
    expect(leerBorrador('51900000000')).toBe('');
  });

  it('varios oyentes reciben todos (dos ventanas del mismo chat)', () => {
    const a: string[] = [];
    const b: string[] = [];
    alPonerEnComposer((v) => a.push(v.texto));
    alPonerEnComposer((v) => b.push(v.texto));
    ponerEnComposer({ telefono: '51900000000', texto: 'x' });
    expect(a).toEqual(['x']);
    expect(b).toEqual(['x']);
  });
});
