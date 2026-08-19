import { describe, expect, it } from 'vitest';
import { LARGO_MINIMO, motivoParaNoCambiar } from './cambioDeClave';

/**
 * Lo que la pantalla decide SOLA antes de molestar al server. Es un atajo, no la
 * regla (la regla es la de Django): lo que se fija acá es que ninguno de estos
 * motivos deje pasar un formulario que Cerberus rechazaría seguro, y que el
 * camino feliz devuelva `null` — sin eso, todo lo demás pasaría con el botón muerto.
 */
describe('motivoParaNoCambiar', () => {
  const OK = { actual: 'la-de-antes', nueva: 'Nueva-Segura-2026', repetir: 'Nueva-Segura-2026' };

  it('un formulario bien llenado se puede mandar', () => {
    expect(motivoParaNoCambiar(OK)).toBeNull();
  });

  it('sin la actual no hay con qué entrar a Cerberus', () => {
    expect(motivoParaNoCambiar({ ...OK, actual: '' })).toMatch(/actual/);
  });

  it('sin la nueva no hay qué cambiar', () => {
    expect(motivoParaNoCambiar({ ...OK, nueva: '', repetir: '' })).toMatch(/nueva/);
  });

  it(`la nueva corta se frena acá (mínimo ${LARGO_MINIMO}, el default de Django)`, () => {
    expect(motivoParaNoCambiar({ ...OK, nueva: 'corta1', repetir: 'corta1' })).toMatch(new RegExp(String(LARGO_MINIMO)));
    expect(motivoParaNoCambiar({ ...OK, nueva: 'a'.repeat(LARGO_MINIMO), repetir: 'a'.repeat(LARGO_MINIMO) })).toBeNull();
  });

  it('la nueva igual a la actual no es un cambio', () => {
    expect(motivoParaNoCambiar({ ...OK, nueva: OK.actual, repetir: OK.actual })).toMatch(/distinta/);
  });

  it('las dos nuevas tienen que coincidir', () => {
    expect(motivoParaNoCambiar({ ...OK, repetir: 'Otra-Cosa-2026' })).toMatch(/no coinciden/);
  });
});
