import { describe, expect, test } from 'vitest';
import type { GrupoBandeja, MensajeBandeja } from './bandeja';
import {
  conversacionDeSugerencia,
  enFila,
  hayQueRevisar,
  paso,
  porQueEstaCampana,
  proximaTrasResolver,
  quedanTras,
  saltar,
  textoDelBoton,
} from './revision';

/**
 * EL MODO REVISIÓN, sin React (ADR 0018).
 *
 * Acá vive lo que no puede estar mal cuando se despachan cuarenta en tres
 * minutos: EN QUÉ ORDEN se recorren, y —sobre todo— A CUÁL SE VA cuando la que
 * estabas mirando desaparece de la lista porque la acabás de aprobar.
 *
 * Ese segundo punto es el que decide si la vendedora despacha 40 en minutos o
 * en 40 viajes: si al aprobar la lista se reordena y el foco salta a cualquier
 * lado, hay que volver a buscar dónde estabas. Por eso el «a cuál voy» es una
 * función pura con tests, y no un `useEffect` que se porta distinto según cuándo
 * llegue el refetch.
 */

const mensaje = (over: Partial<MensajeBandeja> = {}): MensajeBandeja => ({
  id: 1,
  clave: 'conv:whatsapp:51900000001:51986394450',
  telefono: '51900000001',
  personaNombre: 'Rosa Quispe',
  plantillaId: 'acuse-fuera-de-horario',
  texto: 'Hola Rosa, gracias por escribir…',
  campana: 'Inteligencia y Contrainteligencia',
  campanaFuente: 'anuncio',
  editada: false,
  disparadaPor: '2026-07-25T04:40:00.000Z',
  programadoPara: '2026-07-25T12:30:00.000Z',
  caducaEn: '2026-07-25T15:30:00.000Z',
  esperandoMinutos: 300,
  ...over,
});

const grupo = (campana: string, mensajes: MensajeBandeja[]): GrupoBandeja => ({
  campana,
  plantillaId: mensajes[0]?.plantillaId ?? null,
  mensajes,
});

describe('el orden en el que se recorren', () => {
  test('se respeta el orden de campañas del server, y adentro va primero el que más esperó', () => {
    // El server ya manda el grupo más grande primero: es donde un OK hace más
    // trabajo. Adentro reordenamos por espera, que es el argumento para aprobar
    // (#153: el enganche cae de ~20% a 0,7% cuando no se responde).
    const fila = enFila([
      grupo('Inteligencia', [
        mensaje({ id: 1, esperandoMinutos: 90 }),
        mensaje({ id: 2, esperandoMinutos: 600 }),
        mensaje({ id: 3, esperandoMinutos: 300 }),
      ]),
      grupo('OSINT', [mensaje({ id: 4, esperandoMinutos: 1200 })]),
    ]);

    expect(fila.map((m) => m.id)).toEqual([2, 3, 1, 4]);
  });

  test('no se mezclan las campañas aunque una de la segunda haya esperado más', () => {
    // Recorrer saltando de campaña obliga a releer la plantilla en cada salto.
    // Quedarse adentro del grupo es leerla una vez (el argumento de ADR 0016,
    // en la forma nueva).
    const fila = enFila([
      grupo('Inteligencia', [mensaje({ id: 1, esperandoMinutos: 10 })]),
      grupo('OSINT', [mensaje({ id: 2, esperandoMinutos: 9999 })]),
    ]);
    expect(fila.map((m) => m.id)).toEqual([1, 2]);
  });

  test('sin grupos, la fila está vacía y no hay nada que revisar', () => {
    expect(enFila([])).toEqual([]);
    expect(hayQueRevisar([])).toBe(false);
    expect(hayQueRevisar([grupo('X', [mensaje()])])).toBe(true);
  });
});

describe('a cuál voy cuando la que miraba se resuelve', () => {
  const fila = enFila([
    grupo('Inteligencia', [
      mensaje({ id: 1, esperandoMinutos: 300 }),
      mensaje({ id: 2, esperandoMinutos: 200 }),
      mensaje({ id: 3, esperandoMinutos: 100 }),
    ]),
  ]);

  test('a la de abajo: la lista se corre sola, la mano no se mueve', () => {
    expect(proximaTrasResolver(fila, 1)).toBe(2);
    expect(proximaTrasResolver(fila, 2)).toBe(3);
  });

  test('si era la última, a la de arriba — nunca al vacío teniendo trabajo al lado', () => {
    expect(proximaTrasResolver(fila, 3)).toBe(2);
  });

  test('si era la única, no queda ninguna y se sale del modo', () => {
    expect(proximaTrasResolver([fila[0]], 1)).toBeNull();
  });

  test('resolver algo que ya no está no mueve el foco', () => {
    expect(proximaTrasResolver(fila, 99)).toBeNull();
  });

  test('resolver en lote se cuenta antes de mirar: quedan las que no entraron', () => {
    expect(quedanTras(fila, [1, 2]).map((m) => m.id)).toEqual([3]);
    expect(quedanTras(fila, [1, 2, 3])).toEqual([]);
    expect(quedanTras(fila, [])).toHaveLength(3);
  });
});

describe('saltar sin decidir', () => {
  const fila = enFila([
    grupo('A', [mensaje({ id: 1, esperandoMinutos: 3 }), mensaje({ id: 2, esperandoMinutos: 2 })]),
    grupo('B', [mensaje({ id: 3, esperandoMinutos: 1 })]),
  ]);

  test('adelante y atrás recorren la fila entera, cruzando campañas', () => {
    expect(saltar(fila, 1, +1)).toBe(2);
    expect(saltar(fila, 2, +1)).toBe(3);
    expect(saltar(fila, 3, -1)).toBe(2);
  });

  test('en los bordes se queda donde está: no da la vuelta', () => {
    // Dar la vuelta haría que «siguiente» al final vuelva al principio y la
    // vendedora crea que le quedan más de las que le quedan.
    expect(saltar(fila, 3, +1)).toBe(3);
    expect(saltar(fila, 1, -1)).toBe(1);
  });

  test('sin nada seleccionado, saltar lleva a la primera', () => {
    expect(saltar(fila, null, +1)).toBe(1);
    expect(saltar([], null, +1)).toBeNull();
  });
});

describe('dónde estoy parada', () => {
  const fila = enFila([grupo('A', [mensaje({ id: 7 }), mensaje({ id: 8 }), mensaje({ id: 9 })])]);

  test('el paso se cuenta desde 1, como lo diría una persona', () => {
    expect(paso(fila, 7)).toEqual({ actual: 1, total: 3 });
    expect(paso(fila, 9)).toEqual({ actual: 3, total: 3 });
  });

  test('sin nada abierto, el total sigue siendo verdad', () => {
    expect(paso(fila, null)).toEqual({ actual: 0, total: 3 });
  });
});

describe('el botón dice qué va a pasar, no «OK»', () => {
  test('sin tocar el texto, aprueba la plantilla', () => {
    expect(textoDelBoton({ editado: false })).toBe('Aprobar');
  });

  test('con el texto tocado lo dice, porque ya no es la plantilla', () => {
    // Si aprobás algo que editaste y el botón dice lo mismo, no hay forma de
    // notar que estás mandando otra cosa. La marca «editada» es lo que después
    // dice qué plantillas conviene reescribir.
    expect(textoDelBoton({ editado: true })).toBe('Aprobar lo editado');
  });
});

describe('por qué esta campaña — la cadena, en criollo', () => {
  test('cada eslabón se dice con su nivel de confianza', () => {
    expect(porQueEstaCampana('interes')).toMatch(/asent/i);
    expect(porQueEstaCampana('lead')).toMatch(/formulario/i);
    expect(porQueEstaCampana('anuncio')).toMatch(/anuncio/i);
  });

  test('una fila vieja (sin la columna) no inventa una procedencia', () => {
    expect(porQueEstaCampana(null)).toBeNull();
    expect(porQueEstaCampana('turbo')).toBeNull();
  });
});

describe('de una sugerencia a la conversación que hay que abrir', () => {
  test('la clave de la cola trae el número propio: no hace falta pedirlo', () => {
    const c = conversacionDeSugerencia(
      mensaje({
        clave: 'conv:whatsapp:51900000001:51986394450',
        telefono: '51900000001',
        personaNombre: 'Rosa Quispe',
      }),
    );
    expect(c).toMatchObject({
      clave: 'conv:whatsapp:51900000001:51986394450',
      canal: 'whatsapp',
      tipo: 'mensaje',
      persona_id: '51900000001',
      persona_nombre: 'Rosa Quispe',
      numero_propio: '51986394450',
    });
  });

  test('una clave rara no revienta ni inventa un número propio', () => {
    // Si el número propio se adivinara, el composer mandaría desde otro número.
    // Vacío es honesto y la conversación igual se abre: el hilo se busca por
    // teléfono, el número propio solo etiqueta.
    const c = conversacionDeSugerencia(mensaje({ clave: 'raro', telefono: '51900000009' }));
    expect(c.numero_propio).toBe('');
    expect(c.persona_id).toBe('51900000009');
  });

  test('la conversación nace SIN respuesta y sin marcar leída: no toca nada del hilo', () => {
    const c = conversacionDeSugerencia(mensaje());
    expect(c.respondida).toBe(false);
    expect(c.n).toBe(0);
  });
});
