import { describe, expect, test } from 'vitest';
import {
  cifrasDeColumna,
  COLUMNAS_CON_RECORTE,
  recortesDeColumna,
  resumirColumna,
  vacioDeColumna,
  type FilaDesglose,
  type ResumenColumna,
} from './tablero';

/**
 * EL RECORTE POR COLUMNA — la política, sin DOM.
 *
 * Lo que se fija acá no es cómo se ve: es **qué se ofrece**. Y el caso que
 * importa no se ve en ninguna captura — el chip activo que se queda sin conteo
 * (porque el recorte vació la columna) y desaparecería, dejando el recorte
 * encendido y a la vendedora sin el botón que lo apaga.
 */

const RESUMEN: ResumenColumna = { total: 3051, conPrecio: 3051, enVentana: 1, paraSeguir: 82 };
const VACIO: ResumenColumna = { total: 0, conPrecio: 0, enVentana: 0, paraSeguir: 0 };

describe('recortesDeColumna — qué chips se ofrecen', () => {
  test('«Todas» está siempre, y es el primero', () => {
    const r = recortesDeColumna('cotizado', RESUMEN, 'todas');
    expect(r[0].id).toBe('todas');
    expect(r[0].n).toBeNull();
  });

  test('un recorte que daría cero no se ofrece', () => {
    const r = recortesDeColumna('cotizado', { ...RESUMEN, enVentana: 0 }, 'todas');
    expect(r.map((o) => o.id)).not.toContain('ventana');
    expect(r.map((o) => o.id)).toContain('seguir');
  });

  test('🔴 pero el ACTIVO se ofrece aunque dé cero: si no, no hay cómo apagarlo', () => {
    // El caso real: tocás «Para seguir», la columna queda vacía, y el chip que
    // te devolvería a «Todas» desaparecería junto con las tarjetas.
    const r = recortesDeColumna('cotizado', VACIO, 'seguir');
    expect(r.map((o) => o.id)).toContain('seguir');
    expect(r.find((o) => o.id === 'seguir')?.n).toBe(0);
  });

  test('cada chip lleva SU número: sin él, tocarlo es un salto al vacío', () => {
    const r = recortesDeColumna('cotizado', RESUMEN, 'todas');
    expect(r.find((o) => o.id === 'seguir')?.n).toBe(82);
  });

  test('🔴 un recorte que da EL TOTAL tampoco se ofrece: no recorta nada', () => {
    // El defecto que encontró la primera captura: en Cotizados «Con precio 3.051»
    // sobre una columna de 3.051 — toda esa columna tiene precio, es lo que la
    // derivó. Un botón que no cambia lo que se ve es igual de inútil que uno que
    // vacía la columna, y encima partía los chips en dos renglones.
    expect(recortesDeColumna('cotizado', RESUMEN, 'todas').map((o) => o.id)).not.toContain('precio');
    // Y en Contactados, donde SÍ recorta, sigue apareciendo.
    const parcial = { total: 1389, conPrecio: 611, enVentana: 47, paraSeguir: 20 };
    expect(recortesDeColumna('contactado', parcial, 'todas').map((o) => o.id)).toContain('precio');
  });

  test('pero el activo se ofrece aunque dé el total: es cómo se vuelve a «Todas»', () => {
    expect(recortesDeColumna('cotizado', RESUMEN, 'precio').map((o) => o.id)).toContain('precio');
  });

  test('Cierre y Perdidos no llevan recorte: uno es archivo, el otro es otro frente', () => {
    expect(recortesDeColumna('perdido', RESUMEN, 'todas')).toEqual([]);
    expect(recortesDeColumna('cierre', RESUMEN, 'todas')).toEqual([]);
    expect(COLUMNAS_CON_RECORTE).toEqual(['contactado', 'cotizado']);
  });

  test('todos los chips ofrecidos, salvo «Todas», explican qué recortan', () => {
    for (const o of recortesDeColumna('contactado', RESUMEN, 'todas')) {
      if (o.id === 'todas') continue;
      expect(o.ayuda, `«${o.label}» sin ayuda`).toBeTruthy();
    }
  });
});

describe('cifrasDeColumna — el recorte manda, el total acompaña', () => {
  test('sin recorte hay UNA cifra: el total', () => {
    expect(cifrasDeColumna(RESUMEN, 'todas', 3051, 30)).toEqual({ principal: 3051, de: null });
  });

  test('con recorte, la principal es la recortada y el total viaja al lado', () => {
    expect(cifrasDeColumna(RESUMEN, 'seguir', 82, 30)).toEqual({ principal: 82, de: 3051 });
  });

  test('🔴 si el recorte no achica nada, no se dice «82 de 82»', () => {
    // Repetir el mismo número dos veces no informa: agrega una pregunta.
    expect(cifrasDeColumna({ ...RESUMEN, total: 82 }, 'seguir', 82, 30)).toEqual({
      principal: 82,
      de: null,
    });
  });

  test('sin total del server cuenta lo que hay pintado, nunca un cero inventado', () => {
    expect(cifrasDeColumna(VACIO, 'todas', undefined, 12)).toEqual({ principal: 12, de: null });
  });

  test('un recorte que vació la columna dice 0, y el total sigue diciendo la verdad', () => {
    expect(cifrasDeColumna(RESUMEN, 'ventana', 0, 0)).toEqual({ principal: 0, de: 3051 });
  });
});

describe('vacioDeColumna — el vacío tiene que decir de QUÉ', () => {
  test('sin recorte, el vacío de la etapa', () => {
    expect(vacioDeColumna('todas', 'Cuando le respondas a alguien, aparece acá.')).toBe(
      'Cuando le respondas a alguien, aparece acá.',
    );
  });

  test('🔴 con recorte, el vacío de la ETAPA sería falso: hay tarjetas, no pasan el filtro', () => {
    for (const r of ['precio', 'ventana', 'seguir'] as const) {
      const texto = vacioDeColumna(r, 'Cuando le respondas a alguien, aparece acá.');
      expect(texto).not.toBe('Cuando le respondas a alguien, aparece acá.');
      // Y siempre dice cuál es la salida.
      expect(texto).toContain('Todas');
    }
  });
});

describe('resumirColumna — la dimensión nueva del desglose', () => {
  const fila = (p: Partial<FilaDesglose>): FilaDesglose => ({
    etapa: 'cotizado',
    yaLeHablamos: true,
    precio: true,
    viva: false,
    n: 1,
    ...p,
  });

  test('suma `paraSeguir` de las filas de SU etapa', () => {
    const d = [
      fila({ paraSeguir: true, n: 10 }),
      fila({ paraSeguir: false, n: 90 }),
      fila({ etapa: 'contactado', paraSeguir: true, n: 5 }),
    ];
    expect(resumirColumna(d, 'cotizado').paraSeguir).toBe(10);
    expect(resumirColumna(d, 'cotizado').total).toBe(100);
    expect(resumirColumna(d, 'contactado').paraSeguir).toBe(5);
  });

  test('🔴 un server viejo (sin el campo) da cero, y el chip se esconde solo', () => {
    // Es la misma decisión que `ventana`: mejor no ofrecer el recorte que
    // ofrecerlo y que el server no sepa aplicarlo. N4 va solo, N5 es un botón.
    const d = [fila({ n: 40 })];
    expect(resumirColumna(d, 'cotizado').paraSeguir).toBe(0);
    expect(recortesDeColumna('cotizado', resumirColumna(d, 'cotizado'), 'todas').map((o) => o.id))
      .not.toContain('seguir');
  });

  test('sin desglose cae a los conteos de siempre y no inventa recortes', () => {
    const r = resumirColumna(undefined, 'cotizado', { cotizado: 3051 });
    expect(r).toEqual({ total: 3051, conPrecio: 0, enVentana: 0, paraSeguir: 0 });
  });
});
