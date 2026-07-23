import { describe, expect, it } from 'vitest';
import { iniciales } from './iniciales';

/**
 * Las iniciales del avatar — una sola fuente (antes vivían copiadas en cuatro
 * archivos: FilaConversacion, PanelContexto, VistaDashboard, ResponderPanel).
 */
describe('iniciales', () => {
  it('sin nombre, un punto (nunca un avatar vacío)', () => {
    expect(iniciales(null)).toBe('·');
    expect(iniciales('')).toBe('·');
    expect(iniciales('   ')).toBe('·');
  });

  it('dos palabras → una inicial de cada una', () => {
    expect(iniciales('Andre Q.')).toBe('AQ');
    expect(iniciales('Aldo L')).toBe('AL');
    expect(iniciales('juan perez')).toBe('JP');
  });

  it('una palabra → sus dos primeras letras', () => {
    expect(iniciales('juan')).toBe('JU');
  });

  it('ignora la @ del @usuario', () => {
    expect(iniciales('@marisol.ttito')).toBe('MA');
    expect(iniciales('@juan perez')).toBe('JP');
  });
});
