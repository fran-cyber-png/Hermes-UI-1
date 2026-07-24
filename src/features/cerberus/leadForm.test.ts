import { describe, expect, it } from 'vitest';
import { etiquetaFuente, nombreDistinto } from './leadForm';

/**
 * La lógica pura del bloque «lead-form» (#113): qué etiqueta lleva según el
 * origen, y cuándo el nombre real del formulario aporta algo sobre el pushname de
 * WhatsApp (que a veces es «🦋W» o «10 ❤️L»). El render se verifica con
 * screenshot; acá sólo la decisión, sin DOM.
 */

describe('etiquetaFuente', () => {
  it('marca de dónde salió el dato: Meta o formulario web', () => {
    expect(etiquetaFuente('meta')).toBe('del formulario de Meta');
    expect(etiquetaFuente('web')).toBe('del formulario web');
  });
});

describe('nombreDistinto', () => {
  it('muestra el nombre real cuando difiere del pushname', () => {
    expect(nombreDistinto('🦋W', 'Ana Torres')).toBe('Ana Torres');
    expect(nombreDistinto(null, 'Ana Torres')).toBe('Ana Torres');
  });

  it('no repite el nombre si es el mismo (ignorando mayúsculas y espacios)', () => {
    expect(nombreDistinto('Ana Torres', 'Ana Torres')).toBeNull();
    expect(nombreDistinto('ana torres', '  Ana   Torres ')).toBeNull();
  });

  it('sin nombre en el lead no hay nada que mostrar', () => {
    expect(nombreDistinto('Ana', null)).toBeNull();
    expect(nombreDistinto('Ana', '')).toBeNull();
    expect(nombreDistinto('Ana', '   ')).toBeNull();
  });
});
