import { describe, expect, it } from 'vitest';
import { MAX_CARACTERES_PREGUNTA, motivoParaNoPreguntar } from './ivi';

/**
 * EL CRITERIO DE «ESTO SALE O NO SALE», UNA SOLA VEZ.
 *
 * Lo consultan las dos puertas —el botón y `⌘↵`— y hasta que vivió acá estaban
 * implementadas por separado: el botón miraba el tope, el atajo no. La consecuencia no era
 * un 400 y ya, era una MENTIRA en pantalla: ese 400 viene sin `codigo`, la lectura cae en
 * `desconocido` y la app anuncia «se rompió algo que nadie previó» teniendo el diagnóstico
 * correcto a dos líneas de distancia.
 */
describe('motivoParaNoPreguntar', () => {
  it('una pregunta normal sale', () => {
    expect(motivoParaNoPreguntar('¿el diploma de OSINT tiene cuotas?', false)).toBeNull();
  });

  it('vacía o solo espacios no sale', () => {
    expect(motivoParaNoPreguntar('', false)).toBe('vacia');
    expect(motivoParaNoPreguntar('   \n\t ', false)).toBe('vacia');
  });

  it('con una en vuelo no sale otra', () => {
    expect(motivoParaNoPreguntar('¿y en México?', true)).toBe('ya_hay_una_en_vuelo');
  });

  it('el tope se mide en el texto crudo, igual que el contador de la pantalla', () => {
    expect(motivoParaNoPreguntar('x'.repeat(MAX_CARACTERES_PREGUNTA), false)).toBeNull();
    expect(motivoParaNoPreguntar('x'.repeat(MAX_CARACTERES_PREGUNTA + 1), false)).toBe('muy_larga');
    expect(motivoParaNoPreguntar('x'.repeat(MAX_CARACTERES_PREGUNTA + 500), false)).toBe('muy_larga');
  });

  it('el tope de la app es el del server o menor: nunca se le manda algo que va a rebotar', () => {
    // El server corta en 4000 (`routes/ivi.ts`). Si este número lo superara, el aviso
    // dejaría de ser de la app y volvería a ser un 400 sin código.
    expect(MAX_CARACTERES_PREGUNTA).toBeLessThanOrEqual(4_000);
  });
});
