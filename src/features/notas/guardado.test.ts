import { describe, expect, it } from 'vitest';
import { ErrorApi } from '../../lib/datos/cliente';
import { LIMITE_TEXTO } from './notas';
import { motivoDelFallo, renglonDeEstado, type EstadoGuardado } from './guardado';

/**
 * EL DEFECTO, ESCRITO COMO REGLA.
 *
 * La Libreta tenía esto en el JSX:
 *
 *     {guardando ? 'Guardando…' : paginaAbierta?.editadoAt ? 'Guardado' : ''}
 *
 * Sin rama de error, y con `editadoAt` mandando: **después de un 400 la barra
 * volvía a decir «Guardado»**. Un ternario adentro del JSX no se puede
 * interrogar sobre el caso que no existe, así que el defecto era invisible para
 * cualquier test. Acá la regla se puede escribir, y es una sola:
 *
 *     un fallo sin resolver le gana a TODO.
 */

const FALLO: EstadoGuardado = { tipo: 'fallo', motivo: 'No se guardó: pasa de los 2000 caracteres' };

describe('qué dice el renglón de estado', () => {
  it('🔴 un fallo le gana a «Guardado», aunque la página ya se haya editado', () => {
    const r = renglonDeEstado(FALLO, true);
    expect(r.hayFallo).toBe(true);
    expect(r.texto).toBe(FALLO.motivo);
    expect(r.texto).not.toBe('Guardado');
  });

  it('🔴 y le gana también en una página nueva', () => {
    expect(renglonDeEstado(FALLO, false).hayFallo).toBe(true);
  });

  it('mientras guarda lo dice', () => {
    expect(renglonDeEstado({ tipo: 'guardando' }, true).texto).toBe('Guardando…');
    expect(renglonDeEstado({ tipo: 'guardando' }, true).hayFallo).toBe(false);
  });

  it('guardado bien dice «Guardado»', () => {
    expect(renglonDeEstado({ tipo: 'guardado' }, false).texto).toBe('Guardado');
  });

  it('una página ya editada que no se tocó sigue diciendo «Guardado»', () => {
    // El comportamiento viejo, que era correcto: sirve para que abrir una nota
    // vieja no muestre el renglón vacío como si nunca se hubiera guardado.
    expect(renglonDeEstado({ tipo: 'quieto' }, true).texto).toBe('Guardado');
  });

  it('una página nueva sin tocar no dice nada', () => {
    expect(renglonDeEstado({ tipo: 'quieto' }, false).texto).toBe('');
  });

  it('ningún estado de fallo puede salir sin marcar', () => {
    for (const motivo of ['x', 'No se guardó: se cerró tu sesión', '']) {
      expect(renglonDeEstado({ tipo: 'fallo', motivo }, true).hayFallo).toBe(true);
    }
  });
});

/**
 * EL MOTIVO TIENE QUE DECIR CUÁNTO RECORTAR.
 *
 * El server ya manda «la nota no puede superar los 2.000 caracteres (tiene
 * 2.431)», que trae el número exacto. Ese se prefiere sobre cualquier frase
 * nuestra: es la diferencia entre corregir y adivinar.
 */
describe('el motivo del fallo', () => {
  it('prefiere lo que explicó el server, con su número', () => {
    const e = new ErrorApi('la nota no puede superar los 2000 caracteres (tiene 2431)', 400);
    expect(motivoDelFallo(e)).toContain('2431');
  });

  it('un 400 sin explicación cae en el tope, que es lo que siempre es acá', () => {
    expect(motivoDelFallo(new ErrorApi('', 400))).toContain(String(LIMITE_TEXTO));
  });

  it('un 401 dice que se cerró la sesión, no que el texto está mal', () => {
    expect(motivoDelFallo(new ErrorApi('', 401))).toContain('sesión');
  });

  it('sin respuesta del server lo dice como lo que es: red', () => {
    expect(motivoDelFallo(new TypeError('Failed to fetch'))).toContain('servidor');
  });

  it('nunca devuelve algo que se pueda leer como «se guardó»', () => {
    for (const e of [new ErrorApi('x', 400), new ErrorApi('x', 500), new Error('?'), null]) {
      expect(motivoDelFallo(e).toLowerCase()).toContain('no se guardó');
    }
  });
});
