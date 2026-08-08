import { describe, expect, it } from 'vitest';
import { etiquetaFuente, nombreDistinto, origenDeLead } from './leadForm';

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

describe('origenDeLead — la MISMA palabra en la fila y en la ficha', () => {
  it('🔴 un lead de landing se lee «Landing» en los dos lugares', () => {
    // El 8-ago-2026 la fila del radar decía «Landing» y la ficha que se abre al
    // tocarla decía «Web», sobre el mismo hecho. Había tres copias del ternario.
    expect(origenDeLead('web')).toBe('Landing');
  });

  it('un Lead Ad de Meta se lee «Meta Ads»', () => {
    expect(origenDeLead('meta')).toBe('Meta Ads');
  });

  it('nunca dice «Web»: esa palabra es la que causaba la contradicción', () => {
    expect(origenDeLead('web')).not.toBe('Web');
  });
});
