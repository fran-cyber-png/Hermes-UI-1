import { describe, expect, it } from 'vitest';
import { etiquetaDeOrigen } from './etiquetaOrigen';

describe('la etiqueta de origen de la ficha unificada', () => {
  it('en WhatsApp dice el teléfono, legible', () => {
    expect(etiquetaDeOrigen('whatsapp', '51987654321', 'Rosa')).toBe('51 987 654 321');
  });

  it('en Instagram dice el usuario, no el id numérico de Meta', () => {
    expect(etiquetaDeOrigen('instagram', '17841400000000', 'rosita.gob')).toBe('@rosita.gob');
  });

  it('sin nombre, dice el canal — nunca un id que no le dice nada a nadie', () => {
    expect(etiquetaDeOrigen('instagram', '17841400000000', null)).toBe('Instagram');
    expect(etiquetaDeOrigen('facebook', '7654321098', null)).toBe('Messenger');
  });
});
