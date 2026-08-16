import { describe, expect, it } from 'vitest';
import { esMensajeEntrante } from './decidir';

describe('esMensajeEntrante', () => {
  it('suena con un mensaje entrante', () => {
    expect(esMensajeEntrante({ tipo: 'mensaje', direccion: 'entrante' })).toBe(true);
  });

  it('NO suena con lo que mandamos nosotros', () => {
    expect(esMensajeEntrante({ tipo: 'mensaje', direccion: 'saliente' })).toBe(false);
  });

  it('NO suena con un cambio de estado de sesión', () => {
    expect(esMensajeEntrante({ tipo: 'estado' })).toBe(false);
  });

  it('NO suena sin direccion — reacción, recibo, o server viejo', () => {
    expect(esMensajeEntrante({ tipo: 'mensaje' })).toBe(false);
  });
});
