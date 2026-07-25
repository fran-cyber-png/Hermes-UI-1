import { describe, expect, test } from 'vitest';
import {
  bucketsDeFila,
  cuantoMasLento,
  formatearDemora,
  fueraDeHorario,
  pct,
  picoDe,
  type FilaNegocio,
  type PuntoCobertura,
} from './negocio';

/**
 * Las derivaciones de PRESENTACIÓN del panel de negocio. El server manda los
 * conteos crudos; acá se convierten en lo que la pantalla dibuja — y eso tiene
 * que ser verificable sin abrir la app, porque un bucket mal restado pinta una
 * barra que miente con total aplomo.
 */

const fila = (extra: Partial<FilaNegocio> = {}): FilaNegocio => ({
  clave: 'Osint & Socmint',
  ad_id: null,
  llegaron: 10,
  respondidos: 7,
  nunca_respondidos: 3,
  esperan: 5,
  demora_mediana_min: 12,
  cotizados: 1,
  cerrados: 0,
  precio_mencionado: 4,
  ...extra,
});

describe('bucketsDeFila — los tres estados de la barra, disjuntos', () => {
  test('parte «esperan» en las que jamás recibieron respuesta y las que sí', () => {
    expect(bucketsDeFila(fila())).toEqual({ alDia: 5, esperanTrasRespuesta: 2, jamas: 3 });
  });

  test('los tres suman SIEMPRE el total: una barra que no cierra es una barra que miente', () => {
    for (const f of [
      fila(),
      fila({ llegaron: 1, esperan: 1, nunca_respondidos: 1, respondidos: 0 }),
      fila({ llegaron: 4, esperan: 0, nunca_respondidos: 0, respondidos: 4 }),
      fila({ llegaron: 0, esperan: 0, nunca_respondidos: 0, respondidos: 0 }),
    ]) {
      const b = bucketsDeFila(f);
      expect(b.alDia + b.esperanTrasRespuesta + b.jamas).toBe(f.llegaron);
    }
  });

  test('nunca devuelve negativos aunque los conteos vengan raros', () => {
    const b = bucketsDeFila(fila({ llegaron: 2, esperan: 5, nunca_respondidos: 9 }));
    expect(b.alDia).toBeGreaterThanOrEqual(0);
    expect(b.esperanTrasRespuesta).toBeGreaterThanOrEqual(0);
    expect(b.jamas).toBeGreaterThanOrEqual(0);
  });
});

describe('formatearDemora — minutos en algo que se lee de un vistazo', () => {
  test('sin muestras se dice, no se muestra un cero', () => {
    expect(formatearDemora(null)).toBe('—');
  });

  test('por debajo de la hora, minutos redondos', () => {
    expect(formatearDemora(10)).toBe('10 min');
    expect(formatearDemora(0.4)).toBe('<1 min');
    expect(formatearDemora(59.4)).toBe('59 min');
    // Al redondear cruza la hora: se dice «1 h», no «60 min».
    expect(formatearDemora(59.6)).toBe('1 h');
  });

  test('a partir de la hora, horas y minutos — 496 minutos son 8 h 16 min', () => {
    expect(formatearDemora(496)).toBe('8 h 16 min');
    expect(formatearDemora(120)).toBe('2 h');
  });

  test('más de un día se dice en días: 3000 minutos no son «50 h»', () => {
    expect(formatearDemora(3000)).toBe('2 d 2 h');
  });
});

describe('cuantoMasLento — el remate de las dos medianas', () => {
  test('10 min contra 496 son 50 veces más lento', () => {
    expect(cuantoMasLento(10, 496)).toBe(50);
  });

  test('sin alguna de las dos medianas no hay comparación que hacer', () => {
    expect(cuantoMasLento(null, 496)).toBeNull();
    expect(cuantoMasLento(10, null)).toBeNull();
    expect(cuantoMasLento(0, 496)).toBeNull();
  });

  test('si afuera se responde igual o más rápido, no hay remate que dar', () => {
    expect(cuantoMasLento(30, 30)).toBeNull();
    expect(cuantoMasLento(30, 20)).toBeNull();
    expect(cuantoMasLento(30, 44)).toBeNull(); // 1,5× redondea a 2 pero no llega a 2×
  });
});

describe('pct — porcentajes que no explotan', () => {
  test('redondea a entero', () => {
    expect(pct(365, 834)).toBe(44);
    expect(pct(258, 834)).toBe(31);
  });

  test('sin total no hay porcentaje: 0, nunca NaN', () => {
    expect(pct(5, 0)).toBe(0);
  });
});

describe('la lectura de la cobertura horaria', () => {
  const cobertura: PuntoCobertura[] = Array.from({ length: 24 }, (_, hora) => ({
    hora,
    entran: hora === 23 ? 70 : hora >= 16 && hora <= 18 ? 40 : 5,
    salen: hora >= 8 && hora < 21 ? 30 : 1,
  }));

  test('fueraDeHorario suma lo que pasa cuando no hay nadie', () => {
    const f = fueraDeHorario(cobertura, 8, 21);
    // Horas 0–7 (5 c/u) + 21, 22 (5 c/u) + 23 (70) = 40 + 10 + 70
    expect(f.entran).toBe(120);
    expect(f.salen).toBe(11);
  });

  test('picoDe encuentra la hora más alta de una serie, para el rótulo directo', () => {
    expect(picoDe(cobertura, 'entran')).toEqual({ hora: 23, valor: 70 });
    expect(picoDe(cobertura, 'salen')?.valor).toBe(30);
  });

  test('una serie toda en cero no tiene pico que rotular', () => {
    const planas = cobertura.map((c) => ({ ...c, entran: 0 }));
    expect(picoDe(planas, 'entran')).toBeNull();
  });
});
