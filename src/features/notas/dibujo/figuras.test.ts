import { describe, expect, it } from 'vitest';
import {
  LIMITE_FIGURAS_BYTES,
  type Figura,
  archivosDeFiguras,
  cajaDeFigura,
  cajaDeVarias,
  conColor,
  duplicar,
  figuraTocada,
  figurasEnCaja,
  moverFigura,
  nuevoId,
  paraGuardar,
  parsear,
  pesoDeFiguras,
  redimensionarImagen,
  reordenar,
  tiradorTocado,
} from './figuras';

/**
 * EL MODELO DE LA CAPA, sin canvas ni React. Lo que se prueba acá es lo que no
 * se puede mirar en pantalla: que un `jsonb` roto no tumbe la página, que el
 * borrador saque la figura que se está tocando y no la de abajo, que rodear una
 * palabra no se coma los clics de adentro del círculo, y que redimensionar una
 * imagen no la deforme.
 */

/**
 * Una figura con id fijo, para poder afirmar sobre ella.
 *
 * `SinId` se escribe distribuyendo sobre la unión (`T extends unknown ? … : …`):
 * un `Omit<Figura, 'id'>` a secas colapsa los cinco miembros en uno solo con las
 * propiedades comunes, y ahí ya no hay figura que construir.
 */
type SinBase<T> = T extends unknown ? Omit<T, 'id' | 'opacidad' | 'capaId'> : never;

/**
 * Lo común (`opacidad`, `capaId`) se rellena acá con sus defaults: los fixtures
 * hablan de la FORMA de cada figura, y repetir dos campos idénticos en veinte
 * lugares esconde lo que cada test está probando.
 */
function f(id: string, resto: SinBase<Figura>): Figura {
  return { opacidad: 1, capaId: 'base', ...resto, id } as Figura;
}

const TRAZO = f('t1', { clase: 'trazo', color: '#111827', grosor: 3, puntos: [[0, 0], [100, 0]] } as const);

const IMAGEN = f('i1', {
  clase: 'imagen',
  archivo: 'nota-1-abc.png',
  x: 100,
  y: 100,
  ancho: 200,
  alto: 100,
  naturalAncho: 800,
  naturalAlto: 400,
} as const);

describe('identidad', () => {
  it('cada figura nace con un id distinto', () => {
    const ids = new Set(Array.from({ length: 200 }, nuevoId));
    expect(ids.size).toBe(200);
  });

  it('🔴 una figura guardada SIN id recibe uno al leerla', () => {
    // Las que se guardaron antes de que los ids existieran tienen que poder
    // seleccionarse igual; sin id, `figurasEnCaja` devolvería `undefined`.
    const [leida] = parsear([{ clase: 'trazo', color: '#000', grosor: 3, puntos: [[0, 0]] }]);
    expect(leida.id).toBeTruthy();
  });
});

describe('guardar y volver', () => {
  it('la capa sobrevive la ida y la vuelta, imágenes incluidas', () => {
    const figuras: Figura[] = [
      TRAZO,
      f('r1', { clase: 'resaltador', color: '#eab308', grosor: 6, puntos: [[10, 20], [200, 20]] } as const),
      f('fl', { clase: 'flecha', color: '#ef4444', grosor: 3, desde: [10, 10], hasta: [90, 60] } as const),
      f('ro', { clase: 'rotulo', color: '#3b82f6', tamano: 24, en: [20, 80], texto: 'Ojo con esto' } as const),
      IMAGEN,
    ];
    expect(parsear(paraGuardar(figuras))).toEqual(figuras);
  });

  it('🔴 una imagen guarda el NOMBRE del archivo, nunca sus bytes', () => {
    // Es lo que mantiene la capa liviana: los bytes viven en disco y esto viaja
    // en cada autoguardado. Una captura en base64 acá reventaría el body.
    const json = JSON.stringify(paraGuardar([IMAGEN]));
    expect(json).toContain('nota-1-abc.png');
    expect(json).not.toContain('data:');
    expect(json.length).toBeLessThan(300);
  });

  it('se guarda como ARRAY, no como un string con JSON adentro', () => {
    expect(Array.isArray(paraGuardar([TRAZO]))).toBe(true);
  });

  it('🔴 las coordenadas se guardan con UN decimal, no con dieciséis', () => {
    const conCola = f('x', {
      clase: 'trazo',
      color: '#000',
      grosor: 3,
      puntos: [[312.7333335876465, 88.91111]],
    } as const);
    const json = JSON.stringify(paraGuardar([conCola]));
    expect(json).toContain('312.7');
    expect(json).not.toContain('312.73');
  });

  it('archivosDeFiguras no repite el mismo archivo dos veces', () => {
    const otra = { ...IMAGEN, id: 'i2' };
    expect(archivosDeFiguras([IMAGEN, TRAZO, otra])).toEqual(['nota-1-abc.png']);
  });
});

/**
 * LO DEFENSIVO. La entrada sale de una columna `jsonb`: puede venir de una
 * versión anterior, truncada, o tocada a mano. **Nada de eso puede lanzar** — no
 * hay ErrorBoundary en `src/`, así que una excepción durante el render no deja
 * «el dibujo no abre»: deja la ventana en blanco.
 */
describe('parsear no lanza nunca', () => {
  it.each([
    ['un JSON roto', '[{clase:'],
    ['una cadena vacía', ''],
    ['un objeto en vez de un array', '{}'],
    ['null', null],
    ['undefined', undefined],
    ['un número', 42],
    ['un array de basura', [1, 'dos', null, true]],
  ])('%s vale cero figuras', (_caso, entrada) => {
    expect(() => parsear(entrada)).not.toThrow();
    expect(parsear(entrada)).toEqual([]);
  });

  it('descarta la figura rota y conserva las sanas', () => {
    const figuras = parsear([
      { id: 'a', clase: 'trazo', color: '#000', grosor: 3, puntos: [[0, 0], [10, 10]] },
      { id: 'b', clase: 'trazo' }, // sin puntos
      { id: 'c', clase: 'inventada' },
      { id: 'd', clase: 'rotulo', en: [1, 1] }, // sin texto
      { id: 'e', clase: 'imagen', x: 0, y: 0 }, // sin archivo
      { id: 'g', clase: 'rectangulo', color: '#000', grosor: 2, desde: [0, 0], hasta: [5, 5] },
    ]);
    expect(figuras.map((x) => x.id)).toEqual(['a', 'g']);
  });

  it('🔴 una figura con la clase de la HERRAMIENTA no entra', () => {
    // `lapiz` es el nombre del botón; la figura que produce es un `trazo`.
    expect(parsear([{ clase: 'lapiz', color: '#000', grosor: 3, puntos: [[0, 0]] }])).toEqual([]);
  });

  it('una imagen sin medidas usa su natural, y acepta x/y negativos', () => {
    const [img] = parsear([
      { id: 'i', clase: 'imagen', archivo: 'a.png', x: -30, y: 0, naturalAncho: 40, naturalAlto: 20 },
    ]);
    expect(img).toMatchObject({ x: -30, ancho: 40, alto: 20 });
  });
});

describe('el tope', () => {
  it('una página bien anotada entra holgada', () => {
    const figuras: Figura[] = Array.from({ length: 20 }, (_, i) =>
      f(`t${i}`, {
        clase: 'trazo',
        color: '#111827',
        grosor: 3,
        puntos: Array.from({ length: 50 }, (_, j) => [j * 3.7 + i, j * 2.1] as [number, number]),
      } as const),
    );
    expect(pesoDeFiguras(figuras)).toBeLessThan(LIMITE_FIGURAS_BYTES / 2);
  });

  it('el tope deja aire para el resto del body de 100 KB de express', () => {
    expect(LIMITE_FIGURAS_BYTES).toBeLessThanOrEqual(64 * 1024);
  });
});

describe('a qué figura le pega el puntero', () => {
  const radio = 8;

  it('encuentra el trazo tocando cualquier punto de su recorrido', () => {
    expect(figuraTocada([TRAZO], [50, 1], radio)).toBe(0);
    expect(figuraTocada([TRAZO], [50, 400], radio)).toBe(-1);
  });

  it('🔴 con dos superpuestas agarra la de ARRIBA, no la de abajo', () => {
    const abajo = f('a', { clase: 'trazo', color: '#000', grosor: 3, puntos: [[0, 0], [100, 0]] } as const);
    const arriba = f('b', { clase: 'trazo', color: '#f00', grosor: 3, puntos: [[0, 0], [100, 0]] } as const);
    expect(figuraTocada([abajo, arriba], [50, 0], radio)).toBe(1);
  });

  it('🔴 un círculo que RODEA una palabra no se traga el clic de adentro', () => {
    const rodeo = f('e', { clase: 'elipse', color: '#ef4444', grosor: 2, desde: [0, 0], hasta: [200, 100] } as const);
    expect(figuraTocada([rodeo], [100, 0], radio), 'el borde sí').toBe(0);
    expect(figuraTocada([rodeo], [100, 50], radio), 'el centro no').toBe(-1);
  });

  it('una imagen SÍ se agarra por adentro: es una mancha llena', () => {
    expect(figuraTocada([IMAGEN], [200, 150], radio)).toBe(0);
    expect(figuraTocada([IMAGEN], [500, 150], radio)).toBe(-1);
  });

  it('una línea se toca por su recorrido, no por la recta que la prolonga', () => {
    const linea = f('l', { clase: 'linea', color: '#000', grosor: 2, desde: [0, 0], hasta: [100, 0] } as const);
    expect(figuraTocada([linea], [50, 0], radio)).toBe(0);
    expect(figuraTocada([linea], [300, 0], radio)).toBe(-1);
  });
});

describe('selección con rectángulo', () => {
  it('🔴 toma lo contenido Y lo intersectado', () => {
    // Alcanza con rozar: es lo que hace rápido «agarrá todo lo de esta zona».
    const adentro = f('a', { clase: 'trazo', color: '#000', grosor: 2, puntos: [[10, 10], [20, 20]] } as const);
    const cruzando = f('b', { clase: 'trazo', color: '#000', grosor: 2, puntos: [[15, 15], [900, 900]] } as const);
    expect(figurasEnCaja([adentro, cruzando], { x1: 0, y1: 0, x2: 50, y2: 50 })).toEqual(['a', 'b']);
  });

  it('lo que queda del todo afuera no entra', () => {
    const lejos = f('z', { clase: 'trazo', color: '#000', grosor: 2, puntos: [[900, 900]] } as const);
    expect(figurasEnCaja([lejos], { x1: 0, y1: 0, x2: 50, y2: 50 })).toEqual([]);
  });

  it('funciona con el rectángulo dibujado de derecha a izquierda', () => {
    const dentro = f('a', { clase: 'trazo', color: '#000', grosor: 2, puntos: [[10, 10]] } as const);
    expect(figurasEnCaja([dentro], { x1: 50, y1: 50, x2: 0, y2: 0 })).toEqual(['a']);
  });

  it('mezcla imágenes con trazos, que es el caso que importa', () => {
    expect(figurasEnCaja([TRAZO, IMAGEN], { x1: -10, y1: -10, x2: 400, y2: 400 })).toEqual(['t1', 'i1']);
  });

  it('cajaDeVarias envuelve al conjunto entero', () => {
    expect(cajaDeVarias([TRAZO, IMAGEN])).toEqual({ x1: 0, y1: 0, x2: 300, y2: 200 });
    expect(cajaDeVarias([])).toBeNull();
  });
});

describe('mover', () => {
  it('corre una imagen y no muta el original', () => {
    expect(moverFigura(IMAGEN, 10, -5)).toMatchObject({ x: 110, y: 95, ancho: 200, alto: 100 });
    expect(IMAGEN).toMatchObject({ x: 100, y: 100 });
  });

  it('moverla y volverla dejan la figura igual', () => {
    expect(moverFigura(moverFigura(TRAZO, 40, 12), -40, -12)).toEqual(TRAZO);
  });
});

describe('color', () => {
  it('cambia el color de un trazo', () => {
    expect(conColor(TRAZO, '#ff0000')).toMatchObject({ color: '#ff0000' });
  });

  it('🔴 una imagen no se pinta: se devuelve intacta', () => {
    // Pintar una foto de rojo no significa nada, y devolver `undefined`
    // obligaría a cada llamador a filtrar antes.
    expect(conColor(IMAGEN, '#ff0000')).toBe(IMAGEN);
  });
});

describe('redimensionar una imagen', () => {
  it('🔴 mantiene la proporción por defecto', () => {
    // La imagen es 2:1. Arrastrar la esquina a un punto que no respeta esa
    // razón tiene que salir igual respetándola.
    const r = redimensionarImagen(IMAGEN as never, 'se', [500, 500], false);
    expect(r.ancho / r.alto).toBeCloseTo(2, 5);
  });

  it('Shift la libera y deja deformar', () => {
    const r = redimensionarImagen(IMAGEN as never, 'se', [500, 500], true);
    expect(r.ancho).toBeCloseTo(400, 5);
    expect(r.alto).toBeCloseTo(400, 5);
  });

  it('🔴 la esquina OPUESTA queda clavada', () => {
    // Es lo que hace que la imagen «crezca desde donde la agarraste» en vez de
    // saltar de lugar. Arrastrando la superior izquierda, la inferior derecha
    // (300, 200) no se mueve.
    const r = redimensionarImagen(IMAGEN as never, 'no', [50, 60], true);
    expect(r.x + r.ancho).toBeCloseTo(300, 5);
    expect(r.y + r.alto).toBeCloseTo(200, 5);
  });

  it('no se puede achicar hasta desaparecer', () => {
    const r = redimensionarImagen(IMAGEN as never, 'se', [100, 100], true);
    expect(r.ancho).toBeGreaterThanOrEqual(24);
    expect(r.alto).toBeGreaterThanOrEqual(24);
  });

  it('los tiradores están en las cuatro esquinas de la caja', () => {
    const c = cajaDeFigura(IMAGEN);
    expect(tiradorTocado(c, [100, 100], 6)).toBe('no');
    expect(tiradorTocado(c, [300, 200], 6)).toBe('se');
    expect(tiradorTocado(c, [200, 150], 6), 'el centro no es un tirador').toBeNull();
  });
});

describe('orden de capas', () => {
  const a = f('a', { clase: 'trazo', color: '#000', grosor: 1, puntos: [[0, 0]] } as const);
  const b = f('b', { clase: 'trazo', color: '#000', grosor: 1, puntos: [[1, 1]] } as const);
  const c = f('c', { clase: 'trazo', color: '#000', grosor: 1, puntos: [[2, 2]] } as const);
  const ids = (fs: Figura[]) => fs.map((x) => x.id);

  it('traer al frente y enviar al fondo', () => {
    expect(ids(reordenar([a, b, c], ['a'], 'frente'))).toEqual(['b', 'c', 'a']);
    expect(ids(reordenar([a, b, c], ['c'], 'fondo'))).toEqual(['c', 'a', 'b']);
  });

  it('subir y bajar una posición', () => {
    expect(ids(reordenar([a, b, c], ['a'], 'subir'))).toEqual(['b', 'a', 'c']);
    expect(ids(reordenar([a, b, c], ['c'], 'bajar'))).toEqual(['a', 'c', 'b']);
  });

  it('lo de los extremos no se cae del array', () => {
    expect(ids(reordenar([a, b, c], ['c'], 'subir'))).toEqual(['a', 'b', 'c']);
    expect(ids(reordenar([a, b, c], ['a'], 'bajar'))).toEqual(['a', 'b', 'c']);
  });

  it('🔴 varias juntas conservan su orden relativo', () => {
    // Sin recorrer en el sentido del movimiento, `a` y `b` se amontonan contra
    // el mismo destino y una se come a la otra.
    expect(ids(reordenar([a, b, c], ['a', 'b'], 'frente'))).toEqual(['c', 'a', 'b']);
    expect(ids(reordenar([a, b, c], ['a', 'b'], 'subir'))).toEqual(['c', 'a', 'b']);
  });
});

describe('duplicar', () => {
  it('🔴 la copia tiene id NUEVO y está corrida', () => {
    // Con el mismo id, seleccionar una seleccionaría las dos; sin corrimiento,
    // la copia queda invisible encima del original.
    const [copia] = duplicar([TRAZO]);
    expect(copia.id).not.toBe(TRAZO.id);
    expect(copia.clase === 'trazo' && copia.puntos[0]).toEqual([16, 16]);
  });

  it('no muta lo original', () => {
    duplicar([IMAGEN]);
    expect(IMAGEN).toMatchObject({ x: 100, y: 100 });
  });
});
