import { describe, expect, test } from 'vitest';
import {
  COLUMNAS_TRABAJO,
  etapaDeTarjeta,
  quedanPorTraer,
  repartirColumnas,
  resumirBandeja,
  resumirColumna,
  type EtapaTrabajo,
  type FilaDesglose,
} from './tablero';

/**
 * EL TABLERO HONESTO (#90) — la lógica pura, sin DOM.
 *
 * Qué columna pide qué `?etapa=`, dónde cae cada tarjeta con los movimientos
 * optimistas en el medio, y cuántas faltan por traer. VistaEmbudo solo ejecuta;
 * la política se fija acá (mismo patrón que `compuertas.ts`).
 */

const tarjeta = (clave: string, etapa?: string) => ({ clave, etapa_efectiva: etapa });

describe('las columnas de trabajo', () => {
  test('cada columna pide SU etapa efectiva — interesado sigue sin ser columna (es la bandeja)', () => {
    expect(COLUMNAS_TRABAJO.map((c) => c.id)).toEqual([
      // «Sin respuesta» va PRIMERA desde el 8-ago-2026: es donde empieza el
      // embudo cuando la conversación la abrimos nosotros, y es la más grande
      // (2.580 de 3.973 medidas en producción).
      'sin_respuesta',
      'contactado',
      'cotizado',
      'cierre',
      'perdido',
    ]);
  });

  test('🔴 «sin respuesta» NO está en la lista de etapas declarables', async () => {
    // Se deriva de un hecho y deja de ser cierta sola. Si entrara a ETAPAS,
    // el embudo del Dashboard y el recibo de venta la enumerarían como un
    // peldaño más — y ahí sería un segmento clavado en cero.
    const { ETAPAS } = await import('../../lib/etapas');
    expect(ETAPAS).not.toContain('sin_respuesta');
  });
});

describe('repartirColumnas — dónde cae cada tarjeta', () => {
  const cargadas: [EtapaTrabajo, ReturnType<typeof tarjeta>[]][] = [
    ['contactado', [tarjeta('a', 'contactado'), tarjeta('b', 'contactado')]],
    ['cotizado', [tarjeta('c', 'cotizado')]],
    ['cierre', []],
    ['perdido', [tarjeta('d', 'perdido')]],
  ];

  test('sin movimientos, cada tarjeta queda en la columna que la trajo', () => {
    const mapa = repartirColumnas(cargadas, {});
    expect(mapa.get('contactado')!.map((t) => t.clave)).toEqual(['a', 'b']);
    expect(mapa.get('cotizado')!.map((t) => t.clave)).toEqual(['c']);
    expect(mapa.get('perdido')!.map((t) => t.clave)).toEqual(['d']);
  });

  test('un movimiento optimista muda la tarjeta: sale de la columna vieja y entra ARRIBA de la nueva', () => {
    const mapa = repartirColumnas(cargadas, { b: 'cotizado' });
    expect(mapa.get('contactado')!.map((t) => t.clave)).toEqual(['a']);
    expect(mapa.get('cotizado')!.map((t) => t.clave)).toEqual(['b', 'c']);
  });

  test('mientras las columnas se refrescan, una tarjeta duplicada se pinta UNA vez', () => {
    // Tras mover y refetchear, el destino ya la trae pero el origen todavía no
    // la soltó: manda la etapa efectiva de la propia tarjeta, no la columna vieja.
    const enTransicion: [EtapaTrabajo, ReturnType<typeof tarjeta>[]][] = [
      ['contactado', [tarjeta('x', 'cotizado')]],
      ['cotizado', [tarjeta('x', 'cotizado')]],
      ['cierre', []],
      ['perdido', []],
    ];
    const mapa = repartirColumnas(enTransicion, {});
    expect(mapa.get('cotizado')!.map((t) => t.clave)).toEqual(['x']);
    expect(mapa.get('contactado')).toEqual([]);
  });

  test('una tarjeta cuya etapa quedó fuera del tablero (interesado) no se pinta en ninguna columna', () => {
    const conVieja: [EtapaTrabajo, ReturnType<typeof tarjeta>[]][] = [
      ['contactado', [tarjeta('y', 'interesado')]],
      ['cotizado', []],
      ['cierre', []],
      ['perdido', []],
    ];
    const mapa = repartirColumnas(conVieja, {});
    expect(mapa.get('contactado')).toEqual([]);
  });
});

describe('etapaDeTarjeta — de dónde sale la etapa actual para las compuertas', () => {
  test('sin movimiento en vuelo, la manda el server (etapa_efectiva)', () => {
    expect(etapaDeTarjeta(tarjeta('a', 'cotizado'), {})).toBe('cotizado');
  });

  test('con movimiento optimista en vuelo, manda el movimiento', () => {
    expect(etapaDeTarjeta(tarjeta('a', 'contactado'), { a: 'cotizado' })).toBe('cotizado');
  });

  test('sin dato del server no se inventa nada: null, jamás el fallback interesado', () => {
    expect(etapaDeTarjeta({ clave: 'a' }, {})).toBeNull();
  });
});

describe('resumirBandeja — la bandeja deja de ser un número gris', () => {
  // La foto real de producción (2026-07-25), a escala: la bandeja son 476 y NO
  // son todas «gente que levantó la mano y nadie contestó».
  const desglose: FilaDesglose[] = [
    { etapa: 'interesado', yaLeHablamos: false, precio: false, viva: true, n: 40 },
    { etapa: 'interesado', yaLeHablamos: false, precio: false, viva: false, n: 218 },
    { etapa: 'interesado', yaLeHablamos: true, precio: false, viva: true, n: 41 },
    { etapa: 'interesado', yaLeHablamos: true, precio: true, viva: false, n: 177 },
    { etapa: 'contactado', yaLeHablamos: true, precio: true, viva: false, n: 611 },
  ];

  test('el total de la bandeja son los interesados, y nada más', () => {
    expect(resumirBandeja(desglose).total).toBe(476);
  });

  test('separa a quien nunca contestamos de quien nos volvió a escribir', () => {
    const r = resumirBandeja(desglose);
    expect(r.nuevas).toBe(258);
    expect(r.retomadas).toBe(218);
  });

  test('las que están escribiendo AHORA: el número que decide el día', () => {
    expect(resumirBandeja(desglose).vivas).toBe(81);
  });

  test('sin desglose todavía, ceros — nunca un número inventado', () => {
    expect(resumirBandeja(undefined)).toEqual({
      total: 0,
      nuevas: 0,
      retomadas: 0,
      vivas: 0,
      hayDetalle: false,
    });
  });

  test('el front va adelante del server (N4 antes que N5): cuenta con los conteos y CALLA el detalle', () => {
    const r = resumirBandeja(undefined, { interesado: 476, contactado: 1389 });
    expect(r.total).toBe(476);
    expect(r.hayDetalle).toBe(false);
  });
});

describe('resumirColumna — el tamaño real de la columna y el de su recorte', () => {
  const desglose: FilaDesglose[] = [
    { etapa: 'contactado', yaLeHablamos: true, precio: true, viva: false, ventana: true, n: 12 },
    { etapa: 'contactado', yaLeHablamos: true, precio: true, viva: false, ventana: false, n: 599 },
    { etapa: 'contactado', yaLeHablamos: true, precio: false, viva: false, ventana: true, n: 35 },
    { etapa: 'contactado', yaLeHablamos: true, precio: false, viva: false, ventana: false, n: 743 },
    { etapa: 'cotizado', yaLeHablamos: true, precio: true, viva: false, ventana: false, n: 3 },
  ];

  test('el total y cuántas ya tienen precio encima', () => {
    expect(resumirColumna(desglose, 'contactado')).toEqual({
      total: 1389,
      conPrecio: 611,
      enVentana: 47,
      paraSeguir: 0,
    });
  });

  /**
   * LOS DOS RECORTES SE CRUZAN, y por eso se cuentan por separado: de las 611
   * con precio, solo 12 están en ventana. Si `enVentana` se derivara de
   * `conPrecio` —o al revés— el chip prometería una lista que no es.
   */
  test('precio y ventana son dimensiones independientes: se cuentan aparte', () => {
    const r = resumirColumna(desglose, 'contactado');
    expect(r.conPrecio).toBe(611);
    expect(r.enVentana).toBe(47); // 12 con precio + 35 sin precio
    expect(r.enVentana).not.toBe(12);
  });

  /**
   * Un server viejo no manda `ventana` en el desglose. Ahí el chip tiene que dar
   * CERO y esconderse, no ofrecer un recorte que el server no sabe aplicar —
   * tocarlo devolvería la columna entera y se leería como que el filtro no anda.
   */
  test('sin el campo `ventana` (server viejo) el recorte cuenta cero y no se ofrece', () => {
    const viejo: FilaDesglose[] = [
      { etapa: 'contactado', yaLeHablamos: true, precio: true, viva: false, n: 611 },
      { etapa: 'contactado', yaLeHablamos: true, precio: false, viva: false, n: 778 },
    ];
    expect(resumirColumna(viejo, 'contactado')).toEqual({
      total: 1389,
      conPrecio: 611,
      enVentana: 0,
      paraSeguir: 0,
    });
  });

  test('una columna sin filas cuenta cero, no undefined', () => {
    expect(resumirColumna(desglose, 'cierre')).toEqual({
      total: 0,
      conPrecio: 0,
      enVentana: 0,
      paraSeguir: 0,
    });
  });

  test('sin desglose (server viejo) el total sale de los conteos y el recorte no se ofrece', () => {
    expect(resumirColumna(undefined, 'contactado', { contactado: 1389 })).toEqual({
      enVentana: 0,
      total: 1389,
      conPrecio: 0,
      paraSeguir: 0,
    });
  });
});

describe('quedanPorTraer — el «Ver más» honesto por columna', () => {
  test('lo que falta = total real de la columna menos lo cargado', () => {
    expect(quedanPorTraer(1129, 30)).toBe(1099);
  });

  test('nunca negativo (el total puede quedar viejo entre refetches)', () => {
    expect(quedanPorTraer(3, 5)).toBe(0);
  });

  test('sin total todavía, no se promete nada', () => {
    expect(quedanPorTraer(undefined, 30)).toBe(0);
  });
});
